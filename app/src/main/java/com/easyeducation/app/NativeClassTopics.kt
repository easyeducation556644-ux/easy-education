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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
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

data class NativePlayerTopic(val id: String, val title: String, val seconds: Int)

object NativePlayerTopics {
    private const val CHIP_TAG = "easy-education-player-topic-chip"
    private const val DRAWER_TAG = "easy-education-fullscreen-topics"
    private val sheetRequestMutable = MutableStateFlow<String?>(null)
    val sheetRequest = sheetRequestMutable.asStateFlow()
    private val controllers = ConcurrentHashMap<YoutubeStylePlayerView, TopicChipController>()

    fun topics(classId: String): List<NativePlayerTopic> = if (classId.isBlank()) emptyList() else
        NativeCpsAcademicStore.bundles.value.values.asSequence()
            .flatMap { it.topics.asSequence() }
            .filter { it.classId == classId }
            .sortedBy { it.videoTimestamp }
            .distinctBy { "${it.videoTimestamp}:${it.title}" }
            .map { NativePlayerTopic(it.id, it.title.ifBlank { "Topic" }, it.videoTimestamp.coerceAtLeast(0)) }
            .toList()

    fun requestSheet(classId: String) { if (classId.isNotBlank()) sheetRequestMutable.value = classId }
    fun consumeSheet(classId: String) { if (sheetRequestMutable.value == classId) sheetRequestMutable.value = null }

    fun seek(context: Context, classId: String, seconds: Int) {
        PersistentNativePlayer.seekToTopic(context, classId, seconds.coerceAtLeast(0).toLong() * 1000L)
    }

    fun current(rows: List<NativePlayerTopic>, positionMs: Long): NativePlayerTopic? {
        val seconds = (positionMs.coerceAtLeast(0L) / 1000L).toInt()
        return rows.lastOrNull { it.seconds <= seconds }
    }

    fun attachToSurface(surface: YoutubeStylePlayerView, player: ExoPlayer, fallbackClassId: String) {
        controllers[surface]?.let { it.bind(player, fallbackClassId); return }
        TopicChipController(surface, player, fallbackClassId).also { controllers[surface] = it; it.start() }
    }

    private class TopicChipController(
        private val surface: YoutubeStylePlayerView,
        private var player: ExoPlayer,
        private var fallbackClassId: String,
    ) {
        private val handler = Handler(Looper.getMainLooper())
        private fun dp(value: Int) = (value * surface.resources.displayMetrics.density + .5f).toInt()
        private val chip = TextView(surface.context).apply {
            tag = CHIP_TAG
            textSize = 11.5f
            setTextColor(Color.WHITE)
            setTypeface(typeface, Typeface.BOLD)
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), 0, dp(10), 0)
            background = GradientDrawable().apply {
                setColor(0xC41B1B1B.toInt()); cornerRadius = dp(999).toFloat(); setStroke(dp(1), 0x55FFFFFF)
            }
            visibility = View.GONE
            isClickable = true
            isFocusable = true
        }
        private val updater = object : Runnable {
            override fun run() {
                val classId = PersistentNativePlayer.currentClassId().ifBlank { fallbackClassId }
                val running = current(topics(classId), player.currentPosition)
                chip.visibility = if (running == null) View.GONE else View.VISIBLE
                if (running != null) {
                    chip.text = running.title
                    chip.contentDescription = "Current topic ${running.title}. Open topics"
                }
                handler.postDelayed(this, 250L)
            }
        }
        init {
            // YoutubeStylePlayerView's controls FrameLayout is child #1. Putting the chip there makes
            // it inherit the exact controls fade. The chip overlaps the seekbar hit-zone so the
            // player's gesture owner yields ACTION_DOWN to this clickable child instead of swallowing it.
            val chrome = surface.getChildAt(1) as? FrameLayout
            val params = FrameLayout.LayoutParams(dp(220), dp(30), Gravity.BOTTOM or Gravity.START).apply {
                leftMargin = dp(118); bottomMargin = dp(43)
            }
            if (chrome != null) chrome.addView(chip, params) else surface.addView(chip, params)
            chip.bringToFront()
            chip.setOnClickListener {
                val classId = PersistentNativePlayer.currentClassId().ifBlank { fallbackClassId }
                if (topics(classId).isEmpty()) return@setOnClickListener
                val activity = surface.context.findTopicActivity() ?: return@setOnClickListener
                val fullscreen = activity.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE || surface.width > surface.height * 13 / 10
                if (fullscreen) showFullscreenDrawer(activity, classId, player) else requestSheet(classId)
            }
        }
        fun bind(nextPlayer: ExoPlayer, nextFallback: String) { player = nextPlayer; fallbackClassId = nextFallback; chip.bringToFront() }
        fun start() { handler.removeCallbacks(updater); handler.post(updater) }
    }

    private fun showFullscreenDrawer(activity: Activity, classId: String, player: ExoPlayer) {
        val root = activity.findViewById<FrameLayout>(android.R.id.content) ?: return
        root.findViewWithTag<View>(DRAWER_TAG)?.let { (it.parent as? ViewGroup)?.removeView(it) }
        val rows = topics(classId)
        if (rows.isEmpty()) return
        val density = activity.resources.displayMetrics.density
        fun dp(value: Int) = (value * density + .5f).toInt()
        val overlay = FrameLayout(activity).apply { tag = DRAWER_TAG; isClickable = true; setBackgroundColor(0x33000000) }
        val panel = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(14), dp(16), dp(12)); isClickable = true
            background = GradientDrawable().apply {
                setColor(0xF51A1A1A.toInt())
                cornerRadii = floatArrayOf(dp(18).toFloat(), dp(18).toFloat(), 0f, 0f, 0f, 0f, dp(18).toFloat(), dp(18).toFloat())
            }
        }
        val width = minOf(dp(390), (activity.resources.displayMetrics.widthPixels * .44f).toInt().coerceAtLeast(dp(300)))
        overlay.addView(panel, FrameLayout.LayoutParams(width, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.END))
        val header = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        header.addView(TextView(activity).apply {
            text = "Topics"; textSize = 20f; setTextColor(Color.WHITE); setTypeface(typeface, Typeface.BOLD)
        }, LinearLayout.LayoutParams(0, dp(46), 1f))
        header.addView(TextView(activity).apply {
            text = "✕"; textSize = 22f; gravity = Gravity.CENTER; setTextColor(Color.WHITE)
            setOnClickListener { closeDrawer(overlay, panel) }
        }, LinearLayout.LayoutParams(dp(48), dp(46)))
        panel.addView(header)
        val scroll = ScrollView(activity).apply { isFillViewport = true }
        val list = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        scroll.addView(list, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        panel.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        val rowViews = rows.map { topic ->
            TextView(activity).apply {
                textSize = 14f; setTextColor(Color.WHITE); maxLines = 3; setPadding(dp(12), dp(11), dp(12), dp(11))
                text = "${formatTopicTime(topic.seconds)}   ${topic.title}"
                setOnClickListener { seek(activity, classId, topic.seconds) }
                list.addView(this, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(5) })
            }
        }
        val handler = Handler(Looper.getMainLooper())
        val selection = object : Runnable {
            override fun run() {
                val activeTopic = current(rows, player.currentPosition)
                rowViews.forEachIndexed { index, view ->
                    val row = rows[index]
                    val active = activeTopic != null && row.id == activeTopic.id && row.seconds == activeTopic.seconds
                    view.background = GradientDrawable().apply { setColor(if (active) 0xFF4C4168.toInt() else 0xFF262626.toInt()); cornerRadius = dp(12).toFloat() }
                    view.setTypeface(view.typeface, if (active) Typeface.BOLD else Typeface.NORMAL)
                }
                if (overlay.parent != null) handler.postDelayed(this, 250L)
            }
        }
        handler.post(selection)
        overlay.setOnClickListener { closeDrawer(overlay, panel) }
        panel.setOnClickListener { }
        root.addView(overlay, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        overlay.bringToFront()
        panel.post { panel.translationX = panel.width.toFloat().coerceAtLeast(width.toFloat()); panel.animate().translationX(0f).setDuration(240L).start() }
    }

    private fun closeDrawer(overlay: FrameLayout, panel: View) {
        panel.animate().translationX(panel.width.toFloat()).setDuration(210L).withEndAction { (overlay.parent as? ViewGroup)?.removeView(overlay) }.start()
    }

    fun formatTopicTime(seconds: Int): String {
        val safe = seconds.coerceAtLeast(0); val h = safe / 3600; val m = (safe % 3600) / 60; val s = safe % 60
        return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%02d:%02d".format(m, s)
    }
}

@Composable
fun NativeClassTopicsAction(classId: String) {
    val bundles by NativeCpsAcademicStore.bundles.collectAsStateWithLifecycle()
    val request by NativePlayerTopics.sheetRequest.collectAsStateWithLifecycle()
    val context = androidx.compose.ui.platform.LocalContext.current
    val rows = remember(bundles, classId) { NativePlayerTopics.topics(classId) }
    var open by remember(classId) { mutableStateOf(false) }
    var position by remember(classId) { mutableLongStateOf(0L) }
    LaunchedEffect(request, classId, rows.size) {
        if (request == classId && rows.isNotEmpty()) { open = true; NativePlayerTopics.consumeSheet(classId) }
    }
    LaunchedEffect(open, classId) {
        while (open) {
            if (PersistentNativePlayer.currentClassId() == classId) position = PersistentNativePlayer.player(context).currentPosition
            delay(250L)
        }
    }
    if (rows.isEmpty()) return
    Surface(Modifier.clickable { open = true }, RoundedCornerShape(999.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
        Row(Modifier.padding(horizontal = 15.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            Icon(Icons.Default.Topic, null, Modifier.size(20.dp)); Text("Topics", fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelLarge)
        }
    }
    if (open) ModalBottomSheet(onDismissRequest = { open = false }) {
        TopicSheet(rows, position) { NativePlayerTopics.seek(context, classId, it.seconds) }
    }
}

@Composable
private fun TopicSheet(rows: List<NativePlayerTopic>, positionMs: Long, onTopic: (NativePlayerTopic) -> Unit) {
    val running = NativePlayerTopics.current(rows, positionMs)
    Column(
        Modifier.fillMaxWidth().heightIn(max = 560.dp).verticalScroll(rememberScrollState())
            .padding(horizontal = 18.dp).padding(bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("Topics", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text("Jump to a topic in this class", color = MaterialTheme.colorScheme.onSurfaceVariant)
        rows.forEach { topic ->
            val selected = running != null && running.id == topic.id && running.seconds == topic.seconds
            Surface(Modifier.fillMaxWidth().clickable { onTopic(topic) }, RoundedCornerShape(14.dp), color = if (selected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceVariant, border = if (selected) BorderStroke(1.dp, MaterialTheme.colorScheme.primary) else null) {
                Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(NativePlayerTopics.formatTopicTime(topic.seconds), fontWeight = FontWeight.ExtraBold, color = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.width(12.dp))
                    Text(topic.title, Modifier.weight(1f), maxLines = 3, overflow = TextOverflow.Ellipsis, fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium)
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
    val rows = remember(bundles, classId) { NativePlayerTopics.topics(classId) }
    if (rows.isEmpty()) return
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 18.dp)) {
        Text("Topics", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        rows.forEach { topic ->
            Row(Modifier.fillMaxWidth().clickable { NativePlayerTopics.seek(context, classId, topic.seconds) }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(NativePlayerTopics.formatTopicTime(topic.seconds), color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                Spacer(Modifier.width(12.dp)); Text(topic.title, Modifier.weight(1f), maxLines = 3, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

private fun Context.findTopicActivity(): Activity? {
    var current: Context? = this
    while (current is ContextWrapper) { if (current is Activity) return current; current = current.baseContext }
    return current as? Activity
}
