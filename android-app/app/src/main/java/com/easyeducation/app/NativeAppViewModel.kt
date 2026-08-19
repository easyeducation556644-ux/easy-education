package com.easyeducation.app

import android.app.Application
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext


data class NativeUiState(
    val authReady: Boolean = false,
    val user: FirebaseUser? = null,
    val profile: NativeUserProfile? = null,
    val restrictionMessage: String? = null,
    val courses: List<NativeCourse> = emptyList(),
    val courseContent: Map<String, NativeCourseContent> = emptyMap(),
    val downloads: List<SecureDownloadTask> = emptyList(),
    val qualityOptions: Map<String, List<DownloadQualityOption>> = emptyMap(),
    val qualityLoadingClassId: String? = null,
    val online: Boolean = false,
    val onWifi: Boolean = false,
    val wifiOnlyDownloads: Boolean = false,
    val syncing: Boolean = false,
    val error: String? = null,
)

class NativeAppViewModel(application: Application) : AndroidViewModel(application) {
    private val auth = FirebaseAuth.getInstance()
    private val repository = NativeRepository(application)
    private val downloads = SecureMediaStore(application)
    private val qualityResolver = DownloadQualityResolver(application)
    private val connectivity = application.getSystemService(ConnectivityManager::class.java)
    private val _state = MutableStateFlow(
        NativeUiState(
            online = isOnlineNow(),
            onWifi = DownloadPreferences.isWifi(application),
            wifiOnlyDownloads = DownloadPreferences.wifiOnly(application),
        ),
    )
    val state: StateFlow<NativeUiState> = _state.asStateFlow()

    private val authListener = FirebaseAuth.AuthStateListener { firebaseAuth ->
        val user = firebaseAuth.currentUser
        _state.value = _state.value.copy(user = user, authReady = true, error = null)
        if (user == null) {
            _state.value = _state.value.copy(
                profile = null,
                restrictionMessage = null,
                courses = emptyList(),
                courseContent = emptyMap(),
                downloads = emptyList(),
                qualityOptions = emptyMap(),
                qualityLoadingClassId = null,
            )
        } else {
            loadUser(user.uid)
        }
    }

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = updateNetwork()
        override fun onLost(network: Network) = updateNetwork()
        override fun onCapabilitiesChanged(network: Network, networkCapabilities: NetworkCapabilities) = updateNetwork()
    }

    init {
        auth.addAuthStateListener(authListener)
        runCatching { connectivity.registerDefaultNetworkCallback(networkCallback) }
        SecureHlsDownloadService.cleanupPlaintext(application)
        viewModelScope.launch {
            SecureMediaStore.changes.collect {
                val uid = auth.currentUser?.uid ?: return@collect
                refreshDownloadsNow(uid)
            }
        }
        auth.currentUser?.let { loadUser(it.uid) }
    }

    private fun updateNetwork() {
        val online = isOnlineNow()
        val wasOffline = !_state.value.online
        _state.value = _state.value.copy(
            online = online,
            onWifi = DownloadPreferences.isWifi(getApplication()),
        )
        if (online && wasOffline) auth.currentUser?.uid?.let(::refreshOnline)
    }

    private fun isOnlineNow(): Boolean {
        val network = connectivity.activeNetwork ?: return false
        val caps = connectivity.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    private fun loadUser(uid: String) {
        viewModelScope.launch {
            val cachedProfile = repository.cachedProfile(uid)
            val cachedCourses = repository.cachedCourses(uid)
            val cachedDownloads = withContext(Dispatchers.IO) { healthyDownloads(uid) }
            _state.value = _state.value.copy(
                profile = cachedProfile,
                restrictionMessage = cachedProfile.restrictionMessage(),
                courses = cachedCourses,
                downloads = cachedDownloads,
                authReady = true,
            )
            if (_state.value.online) refreshOnline(uid)
        }
    }

    fun refreshOnline(uid: String = auth.currentUser?.uid.orEmpty()) {
        if (uid.isBlank() || !_state.value.online || _state.value.syncing) return
        val firebaseUser = auth.currentUser ?: return
        viewModelScope.launch {
            _state.value = _state.value.copy(syncing = true, error = null)
            runCatching {
                val profile = repository.refreshProfile(
                    uid = uid,
                    fallbackName = firebaseUser.displayName.orEmpty(),
                    fallbackEmail = firebaseUser.email.orEmpty(),
                    fallbackPhotoUrl = firebaseUser.photoUrl?.toString().orEmpty(),
                )
                if (profile.restrictionMessage() != null) {
                    return@runCatching Triple(profile, emptyList<NativeCourse>(), profile.restrictionMessage())
                }
                val courses = repository.ensureEnrollments(uid)
                repository.syncChangedOnly(uid)
                val finalCourses = repository.cachedCourses(uid)
                Triple(profile, if (finalCourses.isNotEmpty() || courses.isEmpty()) finalCourses else courses, null)
            }.onSuccess { (profile, courses, restriction) ->
                _state.value = _state.value.copy(
                    profile = profile,
                    restrictionMessage = restriction,
                    courses = courses,
                    syncing = false,
                )
            }.onFailure { error ->
                _state.value = _state.value.copy(syncing = false, error = error.message ?: "Sync failed")
            }
        }
    }

    fun loadCourse(courseId: String, force: Boolean = false) {
        if (courseId.isBlank() || _state.value.restrictionMessage != null) return
        viewModelScope.launch {
            val cached = repository.cachedCourseContent(courseId)
            _state.value = _state.value.copy(
                courseContent = _state.value.courseContent + (courseId to cached),
            )
            if (_state.value.online) {
                runCatching { repository.ensureCourseContent(courseId, force) }
                    .onSuccess { fresh ->
                        _state.value = _state.value.copy(
                            courseContent = _state.value.courseContent + (courseId to fresh),
                        )
                    }
                    .onFailure { error ->
                        if (cached.classes.isEmpty()) {
                            _state.value = _state.value.copy(error = error.message ?: "Course content could not be loaded")
                        }
                    }
            }
        }
    }

    fun hasOfflineLease(courseId: String): Boolean {
        if (_state.value.restrictionMessage != null) return false
        val uid = auth.currentUser?.uid ?: return false
        return repository.hasOfflineLease(uid, courseId)
    }

    fun leaseExpiry(courseId: String): Long {
        val uid = auth.currentUser?.uid ?: return 0L
        return repository.offlineLeaseExpiry(uid, courseId)
    }

    fun refreshDownloads() {
        val uid = auth.currentUser?.uid ?: return
        viewModelScope.launch { refreshDownloadsNow(uid) }
    }

    private suspend fun refreshDownloadsNow(uid: String) {
        val list = withContext(Dispatchers.IO) { healthyDownloads(uid) }
        _state.value = _state.value.copy(downloads = list)
    }

    private fun healthyDownloads(uid: String): List<SecureDownloadTask> {
        return downloads.allForUser(uid).map { task ->
            if (task.state == "completed" && !downloads.hasCompleteMedia(task)) {
                val broken = task.copy(
                    state = "failed",
                    phase = "failed",
                    error = "Offline file is incomplete or damaged. Delete it and download again.",
                )
                downloads.save(broken)
                broken
            } else task
        }
    }

    fun loadDownloadQualities(item: NativeClassItem) {
        if (item.id.isBlank() || item.downloadUrl.isBlank()) {
            _state.value = _state.value.copy(error = "This class has no downloadable video source")
            return
        }
        if (!_state.value.online) {
            _state.value = _state.value.copy(error = "Connect to the internet to check available qualities")
            return
        }
        if (_state.value.wifiOnlyDownloads && !_state.value.onWifi) {
            _state.value = _state.value.copy(error = "Wi-Fi only downloads are enabled. Connect to Wi-Fi or turn the option off.")
            return
        }
        if (_state.value.qualityLoadingClassId == item.id) return
        _state.value = _state.value.copy(qualityLoadingClassId = item.id, error = null)
        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) { qualityResolver.resolve(item.id, item.downloadUrl) }
            }.onSuccess { options ->
                _state.value = _state.value.copy(
                    qualityLoadingClassId = null,
                    qualityOptions = _state.value.qualityOptions + (item.id to options),
                )
            }.onFailure { error ->
                _state.value = _state.value.copy(
                    qualityLoadingClassId = null,
                    error = error.message ?: "Could not load video qualities",
                )
            }
        }
    }

    fun clearDownloadQualities(classId: String) {
        _state.value = _state.value.copy(qualityOptions = _state.value.qualityOptions - classId)
    }

    fun startDownload(
        context: Context,
        course: NativeCourse,
        item: NativeClassItem,
        option: DownloadQualityOption,
    ) {
        val uid = auth.currentUser?.uid ?: return
        if (_state.value.restrictionMessage != null) {
            _state.value = _state.value.copy(error = "This account cannot download classes right now")
            return
        }
        if (!_state.value.online) {
            _state.value = _state.value.copy(error = "Connect to the internet to start a new download")
            return
        }
        if (_state.value.wifiOnlyDownloads && !_state.value.onWifi) {
            _state.value = _state.value.copy(error = "Wi-Fi only downloads are enabled. Connect to Wi-Fi or turn the option off.")
            return
        }
        val storage = DownloadStoragePolicy.check(context, option)
        if (!storage.allowed) {
            _state.value = _state.value.copy(error = storage.message)
            return
        }
        val id = SecureMediaStore.downloadId(uid, item.id)
        val existing = downloads.get(id)
        val sameSource = existing?.sourceUrl == item.downloadUrl &&
            existing.height == option.height && existing.sourceKind == option.kind
        val task = SecureDownloadTask(
            id = id,
            userId = uid,
            courseId = course.id,
            classId = item.id,
            title = item.title,
            courseTitle = course.title,
            sourceUrl = item.downloadUrl,
            height = option.height,
            qualityLabel = option.label,
            sourceKind = option.kind,
            expectedBytes = option.sizeBytes,
            sizeEstimated = option.estimated,
            downloadedBytes = existing?.takeIf { sameSource && it.state != "completed" }?.downloadedBytes ?: 0,
            totalBytes = existing?.takeIf { sameSource && it.state != "completed" }?.totalBytes
                ?: option.sizeBytes,
            chunkCount = existing?.takeIf { sameSource && it.state != "completed" }?.chunkCount ?: 0,
            state = "queued",
            phase = "preparing",
        )
        SecureDownloadCoordinator.start(context, task)
        clearDownloadQualities(item.id)
    }

    fun pauseDownload(context: Context, id: String) {
        SecureDownloadCoordinator.pause(context, id)
    }

    fun resumeDownload(context: Context, id: String) {
        if (_state.value.restrictionMessage != null) {
            _state.value = _state.value.copy(error = "This account cannot resume downloads right now")
            return
        }
        if (!_state.value.online) {
            _state.value = _state.value.copy(error = "Connect to resume this download")
            return
        }
        if (_state.value.wifiOnlyDownloads && !_state.value.onWifi) {
            _state.value = _state.value.copy(error = "Wi-Fi only downloads are enabled. Connect to Wi-Fi or turn the option off.")
            return
        }
        SecureDownloadCoordinator.resume(context, id)
    }

    fun removeDownload(context: Context, id: String) {
        SecureDownloadCoordinator.remove(context, id)
    }

    fun setWifiOnlyDownloads(enabled: Boolean) {
        DownloadPreferences.setWifiOnly(getApplication(), enabled)
        _state.value = _state.value.copy(wifiOnlyDownloads = enabled)
    }

    fun clearError() {
        _state.value = _state.value.copy(error = null)
    }

    fun signOut() {
        auth.signOut()
    }

    override fun onCleared() {
        auth.removeAuthStateListener(authListener)
        runCatching { connectivity.unregisterNetworkCallback(networkCallback) }
        super.onCleared()
    }
}
