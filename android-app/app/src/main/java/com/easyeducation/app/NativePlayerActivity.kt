package com.easyeducation.app

import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.ui.PlayerView
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.net.URI
import java.util.concurrent.TimeUnit

@UnstableApi
class NativePlayerActivity : AppCompatActivity() {
    private var player: ExoPlayer? = null
    private lateinit var playerView: PlayerView
    private var progressKey: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        playerView = PlayerView(this).apply {
            useController = true
            keepScreenOn = true
        }
        setContentView(playerView)

        val downloadId = intent.getStringExtra(EXTRA_DOWNLOAD_ID).orEmpty()
        val sourceUrl = intent.getStringExtra(EXTRA_SOURCE_URL).orEmpty()
        val classId = intent.getStringExtra(EXTRA_CLASS_ID).orEmpty()
        val requestedHeight = intent.getIntExtra(EXTRA_HEIGHT, 480)
        progressKey = "class:$classId"

        if (downloadId.isNotBlank()) playOffline(downloadId)
        else if (sourceUrl.isNotBlank()) playOnline(classId, sourceUrl, requestedHeight)
        else fail("Video source is unavailable")
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
        val mediaSource = ProgressiveMediaSource.Factory(
            SecureChunkDataSource.Factory(this, downloadId, uid),
        ).createMediaSource(MediaItem.fromUri(Uri.parse("secure://easy-education/$downloadId")))
        preparePlayer(mediaSource = mediaSource)
    }

    private fun playOnline(classId: String, sourceUrl: String, requestedHeight: Int) {
        lifecycleScope.launch {
            val resolved = withContext(Dispatchers.IO) {
                runCatching { resolveOnlineSource(classId, sourceUrl, requestedHeight) }
            }
            resolved.onSuccess { source ->
                val itemBuilder = MediaItem.Builder().setUri(source.url)
                if (source.hls) itemBuilder.setMimeType(MimeTypes.APPLICATION_M3U8)
                preparePlayer(mediaItem = itemBuilder.build())
            }.onFailure { fail(it.message ?: "Could not open this class video") }
        }
    }

    private data class OnlineSource(val url: String, val hls: Boolean = false)

    private fun resolveOnlineSource(classId: String, sourceUrl: String, requestedHeight: Int): OnlineSource {
        return when {
            YoutubeDeviceResolver.isYoutubeUrl(sourceUrl) -> {
                val (_, format) = YoutubeDeviceResolver().pickFormat(sourceUrl, requestedHeight)
                OnlineSource(format.url, false)
            }
            isRumblePage(sourceUrl) -> resolveRumbleHls(classId, sourceUrl, requestedHeight)
            sourceUrl.contains(".m3u8", ignoreCase = true) -> OnlineSource(sourceUrl, true)
            else -> OnlineSource(sourceUrl, false)
        }
    }

    private fun resolveRumbleHls(classId: String, sourceUrl: String, requestedHeight: Int): OnlineSource {
        val user = FirebaseAuth.getInstance().currentUser ?: error("Please sign in again")
        val token = Tasks.await(user.getIdToken(false)).token ?: error("Could not verify your session")
        val url = APP_ORIGIN + "/api/offline-video?options=1" +
            "&classId=${Uri.encode(classId)}&videoUrl=${Uri.encode(sourceUrl)}"
        val http = OkHttpClient.Builder()
            .connectTimeout(12, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()
        val payload = http.newCall(
            Request.Builder().url(url).header("Authorization", "Bearer $token").build(),
        ).execute().use { response ->
            if (!response.isSuccessful) error("Video authorization failed (${response.code})")
            JSONObject(response.body?.string().orEmpty())
        }
        val options = payload.optJSONArray("options") ?: error("No stream qualities are available")
        val candidates = buildList {
            for (index in 0 until options.length()) {
                val item = options.optJSONObject(index) ?: continue
                if (item.optString("kind") != "hls") continue
                val playlist = item.optString("playlistUrl")
                val height = item.optInt("height")
                if (playlist.isNotBlank() && height > 0) add(height to playlist)
            }
        }
        val selected = candidates.filter { it.first <= requestedHeight }.maxByOrNull { it.first }
            ?: candidates.minByOrNull { it.first }
            ?: error("Native stream is unavailable for this Rumble class")
        return OnlineSource(selected.second, true)
    }

    private fun preparePlayer(mediaItem: MediaItem? = null, mediaSource: androidx.media3.exoplayer.source.MediaSource? = null) {
        releasePlayer(savePosition = false)
        val exo = ExoPlayer.Builder(this).build()
        player = exo
        playerView.player = exo
        if (mediaSource != null) exo.setMediaSource(mediaSource)
        else if (mediaItem != null) exo.setMediaItem(mediaItem)
        val saved = getSharedPreferences(PLAYER_PREFS, MODE_PRIVATE).getLong(progressKey, 0L)
        exo.prepare()
        if (saved > 0) exo.seekTo(saved)
        exo.playWhenReady = true
    }

    private fun fail(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
        finish()
    }

    override fun onStop() {
        player?.let { exo ->
            if (progressKey.isNotBlank() && exo.currentPosition > 0) {
                getSharedPreferences(PLAYER_PREFS, MODE_PRIVATE)
                    .edit()
                    .putLong(progressKey, exo.currentPosition)
                    .apply()
            }
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
        if (savePosition && progressKey.isNotBlank() && exo.currentPosition > 0) {
            getSharedPreferences(PLAYER_PREFS, MODE_PRIVATE)
                .edit()
                .putLong(progressKey, exo.currentPosition)
                .apply()
        }
        playerView.player = null
        exo.release()
        player = null
    }

    private fun isRumblePage(value: String): Boolean = runCatching {
        val host = URI(value).host?.lowercase().orEmpty()
        host == "rumble.com" || host.endsWith(".rumble.com")
    }.getOrDefault(false)

    companion object {
        const val EXTRA_DOWNLOAD_ID = "download_id"
        const val EXTRA_SOURCE_URL = "source_url"
        const val EXTRA_CLASS_ID = "class_id"
        const val EXTRA_HEIGHT = "height"
        private const val PLAYER_PREFS = "native_player_positions_v2"
        private const val APP_ORIGIN = "https://easy-education.vercel.app"
    }
}
