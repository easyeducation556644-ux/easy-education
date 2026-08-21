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

private const val CPS_COURSE_REVALIDATE_MS = 2 * 60_000L

data class NativeUiState(
    val authReady: Boolean = false,
    val user: FirebaseUser? = null,
    val profile: NativeUserProfile? = null,
    val restrictionMessage: String? = null,
    val courses: List<NativeCourse> = emptyList(),
    val cpsCourses: List<NativeCpsCourseEntry> = emptyList(),
    val cpsLiveHighlights: List<NativeCpsLiveClass> = emptyList(),
    val courseContent: Map<String, NativeCourseContent> = emptyMap(),
    val cpsCourseExtras: Map<String, NativeCpsCourseExtras> = emptyMap(),
    val downloads: List<SecureDownloadTask> = emptyList(),
    val qualityOptions: Map<String, List<DownloadQualityOption>> = emptyMap(),
    val qualityLoadingClassId: String? = null,
    val online: Boolean = false,
    val onWifi: Boolean = false,
    val wifiOnlyDownloads: Boolean = false,
    val syncing: Boolean = false,
    val error: String? = null,
)

private data class NativeSyncResult(
    val profile: NativeUserProfile,
    val courses: List<NativeCourse>,
    val cpsCatalog: NativeCpsCatalog,
    val restriction: String?,
)

class NativeAppViewModel(application: Application) : AndroidViewModel(application) {
    private val auth = FirebaseAuth.getInstance()

    private val repository by lazy(LazyThreadSafetyMode.SYNCHRONIZED) { NativeRepository(application) }
    private val cpsRepository by lazy(LazyThreadSafetyMode.SYNCHRONIZED) { NativeCpsRepository(application) }
    private val downloads by lazy(LazyThreadSafetyMode.SYNCHRONIZED) { SecureMediaStore(application) }
    private val qualityResolver by lazy(LazyThreadSafetyMode.SYNCHRONIZED) { DownloadQualityResolver(application) }
    private val connectivity = application.getSystemService(ConnectivityManager::class.java)
    private val cpsCourseVerifiedAt = mutableMapOf<String, Long>()
    private val cpsCourseLoading = mutableSetOf<String>()
    private val _state = MutableStateFlow(
        NativeUiState(
            online = isOnlineNow(),
            onWifi = runCatching { DownloadPreferences.isWifi(application) }.getOrDefault(false),
            wifiOnlyDownloads = runCatching { DownloadPreferences.wifiOnly(application) }.getOrDefault(false),
        ),
    )
    val state: StateFlow<NativeUiState> = _state.asStateFlow()

    private val authListener = FirebaseAuth.AuthStateListener { firebaseAuth ->
        val user = firebaseAuth.currentUser
        _state.value = _state.value.copy(user = user, authReady = true, error = null)
        if (user == null) {
            cpsCourseVerifiedAt.clear()
            cpsCourseLoading.clear()
            NativeTrialStore.reset()
            _state.value = _state.value.copy(
                profile = null,
                restrictionMessage = null,
                courses = emptyList(),
                cpsCourses = emptyList(),
                cpsLiveHighlights = emptyList(),
                courseContent = emptyMap(),
                cpsCourseExtras = emptyMap(),
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
        runCatching { SecureHlsDownloadService.cleanupPlaintext(application) }
        viewModelScope.launch {
            SecureMediaStore.changes.collect {
                val uid = auth.currentUser?.uid ?: return@collect
                runCatching { refreshDownloadsNow(uid) }
            }
        }
        auth.currentUser?.let { loadUser(it.uid) }
    }

    private fun updateNetwork() {
        val online = isOnlineNow()
        val wasOffline = !_state.value.online
        val wasOnWifi = _state.value.onWifi
        val onWifi = runCatching { DownloadPreferences.isWifi(getApplication()) }.getOrDefault(false)
        val wifiOnly = _state.value.wifiOnlyDownloads
        _state.value = _state.value.copy(online = online, onWifi = onWifi)

        if (wifiOnly && wasOnWifi && !onWifi) pauseActiveDownloadsForNetworkPolicy()
        if (online && wasOffline) {
            auth.currentUser?.uid?.let(::refreshOnline)
            runCatching { SecureDownloadCoordinator.resumePending(getApplication()) }
        } else if (online && !wasOnWifi && onWifi && wifiOnly) {
            runCatching { SecureDownloadCoordinator.resumePending(getApplication()) }
        }
    }

    private fun pauseActiveDownloadsForNetworkPolicy() {
        val context = getApplication<Application>()
        _state.value.downloads
            .filter { it.state in setOf("queued", "downloading") }
            .forEach { task -> runCatching { SecureDownloadCoordinator.pause(context, task.id) } }
    }

    private fun isOnlineNow(): Boolean = runCatching {
        val network = connectivity.activeNetwork ?: return@runCatching false
        val caps = connectivity.getNetworkCapabilities(network) ?: return@runCatching false
        caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }.getOrDefault(false)

    private fun trialOurCourseCards(): List<NativeCourse> = NativeTrialStore.state.value.active
        .flatMap { it.courseTargets }
        .filter { it.source == "our" }
        .distinctBy { it.courseId }
        .map { target ->
            NativeCourse(
                id = target.courseId,
                title = target.title,
                description = "Trial access",
                thumbnailUrl = "",
                price = 0.0,
                courseFormat = "trial",
            )
        }

    private fun mergeMyCourses(easyEducationCourses: List<NativeCourse>, cpsCatalog: NativeCpsCatalog): List<NativeCourse> {
        val now = System.currentTimeMillis()
        val activeCps = cpsCatalog.courses
            .filter { it.hasAccess && (it.accessExpiresAtMs == 0L || it.accessExpiresAtMs > now) }
            .map { it.course }
        return (easyEducationCourses + trialOurCourseCards() + activeCps).distinctBy { it.id }
    }

    private fun loadUser(uid: String) {
        viewModelScope.launch {
            NativeTrialStore.loadCached(getApplication(), uid)
            val cached = runCatching {
                val cachedProfile = repository.cachedProfile(uid)
                val cachedCourses = repository.cachedCourses(uid)
                val cachedDownloads = withContext(Dispatchers.IO) { healthyDownloads(uid) }
                Triple(cachedProfile, cachedCourses, cachedDownloads)
            }
            val cachedCps = runCatching { cpsRepository.cachedCatalog() }.getOrDefault(NativeCpsCatalog())
            cached.onSuccess { (cachedProfile, cachedCourses, cachedDownloads) ->
                _state.value = _state.value.copy(
                    profile = cachedProfile,
                    restrictionMessage = cachedProfile.restrictionMessage(),
                    courses = mergeMyCourses(cachedCourses, cachedCps),
                    cpsCourses = cachedCps.courses,
                    cpsLiveHighlights = cachedCps.liveHighlights,
                    downloads = cachedDownloads,
                    authReady = true,
                )
            }.onFailure {
                _state.value = _state.value.copy(
                    profile = null,
                    restrictionMessage = null,
                    courses = mergeMyCourses(emptyList(), cachedCps),
                    cpsCourses = cachedCps.courses,
                    cpsLiveHighlights = cachedCps.liveHighlights,
                    downloads = emptyList(),
                    authReady = true,
                    error = if (_state.value.online) null else "Local course cache could not be read. Connect once to refresh it.",
                )
            }
            if (_state.value.online) refreshOnline(uid)
        }
    }

    fun refreshOnline(uid: String = auth.currentUser?.uid.orEmpty()) {
        if (uid.isBlank() || !_state.value.online || _state.value.syncing) return
        val firebaseUser = auth.currentUser ?: return
        viewModelScope.launch {
            _state.value = _state.value.copy(syncing = true, error = null)
            runCatching {
                // Trial status is an Easy Education entitlement source. Failure here must not block
                // permanent courses, so the last cached offer state remains usable.
                runCatching { NativeTrialStore.refresh(getApplication(), uid, online = true) }
                val profile = repository.refreshProfile(
                    uid = uid,
                    fallbackName = firebaseUser.displayName.orEmpty(),
                    fallbackEmail = firebaseUser.email.orEmpty(),
                    fallbackPhotoUrl = firebaseUser.photoUrl?.toString().orEmpty(),
                )
                if (profile.restrictionMessage() != null) {
                    return@runCatching NativeSyncResult(
                        profile = profile,
                        courses = emptyList(),
                        cpsCatalog = NativeCpsCatalog(),
                        restriction = profile.restrictionMessage(),
                    )
                }
                val courses = repository.ensureEnrollments(uid)
                repository.syncChangedOnly(uid)
                val finalCourses = repository.cachedCourses(uid)
                val easyEducationCourses = if (finalCourses.isNotEmpty() || courses.isEmpty()) finalCourses else courses

                val cpsCatalog = runCatching { cpsRepository.browse() }
                    .getOrElse { cpsRepository.cachedCatalog() }
                NativeSyncResult(
                    profile = profile,
                    courses = mergeMyCourses(easyEducationCourses, cpsCatalog),
                    cpsCatalog = cpsCatalog,
                    restriction = null,
                )
            }.onSuccess { result ->
                val visibleCpsIds = result.cpsCatalog.courses.map { it.course.id }.toSet()
                _state.value = _state.value.copy(
                    profile = result.profile,
                    restrictionMessage = result.restriction,
                    courses = result.courses,
                    cpsCourses = result.cpsCatalog.courses,
                    cpsLiveHighlights = result.cpsCatalog.liveHighlights,
                    courseContent = _state.value.courseContent.filterKeys { !cpsRepository.isCpsCourse(it) || it in visibleCpsIds },
                    cpsCourseExtras = _state.value.cpsCourseExtras.filterKeys { it in visibleCpsIds },
                    syncing = false,
                )
            }.onFailure { error ->
                _state.value = _state.value.copy(syncing = false, error = error.message ?: "Sync failed")
            }
        }
    }

    fun refreshAll() {
        val uid = auth.currentUser?.uid ?: return
        cpsCourseVerifiedAt.clear()
        refreshOnline(uid)
        refreshDownloads()
    }

    fun loadCourse(courseId: String, force: Boolean = false) {
        if (courseId.isBlank() || _state.value.restrictionMessage != null) return

        if (cpsRepository.isCpsCourse(courseId)) {
            if (!cpsCourseLoading.add(courseId)) return
            viewModelScope.launch {
                try {
                    val cached = runCatching { cpsRepository.cachedCourse(courseId) }.getOrNull()
                    val catalogCourse = _state.value.cpsCourses.firstOrNull { it.course.id == courseId }?.course
                    val placeholder = NativeCourseContent(
                        course = catalogCourse,
                        subjects = emptyList(),
                        chapters = emptyList(),
                        classes = emptyList(),
                    )
                    if (cached != null) {
                        _state.value = _state.value.copy(
                            courseContent = _state.value.courseContent + (courseId to cached.content),
                            cpsCourseExtras = _state.value.cpsCourseExtras + (courseId to cached.extras),
                        )
                    } else if (_state.value.courseContent[courseId] == null) {
                        _state.value = _state.value.copy(courseContent = _state.value.courseContent + (courseId to placeholder))
                    }
                    if (!_state.value.online) return@launch

                    val now = System.currentTimeMillis()
                    val verifiedAt = cpsCourseVerifiedAt[courseId] ?: 0L
                    val hydratedRecently = verifiedAt > 0L && now - verifiedAt < CPS_COURSE_REVALIDATE_MS
                    // Opening the same CPS page repeatedly must not cause a visible access check.
                    // Cached entitlement is authoritative for UI; protected URLs are still checked
                    // server-side when hydrated. Manual/global refresh clears verifiedAt.
                    if (hydratedRecently) return@launch

                    runCatching { cpsRepository.refreshCourse(courseId) }
                        .onSuccess { bundle ->
                            cpsCourseVerifiedAt[courseId] = System.currentTimeMillis()
                            val updatedCatalog = _state.value.cpsCourses.map { entry ->
                                if (entry.course.id != courseId) entry
                                else entry.copy(
                                    course = bundle.content.course ?: entry.course,
                                    hasAccess = bundle.extras.hasAccess,
                                    accessExpiresAtMs = bundle.extras.accessExpiresAtMs,
                                )
                            }
                            val easyOnly = _state.value.courses.filterNot { cpsRepository.isCpsCourse(it.id) }
                            val updatedCps = NativeCpsCatalog(updatedCatalog, _state.value.cpsLiveHighlights)
                            _state.value = _state.value.copy(
                                cpsCourses = updatedCatalog,
                                courses = mergeMyCourses(easyOnly, updatedCps),
                                courseContent = _state.value.courseContent + (courseId to bundle.content),
                                cpsCourseExtras = _state.value.cpsCourseExtras + (courseId to bundle.extras),
                            )
                        }
                        .onFailure { error ->
                            if (cached == null || cached.content.classes.isEmpty()) {
                                _state.value = _state.value.copy(error = error.message ?: "CPS course could not be loaded")
                            }
                        }
                } finally {
                    cpsCourseLoading.remove(courseId)
                }
            }
            return
        }

        viewModelScope.launch {
            val cached = runCatching { repository.cachedCourseContent(courseId) }
                .getOrElse {
                    NativeCourseContent(
                        course = _state.value.courses.firstOrNull { course -> course.id == courseId },
                        subjects = emptyList(),
                        chapters = emptyList(),
                        classes = emptyList(),
                    )
                }
            _state.value = _state.value.copy(courseContent = _state.value.courseContent + (courseId to cached))
            if (_state.value.online) {
                runCatching { repository.ensureCourseContent(courseId, force) }
                    .onSuccess { fresh -> _state.value = _state.value.copy(courseContent = _state.value.courseContent + (courseId to fresh)) }
                    .onFailure { error ->
                        if (cached.classes.isEmpty()) _state.value = _state.value.copy(error = error.message ?: "Course content could not be loaded")
                    }
            }
        }
    }

    fun hasCpsAccess(courseId: String, now: Long = System.currentTimeMillis()): Boolean {
        if (!cpsRepository.isCpsCourse(courseId)) return false
        val extras = _state.value.cpsCourseExtras[courseId]
        if (cpsRepository.isAccessActive(extras, now)) return true
        val entry = _state.value.cpsCourses.firstOrNull { it.course.id == courseId } ?: return false
        return entry.hasAccess && (entry.accessExpiresAtMs == 0L || entry.accessExpiresAtMs > now)
    }

    fun hasOfflineLease(courseId: String): Boolean {
        if (_state.value.restrictionMessage != null || cpsRepository.isCpsCourse(courseId)) return false
        val uid = auth.currentUser?.uid ?: return false
        return runCatching { repository.hasOfflineLease(uid, courseId) }.getOrDefault(false)
    }

    fun leaseExpiry(courseId: String): Long {
        if (cpsRepository.isCpsCourse(courseId)) {
            return _state.value.cpsCourseExtras[courseId]?.accessExpiresAtMs
                ?: _state.value.cpsCourses.firstOrNull { it.course.id == courseId }?.accessExpiresAtMs
                ?: 0L
        }
        val uid = auth.currentUser?.uid ?: return 0L
        return runCatching { repository.offlineLeaseExpiry(uid, courseId) }.getOrDefault(0L)
    }

    fun refreshDownloads() {
        val uid = auth.currentUser ?: return
        viewModelScope.launch {
            runCatching { refreshDownloadsNow(uid.uid) }
                .onFailure { error -> _state.value = _state.value.copy(error = error.message ?: "Downloads could not be read") }
        }
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
            runCatching { withContext(Dispatchers.IO) { qualityResolver.resolve(item.id, item.downloadUrl) } }
                .onSuccess { options ->
                    _state.value = _state.value.copy(
                        qualityLoadingClassId = null,
                        qualityOptions = _state.value.qualityOptions + (item.id to options),
                    )
                }
                .onFailure { error ->
                    _state.value = _state.value.copy(qualityLoadingClassId = null, error = error.message ?: "Could not load video qualities")
                }
        }
    }

    fun clearDownloadQualities(classId: String) {
        _state.value = _state.value.copy(qualityOptions = _state.value.qualityOptions - classId)
    }

    fun startDownload(context: Context, course: NativeCourse, item: NativeClassItem, option: DownloadQualityOption) {
        val uid = auth.currentUser?.uid ?: return
        if (cpsRepository.isCpsCourse(course.id)) {
            _state.value = _state.value.copy(error = "CPS classes are online-only; access is verified before every playable session")
            return
        }
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
        val sameSource = existing?.sourceUrl == item.downloadUrl && existing.height == option.height && existing.sourceKind == option.kind
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
            totalBytes = existing?.takeIf { sameSource && it.state != "completed" }?.totalBytes ?: option.sizeBytes,
            chunkCount = existing?.takeIf { sameSource && it.state != "completed" }?.chunkCount ?: 0,
            state = "queued",
            phase = "preparing",
        )
        SecureDownloadCoordinator.start(context, task)
        clearDownloadQualities(item.id)
    }

    fun pauseDownload(context: Context, id: String) {
        runCatching { SecureDownloadCoordinator.pause(context, id) }
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
        runCatching { SecureDownloadCoordinator.resume(context, id) }
            .onFailure { error -> _state.value = _state.value.copy(error = error.message ?: "Download could not resume") }
    }

    fun removeDownload(context: Context, id: String) {
        runCatching { SecureDownloadCoordinator.remove(context, id) }
            .onFailure { error -> _state.value = _state.value.copy(error = error.message ?: "Download could not be removed") }
    }

    fun setWifiOnlyDownloads(enabled: Boolean) {
        runCatching { DownloadPreferences.setWifiOnly(getApplication(), enabled) }
        _state.value = _state.value.copy(wifiOnlyDownloads = enabled)
        if (enabled && !_state.value.onWifi) pauseActiveDownloadsForNetworkPolicy()
        else if (!enabled && _state.value.online) runCatching { SecureDownloadCoordinator.resumePending(getApplication()) }
    }

    fun clearError() {
        _state.value = _state.value.copy(error = null)
    }

    fun signOut() {
        NativeTrialStore.reset()
        auth.signOut()
    }

    override fun onCleared() {
        auth.removeAuthStateListener(authListener)
        runCatching { connectivity.unregisterNetworkCallback(networkCallback) }
        super.onCleared()
    }
}
