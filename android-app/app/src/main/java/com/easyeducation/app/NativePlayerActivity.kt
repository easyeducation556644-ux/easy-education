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
 * Fullscreen form of the same native player used inline on the class page. Online YouTube, online
 * Rumble and encrypted offline media therefore share controls, gestures, resume position and the
 * 0.25x..4x playback-speed preference.
 */
@UnstableApi
class NativePlayerActivity : AppCompatActivity() {
    private var player: ExoPlayer? = null
    private lateinit var playerView: YoutubeStylePlayerView
    private var progressKey: String = ""
    private var title: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.statusBarColor = Color.BLACK
        window.navigationBarColor = Color.BLACK
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            )

        title = intent.getStringExtra(EXTRA_TITLE).orEmpty()
        playerView = YoutubeStylePlayerView(this).apply {
            setTitle(title)
            onMinimize = { finish() }
            // Already fullscreen. Keeping the callback harmless makes this the exact same control surface.
            onFullscreen = { enterImmersiveMode() }
        }
        setContentView(playerView)

        val downloadId = intent.getStringExtra(EXTRA_DOWNLOAD_ID).orEmpty()
        val sourceUrl = intent.getStringExtra(EXTRA_SOURCE_URL).orEmpty()
        val classId = intent.getStringExtra(EXTRA_CLASS_ID).orEmpty()
        val requestedHeight = intent.getIntExtra(EXTRA_HEIGHT, 480)
        progressKey = "class:$classId"

        when {
            downloadId.isNotBlank() -> playOffline(downloadId)
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
        progressKey = "class:${task.classId}"
        title = task.title
        playerView.setTitle(title)
        val mediaSource = ProgressiveMediaSource.Factory(
            SecureChunkDataSource.Factory(this, downloadId, uid),
        ).createMediaSource(
            MediaItem.fromUri(Uri.parse("secure://easy-education/$downloadId")),
        )
        preparePlayer(mediaSource)
    }

    private fun playOnline(classId: String, sourceUrl: String, requestedHeight: Int) {
        playerView.setLoading(true)
        lifecycleScope.launch {
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
                    preparePlayer(mediaSource)
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

    private fun preparePlayer(mediaSource: MediaSource) {
        releasePlayer(savePosition = false)
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
            exo.pause()
        }
        super.onStop()
    }

    override fun onDestroy() {
        releasePlayer(savePosition = true)
        super.onDestroy()
    }

    private fun releasePlayer(savePosition: Boolean) {
        val exo = player ?: return
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
        private const val PLAYER_PREFS = "native_player_positions_v2"
    }
}
