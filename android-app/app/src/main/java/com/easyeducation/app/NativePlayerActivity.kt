package com.easyeducation.app

import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Fullscreen presentation of the same native player surface. Shared-session launches reuse the
 * process-local ExoPlayer, including buffer, speed and chapter queue. The surface itself handles a
 * continuous downward drag and calls back here only after the exit threshold is committed.
 */
@UnstableApi
class NativePlayerActivity : AppCompatActivity() {
    private var player: ExoPlayer? = null
    private lateinit var playerView: YoutubeStylePlayerView
    private var progressKey: String = ""
    private var title: String = ""
    private var ownsPlayer: Boolean = true
    private var sharedSession: Boolean = false
    private var currentClassId: String = ""
    private var currentSourceUrl: String = ""
    private var currentHeight: Int = 480
    private var finishingAnimated = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        @Suppress("DEPRECATION")
        overridePendingTransition(R.anim.ee_player_fullscreen_enter, R.anim.ee_player_background_hold)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.statusBarColor = Color.BLACK
        window.navigationBarColor = Color.BLACK
        enterImmersiveMode()

        title = intent.getStringExtra(EXTRA_TITLE).orEmpty()
        currentClassId = intent.getStringExtra(EXTRA_CLASS_ID).orEmpty()
        currentSourceUrl = intent.getStringExtra(EXTRA_SOURCE_URL).orEmpty()
        currentHeight = intent.getIntExtra(EXTRA_HEIGHT, 480)
        progressKey = "class:$currentClassId"
        sharedSession = intent.getBooleanExtra(EXTRA_SHARED_SESSION, false)

        playerView = YoutubeStylePlayerView(this).apply {
            setFullscreenPresentation(true)
            setTitle(title)
            onBack = { finish() }
            onMinimize = { finish() }
            onExitFullscreenGesture = { finish() }
            onFullscreen = { enterImmersiveMode() }
        }
        setContentView(playerView)

        val downloadId = intent.getStringExtra(EXTRA_DOWNLOAD_ID).orEmpty()
        when {
            downloadId.isNotBlank() -> playOffline(downloadId)
            sharedSession && currentSourceUrl.isNotBlank() &&
                PersistentNativePlayer.matches(currentClassId, currentSourceUrl, currentHeight) -> {
                ownsPlayer = false
                val exo = PersistentNativePlayer.player(this)
                player = exo
                playerView.setLoading(false)
                playerView.bindPlayer(exo)
                exo.playWhenReady = true
                bindSharedNavigation()
            }
            currentSourceUrl.isNotBlank() -> playOnline(currentClassId, currentSourceUrl, currentHeight)
            else -> fail("Video source is unavailable")
        }
    }

    private fun playOffline(downloadId: String) {
        val uid = FirebaseAuth.getInstance().currentUser?.uid
        if (uid.isNullOrBlank()) {
            fail("Sign in with the account that downloaded this class")
            return
        }
        val task = SecureMediaStore(this).get(downloadId)
        if (task == null || task.userId != uid) {
            fail("This offline class belongs to another account")
            return
        }
        if (!OfflineLeaseStore(this).isValid(uid, task.courseId)) {
            fail("Connect to the internet once to verify this course and renew offline access")
            return
        }
        ownsPlayer = true
        sharedSession = false
        currentClassId = task.classId
        progressKey = "class:${task.classId}"
        title = task.title
        playerView.setTitle(title)
        playerView.setNavigationAvailability(false, false)
        playerView.onPrevious = null
        playerView.onNext = null
        val mediaSource = ProgressiveMediaSource.Factory(
            SecureChunkDataSource.Factory(this, downloadId, uid),
        ).createMediaSource(MediaItem.fromUri(Uri.parse("secure://easy-education/$downloadId")))
        prepareOwnedPlayer(mediaSource)
    }

    private fun playOnline(classId: String, sourceUrl: String, requestedHeight: Int) {
        playerView.setLoading(true)
        lifecycleScope.launch {
            if (sharedSession) {
                runCatching {
                    PersistentNativePlayer.ensureOnline(
                        context = this@NativePlayerActivity,
                        classId = classId,
                        sourceUrl = sourceUrl,
                        requestedHeight = requestedHeight,
                        autoPlay = true,
                    )
                }.onSuccess { exo ->
                    ownsPlayer = false
                    player = exo
                    playerView.setLoading(false)
                    playerView.bindPlayer(exo)
                    bindSharedNavigation()
                }.onFailure { error ->
                    playerView.setLoading(false)
                    fail(error.message ?: "Could not open this class video")
                }
                return@launch
            }

            val resolved = withContext(Dispatchers.IO) {
                runCatching { NativePlaybackSourceResolver.resolveOnline(classId, sourceUrl, requestedHeight) }
            }
            resolved.onSuccess { source ->
                runCatching { NativePlaybackSourceResolver.toMediaSource(source) }
                    .onSuccess { mediaSource ->
                        playerView.setLoading(false)
                        playerView.setNavigationAvailability(false, false)
                        prepareOwnedPlayer(mediaSource)
                    }
                    .onFailure { error ->
                        playerView.setLoading(false)
                        fail(error.message ?: "Could not open this class video")
                    }
            }.onFailure { error ->
                playerView.setLoading(false)
                fail(error.message ?: "Could not open this class video")
            }
        }
    }

    private fun bindSharedNavigation() {
        val previous = PlayerChapterQueue.previous(currentClassId)
        val next = PlayerChapterQueue.next(currentClassId)
        playerView.setNavigationAvailability(previous != null, next != null)
        playerView.onPrevious = { navigateShared(PlayerChapterQueue.previous(currentClassId)) }
        playerView.onNext = { navigateShared(PlayerChapterQueue.next(currentClassId)) }
    }

    private fun navigateShared(target: PlayerQueueItem?) {
        if (!sharedSession || target == null) return
        PersistentNativePlayer.savePosition(this)
        playerView.setLoading(true)
        lifecycleScope.launch {
            runCatching {
                PersistentNativePlayer.ensureOnline(
                    context = this@NativePlayerActivity,
                    classId = target.classId,
                    sourceUrl = target.sourceUrl,
                    requestedHeight = target.height,
                    autoPlay = true,
                )
            }.onSuccess { exo ->
                ownsPlayer = false
                player = exo
                currentClassId = target.classId
                currentSourceUrl = target.sourceUrl
                currentHeight = target.height
                progressKey = "class:${target.classId}"
                title = target.title
                playerView.setTitle(title)
                playerView.bindPlayer(exo)
                playerView.setLoading(false)
                bindSharedNavigation()
            }.onFailure { error ->
                playerView.setLoading(false)
                Toast.makeText(
                    this@NativePlayerActivity,
                    friendlyMessage(error.message ?: "Could not open this class video"),
                    Toast.LENGTH_LONG,
                ).show()
            }
        }
    }

    private fun prepareOwnedPlayer(mediaSource: MediaSource) {
        releaseOwnedPlayer(savePosition = false)
        ownsPlayer = true
        val exo = ExoPlayer.Builder(this).build()
        player = exo
        playerView.bindPlayer(exo)
        exo.setMediaSource(mediaSource)
        val saved = getSharedPreferences(PLAYER_PREFS, MODE_PRIVATE).getLong(progressKey, 0L)
        exo.prepare()
        if (saved > 0L) exo.seekTo(saved)
        exo.playWhenReady = true
    }

    private fun fail(message: String) {
        Toast.makeText(this, friendlyMessage(message), Toast.LENGTH_LONG).show()
        finish()
    }

    override fun onStop() {
        player?.let { exo ->
            savePosition(exo.currentPosition)
            if (!isFinishing) exo.pause()
        }
        super.onStop()
    }

    override fun onDestroy() {
        if (ownsPlayer) {
            releaseOwnedPlayer(savePosition = true)
        } else {
            player?.let { savePosition(it.currentPosition) }
            playerView.bindPlayer(null)
            player = null
        }
        super.onDestroy()
    }

    override fun finish() {
        if (finishingAnimated) return
        finishingAnimated = true
        player?.let { savePosition(it.currentPosition) }
        super.finish()
        @Suppress("DEPRECATION")
        overridePendingTransition(R.anim.ee_player_background_hold, R.anim.ee_player_fullscreen_exit)
    }

    private fun releaseOwnedPlayer(savePosition: Boolean) {
        val exo = player ?: return
        if (!ownsPlayer) return
        if (savePosition) savePosition(exo.currentPosition)
        playerView.bindPlayer(null)
        exo.release()
        player = null
    }

    private fun savePosition(position: Long) {
        if (progressKey.isBlank() || position <= 0L) return
        getSharedPreferences(PLAYER_PREFS, MODE_PRIVATE)
            .edit().putLong(progressKey, position).apply()
    }

    private fun enterImmersiveMode() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            )
    }

    private fun friendlyMessage(raw: String): String = when {
        raw.contains("Unable to resolve host", true) ||
            raw.contains("Failed to connect", true) ||
            raw.contains("timeout", true) -> "Network problem. Check your connection and try again."
        raw.contains("403", true) -> "Video access expired. Reopen the class to refresh the stream."
        else -> raw
    }

    companion object {
        const val EXTRA_DOWNLOAD_ID = "download_id"
        const val EXTRA_SOURCE_URL = "source_url"
        const val EXTRA_CLASS_ID = "class_id"
        const val EXTRA_HEIGHT = "height"
        const val EXTRA_TITLE = "title"
        const val EXTRA_SHARED_SESSION = "shared_player_session"
        private const val PLAYER_PREFS = "native_player_positions_v2"
    }
}
