@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.easyeducation.app

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Topic
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.exoplayer.ExoPlayer
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.concurrent.ConcurrentHashMap

/**
 * One CPS topic model is reused by the watch-page action, description, portrait player label and
 * fullscreen right-side drawer. The timestamp is always interpreted as seconds from the class video.
 */
data class NativePlayerTopic(
    val id: String,
    val title: String,
    val seconds: Int,
)

object NativePlayerTopics {
    private const val PLAYER_PREFS = "native_player_positions_v2"
    private const val TOPIC_CHIP_TAG = "easy-education-player-topic-chip"
    private const val FULLSCREEN_DRAWER_TAG = "easy-education-fullscreen-topics"

    private val sheetRequestMutable = MutableStateFlow<String?>(null)
    val sheetRequest = sheetRequestMutable.asStateFlow()
    private val chipControllers = ConcurrentHashMap<YoutubeStylePlayerView, TopicChipController>()

    fun topics(classId: String): List<NativePlayerTopic> {
        if (classId.isBlank()) return emptyList()
        return NativeCpsAcademicStore.bundles.value.values
            .asSequence()
            .flatMap { it.topics.asSequence() }
            .filter { it.classId == classId }
            .sortedBy { it.videoTimestamp }
            .distinctBy { "${it.videoTimestamp}:${it.title}" }
            .map { NativePlayerTopic(it.id, it.title.ifBlank { "Topic" }, it.videoTimestamp.coerceAtLeast(0)) }
            .toList()
    }

    fun requestSheet(classId: String) {
        if (classId.isNotBlank()) sheetRequestMutable.value = classId
    }

    fun consumeSheet(classId: String) {
        if (sheetRequestMutable.value == classId) sheetRequestMutable.value = null
    }

    fun seek(context: Context, classId: String, seconds: Int) {
        val ms = seconds.coerceAtLeast(0).toLong() * 1000L
        context.applicationContext.getSharedPreferences(PLAYER_PREFS, Context.MODE_PRIVATE)
            .edit().putLong("class:$classId", ms).apply()
        if (PersistentNativePlayer.currentClassId() == classId) {
            runCatching { PersistentNativePlayer.player(context).seekTo(ms) }
        }
    }

    fun current(topics: List<NativePlayerTopic>, positionMs: Long): NativePlayerTopic? {
        if (topics.isEmpty()) return null
        val positionSeconds = (positionMs.coerceAtLeast(0L) / 1000L).toInt()
        return topics.lastOrNull { it.seconds <= positionSeconds }
    }

    fun attachToSurface(surface: YoutubeStylePlayerView, player: ExoPlayer, fallbackClassId: String) {
        val existing = chipControllers[surface]
        if (existing != null) {
            existing.bind(player, fallbackClassId)
            return
        }
        val controller = TopicChipController(surface, player, fallbackClassId)
        chipControllers[surface] = controller
        controller.start()
    }

    private class TopicChipController(
        private val surface: YoutubeStylePlayerView,
        player: ExoPlayer,
        fallbackClassId: String,
    ) {
        private val handler = Handler(Looper.getMainLooper())
        private var player: ExoPlayer = player
        private var fallbackClassId: String = fallbackClassId
        private val chip: TextView = TextView(surface.context).apply {
            tag = TOPIC_CHIP_TAG
            textSize = 11.5f
            setTextColor(Color.WHITE)
            setTypeface(typeface, Typeface.BOLD)
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), 0, dp(10), 0)
            background = GradientDrawable().apply {
                setColor(0xC41B1B1B.toInt())
                cornerRadius = dp(999).toFloat()
                setStroke(dp(1), 0x55FFFFFF)
            }
            visibility = View.GONE
        }

        private val updater = object : Runnable {
            override fun run() {
                val activeId = PersistentNativePlayer.currentClassId().ifBlank { fallbackClassId }
                val rows = topics(activeId)
                val running = current(rows, player.currentPosition)
                if (running == null) {
                    chip.visibility = View.GONE
                } else {
                    chip.text = running.title
                    chip.contentDescription = "Current topic ${running.title}. Open topics"
                    chip.visibility = View.VISIBLE
                }
                handler.postDelayed(this, 250L)
            }
        }

        init {
            val params = FrameLayout.LayoutParams(dp(220), dp(34), Gravity.BOTTOM or Gravity.START).apply {
                leftMargin = dp(118)
                bottomMargin = dp(4)
            }
            surface.addView(chip, params)
            chip.bringToFront()
            chip.setOnClickListener {
                val activeId = PersistentNativePlayer.currentClassId().ifBlank { fallbackClassId }
                val rows = topics(activeId)
                if (rows.isEmpty()) return@setOnClickListener
                val activity = surface.context.findTopicActivity() ?: return@setOnClickListener
                val fullscreen = activity.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE ||
                    surface.width > surface.height * 13 / 10
                if (fullscreen) showFullscreenDrawer(activity, activeId, player)
                else requestSheet(activeId)
            }
        }

        fun bind(newPlayer: ExoPlayer, newFallbackClassId: String) {
            player = newPlayer
            fallbackClassId = newFallbackClassId
            chip.bringToFront()
        }

        fun start() {
            handler.removeCallbacks(updater)
            handler.post(updater)
        }

        private fun dp(value: Int): Int = (value * surface.resources.displayMetrics.density + 0.5f).toInt()
    }

    private fun showFullscreenDrawer(activity: Activity, classId: String, player: ExoPlayer) {
        val root = activity.findViewById<FrameLayout>(android.R.id.content) ?: return
        root.findViewWithTag<View>(FULLSCREEN_DRAWER_TAG)?.let { old ->
            (old.parent as? ViewGroup)?.removeView(old)
        }
        val rows = topics(classId)
        if (rows.isEmpty()) return
        val density = activity.resources.displayMetrics.density
        fun dp(value: Int) = (value * density + 0.5f).toInt()

        val overlay = FrameLayout(activity).apply {
            tag = FULLSCREEN_DRAWER_TAG
            isClickable = true
            setBackgroundColor(0x33000000)
        }
        val panel = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(12))
            background = GradientDrawable().apply {
                setColor(0xF51A1A1A.toInt())
                cornerRadii = floatArrayOf(
                    dp(18).toFloat(), dp(18).toFloat(),
                    0f, 0f,
                    0f, 0f,
                    dp(18).toFloat(), dp(18).toFloat(),
                )
            }
            isClickable = true
        }
        val width = minOf(
            dp(390),
            (activity.resources.displayMetrics.widthPixels * 0.44f).toInt().coerceAtLeast(dp(300)),
        )
        overlay.addView(panel, FrameLayout.LayoutParams(width, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.END))

        val header = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        header.addView(
            TextView(activity).apply {
                text = "Topics"
                textSize = 20f
                setTextColor(Color.WHITE)
                setTypeface(typeface, Typeface.BOLD)
            },
            LinearLayout.LayoutParams(0, dp(46), 1f),
        )
        val close = TextView(activity).apply {
            text = "✕"
            textSize = 22f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            setOnClickListener { closeFullscreenDrawer(overlay, panel) }
        }
        header.addView(close, LinearLayout.LayoutParams(dp(48), dp(46)))
        panel.addView(header)

        val scroll = ScrollView(activity)
        val list = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        scroll.addView(list, ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        panel.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        val rowViews = rows.map { topic ->
            TextView(activity).apply {
                textSize = 14f
                setTextColor(Color.WHITE)
                maxLines = 3
                setPadding(dp(12), dp(11), dp(12), dp(11))
                text = "${formatTopicTime(topic.seconds)}   ${topic.title}"
                setOnClickListener { seek(activity, classId, topic.seconds) }
                list.addView(
                    this,
                    LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                        bottomMargin = dp(5)
                    },
                )
            }
        }

        val handler = Handler(Looper.getMainLooper())
        val updateSelection = object : Runnable {
            override fun run() {
                val selected = current(rows, player.currentPosition)
                rowViews.forEachIndexed { index, view ->
                    val row = rows[index]
                    val active = selected != null && row.id == selected.id && row.seconds == selected.seconds
                    view.background = GradientDrawable().apply {
                        setColor(if (active) 0xFF4C4168.toInt() else 0xFF262626.toInt())
                        cornerRadius = dp(12).toFloat()
                    }
                    view.setTypeface(view.typeface, if (active) Typeface.BOLD else Typeface.NORMAL)
                }
                if (overlay.parent != null) handler.postDelayed(this, 250L)
            }
        }
        handler.post(updateSelection)
        overlay.setOnClickListener { closeFullscreenDrawer(overlay, panel) }
        panel.setOnClickListener { }
        root.addView(overlay, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        overlay.bringToFront()
        panel.post {
            panel.translationX = panel.width.toFloat().coerceAtLeast(width.toFloat())
            panel.animate().translationX(0f).setDuration(240L).start()
        }
    }

    private fun closeFullscreenDrawer(overlay: FrameLayout, panel: View) {
        panel.animate().translationX(panel.width.toFloat()).setDuration(210L).withEndAction {
            (overlay.parent as? ViewGroup)?.removeView(overlay)
        }.start()
    }

    fun formatTopicTime(seconds: Int): String {
        val safe = seconds.coerceAtLeast(0)
        val hours = safe / 3600
        val minutes = (safe % 3600) / 60
        val secs = safe % 60
        return if (hours > 0) "%d:%02d:%02d".format(hours, minutes, secs)
        else "%02d:%02d".format(minutes, secs)
    }
}

@Composable
fun NativeClassTopicsAction(classId: String) {
    val bundles by NativeCpsAcademicStore.bundles.collectAsStateWithLifecycle()
    val request by NativePlayerTopics.sheetRequest.collectAsStateWithLifecycle()
    val context = androidx.compose.ui.platform.LocalContext.current
    val topics = remember(bundles, classId) { NativePlayerTopics.topics(classId) }
    var sheetOpen by remember(classId) { mutableStateOf(false) }
    var position by remember(classId) { mutableLongStateOf(0L) }

    LaunchedEffect(request, classId, topics.size) {
        if (request == classId && topics.isNotEmpty()) {
            sheetOpen = true
            NativePlayerTopics.consumeSheet(classId)
        }
    }
    LaunchedEffect(sheetOpen, classId) {
        while (sheetOpen) {
            if (PersistentNativePlayer.currentClassId() == classId) {
                position = PersistentNativePlayer.player(context).currentPosition
            }
            delay(250L)
        }
    }
    if (topics.isEmpty()) return

    Surface(
        modifier = Modifier.clickable { sheetOpen = true },
        shape = RoundedCornerShape(999.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Row(
            Modifier.padding(horizontal = 15.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            Icon(Icons.Default.Topic, null, Modifier.size(20.dp))
            Text("Topics", fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelLarge)
        }
    }

    if (sheetOpen) {
        ModalBottomSheet(onDismissRequest = { sheetOpen = false }) {
            TopicSheetContent(topics, position) { topic ->
                NativePlayerTopics.seek(context, classId, topic.seconds)
            }
        }
    }
}

@Composable
private fun TopicSheetContent(
    topics: List<NativePlayerTopic>,
    positionMs: Long,
    onTopic: (NativePlayerTopic) -> Unit,
) {
    val running = NativePlayerTopics.current(topics, positionMs)
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 18.dp).padding(bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("Topics", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text("Jump to a topic in this class", color = MaterialTheme.colorScheme.onSurfaceVariant)
        topics.forEach { topic ->
            val selected = running != null && running.id == topic.id && running.seconds == topic.seconds
            Surface(
                modifier = Modifier.fillMaxWidth().clickable { onTopic(topic) },
                shape = RoundedCornerShape(14.dp),
                color = if (selected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceVariant,
                border = if (selected) BorderStroke(1.dp, MaterialTheme.colorScheme.primary) else null,
            ) {
                Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        NativePlayerTopics.formatTopicTime(topic.seconds),
                        fontWeight = FontWeight.ExtraBold,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Spacer(Modifier.width(12.dp))
                    Text(
                        topic.title,
                        Modifier.weight(1f),
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                        fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                    )
                    Icon(Icons.Default.PlayArrow, null, Modifier.size(18.dp))
                }
            }
        }
    }
}

@Composable
fun NativeClassTopicsDescription(classId: String) {
    val bundles by NativeCpsAcademicStore.bundles.collectAsStateWithLifecycle()
    val context = androidx.compose.ui.platform.LocalContext.current
    val topics = remember(bundles, classId) { NativePlayerTopics.topics(classId) }
    if (topics.isEmpty()) return
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 18.dp)) {
        Text("Topics", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        topics.forEach { topic ->
            Row(
                Modifier.fillMaxWidth()
                    .clickable { NativePlayerTopics.seek(context, classId, topic.seconds) }
                    .padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    NativePlayerTopics.formatTopicTime(topic.seconds),
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.width(12.dp))
                Text(topic.title, Modifier.weight(1f), maxLines = 3, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

private fun Context.findTopicActivity(): Activity? {
    var current: Context? = this
    while (current is ContextWrapper) {
        if (current is Activity) return current
        current = current.baseContext
    }
    return current as? Activity
}
