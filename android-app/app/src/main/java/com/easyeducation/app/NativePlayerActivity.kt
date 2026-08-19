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
 * Fullscreen presentation of the same native player surface. When launched from the class page or
 * miniplayer it binds to PersistentNativePlayer instead of resolving/creating a second stream.
 */
@UnstableApi
class NativePlayerActivity : AppCompatActivity() {
    private var player: ExoPlayer? = null
    private lateinit var playerView: YoutubeStylePlayerView
    private var progressKey: String = ""
    private var title: String = ""
    private var ownsPlayer: Boolean = true
    private var sharedSession: Boolean = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        @Suppress("DEPRECATION")
        overridePendingTransition(0, 0)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.statusBarColor = Color.BLACK
        window.navigationBarColor = Color.BLACK
        enterImmersiveMode()

        title = intent.getStringExtra(EXTRA_TITLE).orEmpty()
        playerView = YoutubeStylePlayerView(this).apply {
            setTitle(title)
            onBack = { finish() }
            onMinimize = { finish() }
            onFullscreen = { finish() }
        }
        setContentView(playerView)

        val downloadId = intent.getStringExtra(EXTRA_DOWNLOAD_ID).orEmpty()
        val sourceUrl = intent.getStringExtra(EXTRA_SOURCE_URL).orEmpty()
        val classId = intent.getStringExtra(EXTRA_CLASS_ID).orEmpty()
        val requestedHeight = intent.getIntExtra(EXTRA_HEIGHT, 480)
        progressKey = "class:$classId"
        sharedSession = intent.getBooleanExtra(EXTRA_SHARED_SESSION, false)

        when {
            downloadId.isNotBlank() -> playOffline(downloadId)
            sharedSession && sourceUrl.isNotBlank() &&
                PersistentNativePlayer.matches(classId, sourceUrl, requestedHeight) -> {
                ownsPlayer = false
                val exo = PersistentNativePlayer.player(this)
                player = exo
                playerView.setLoading(false)
                playerView.bindPlayer(exo)
                exo.playWhenReady = true
            }
            sourceUrl.isNotBlank() -> playOnline(classId, sourceUrl, requestedHeight)
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
        progressKey = "class:${task.classId}"
        title = task.title
        playerView.setTitle(title)
        val mediaSource = ProgressiveMediaSource.Factory(
            SecureChunkDataSource.Factory(this, downloadId, uid),
        ).createMediaSource(
            MediaItem.fromUri(Uri.parse("secure://easy-education/$downloadId")),
        )
        prepareOwnedPlayer(mediaSource)
    }

    private fun playOnline(classId: String, sourceUrl: String, requestedHeight: Int) {
        playerView.setLoading(true)
        lifecycleScope.launch {
            val result = runCatching {
                if (sharedSession) {
                    PersistentNativePlayer.ensureOnline(
                        context = this@NativePlayerActivity,
                        classId = classId,
                        sourceUrl = sourceUrl,
                        requestedHeight = requestedHeight,
                        autoPlay = true,
                    )
                } else null
            }
            if (sharedSession) {
                result.onSuccess { exo ->
                    if (exo == null) return@onSuccess
                    ownsPlayer = false
                    player = exo
                    playerView.setLoading(false)
                    playerView.bindPlayer(exo)
                }.onFailure { error ->
                    playerView.setLoading(false)
                    fail(error.message ?: "Could not open this class video")
                }
                return@launch
            }

            val resolved = withContext(Dispatchers.IO) {
                runCatching {
                    NativePlaybackSourceResolver.resolveOnline(classId, sourceUrl, requestedHeight)
                }
            }
            resolved.onSuccess { source ->
                runCatching {
                    NativePlaybackSourceResolver.toMediaSource(source)
                }.onSuccess { mediaSource ->
                    playerView.setLoading(false)
                    prepareOwnedPlayer(mediaSource)
                }.onFailure { error ->
                    playerView.setLoading(false)
                    fail(error.message ?: "Could not open this class video")
                }
            }.onFailure { error ->
                playerView.setLoading(false)
                fail(error.message ?: "Could not open this class video")
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
            // Finishing fullscreen means the same shared player is about to render inline again.
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
        player?.let { savePosition(it.currentPosition) }
        super.finish()
        @Suppress("DEPRECATION")
        overridePendingTransition(0, 0)
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
            .edit()
            .putLong(progressKey, position)
            .apply()
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
