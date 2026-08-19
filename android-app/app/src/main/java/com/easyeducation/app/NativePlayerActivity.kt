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
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.source.MediaSource
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
                when (source) {
                    is OnlineSource.Direct -> {
                        if (source.hls) {
                            val requestProperties = mutableMapOf(
                                "User-Agent" to RUMBLE_USER_AGENT,
                            )
                            source.referer?.takeIf { it.isNotBlank() }?.let { referer ->
                                requestProperties["Referer"] = referer
                                requestProperties["Origin"] = "https://rumble.com"
                            }
                            val dataSourceFactory = DefaultHttpDataSource.Factory()
                                .setAllowCrossProtocolRedirects(true)
                                .setDefaultRequestProperties(requestProperties)
                            val item = MediaItem.Builder()
                                .setUri(source.url)
                                .setMimeType(MimeTypes.APPLICATION_M3U8)
                                .build()
                            val mediaSource = HlsMediaSource.Factory(dataSourceFactory)
                                .createMediaSource(item)
                            preparePlayer(mediaSource = mediaSource)
                        } else {
                            preparePlayer(mediaItem = MediaItem.fromUri(source.url))
                        }
                    }
                    is OnlineSource.RumbleProxy -> {
                        val mediaSource = ProgressiveMediaSource.Factory(
                            RumbleProxyDataSource.Factory(
                                classId = source.classId,
                                height = source.height,
                                totalBytes = source.totalBytes,
                                downloadToken = source.downloadToken,
                            ),
                        ).createMediaSource(
                            MediaItem.fromUri(Uri.parse("rumble-proxy://easy-education/${source.classId}/${source.height}")),
                        )
                        preparePlayer(mediaSource = mediaSource)
                    }
                }
            }.onFailure { fail(it.message ?: "Could not open this class video") }
        }
    }

    private sealed interface OnlineSource {
        data class Direct(
            val url: String,
            val hls: Boolean = false,
            val referer: String? = null,
        ) : OnlineSource

        data class RumbleProxy(
            val classId: String,
            val height: Int,
            val totalBytes: Long,
            val downloadToken: String,
        ) : OnlineSource
    }

    private fun resolveOnlineSource(classId: String, sourceUrl: String, requestedHeight: Int): OnlineSource {
        return when {
            YoutubeDeviceResolver.isYoutubeUrl(sourceUrl) -> {
                val (_, format) = YoutubeDeviceResolver().pickFormat(sourceUrl, requestedHeight)
                OnlineSource.Direct(format.url, false)
            }
            isRumblePage(sourceUrl) -> resolveRumbleSource(classId, sourceUrl, requestedHeight)
            sourceUrl.contains(".m3u8", ignoreCase = true) -> OnlineSource.Direct(sourceUrl, true)
            else -> OnlineSource.Direct(sourceUrl, false)
        }
    }

    private fun resolveRumbleSource(classId: String, sourceUrl: String, requestedHeight: Int): OnlineSource {
        val user = FirebaseAuth.getInstance().currentUser ?: error("Please sign in again")
        val token = Tasks.await(user.getIdToken(false)).token ?: error("Could not verify your session")
        val url = APP_ORIGIN + "/api/offline-video?options=1" +
            "&classId=${Uri.encode(classId)}&videoUrl=${Uri.encode(sourceUrl)}"
        val http = OkHttpClient.Builder()
            .connectTimeout(12, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
        val payload = http.newCall(
            Request.Builder().url(url).header("Authorization", "Bearer $token").build(),
        ).execute().use { response ->
            if (!response.isSuccessful) {
                val message = runCatching {
                    JSONObject(response.body?.string().orEmpty()).optString("error")
                }.getOrNull()
                error(message?.takeIf { it.isNotBlank() } ?: "Rumble video authorization failed (${response.code})")
            }
            JSONObject(response.body?.string().orEmpty())
        }
        val options = payload.optJSONArray("options") ?: error("No Rumble stream qualities are available")

        data class HlsChoice(val height: Int, val url: String)
        data class Mp4Choice(val height: Int, val bytes: Long)
        val hls = mutableListOf<HlsChoice>()
        val mp4 = mutableListOf<Mp4Choice>()
        for (index in 0 until options.length()) {
            val item = options.optJSONObject(index) ?: continue
            val height = item.optInt("height", 0)
            if (height <= 0) continue
            when (item.optString("kind")) {
                "hls" -> item.optString("playlistUrl")
                    .takeIf { it.isNotBlank() }
                    ?.let { hls += HlsChoice(height, it) }
                "mp4" -> item.optLong("contentLength", 0L)
                    .takeIf { it > 0L }
                    ?.let { mp4 += Mp4Choice(height, it) }
            }
        }

        fun <T> choose(items: List<T>, heightOf: (T) -> Int): T? {
            return items.firstOrNull { heightOf(it) == requestedHeight }
                ?: items.filter { heightOf(it) <= requestedHeight }.maxByOrNull(heightOf)
                ?: items.minByOrNull(heightOf)
        }

        choose(hls) { it.height }?.let { selected ->
            return OnlineSource.Direct(
                url = selected.url,
                hls = true,
                referer = sourceUrl,
            )
        }

        val selectedMp4 = choose(mp4) { it.height }
            ?: error("Rumble did not expose a native HLS or progressive stream")
        val downloadToken = payload.optString("downloadToken")
        require(downloadToken.isNotBlank()) { "Rumble playback authorization expired. Reopen the class." }
        return OnlineSource.RumbleProxy(
            classId = classId,
            height = selectedMp4.height,
            totalBytes = selectedMp4.bytes,
            downloadToken = downloadToken,
        )
    }

    private fun preparePlayer(mediaItem: MediaItem? = null, mediaSource: MediaSource? = null) {
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
        private const val RUMBLE_USER_AGENT =
            "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36"
    }
}
