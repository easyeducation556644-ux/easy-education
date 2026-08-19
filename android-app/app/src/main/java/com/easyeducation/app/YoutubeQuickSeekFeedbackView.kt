package com.easyeducation.app

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Shader
import android.util.AttributeSet
import android.view.View
import android.view.animation.PathInterpolator
import kotlin.math.min

/**
 * Lightweight quick-seek feedback shared by online and downloaded playback.
 *
 * The supplied YouTube build uses a low-opacity white bloom, three directional chevrons and a
 * duration label. This clean-room view keeps those observable interaction cues while using our own
 * drawing code and a softer rounded grey fade that remains legible over both bright and dark video.
 */
class YoutubeQuickSeekFeedbackView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : View(context, attrs) {
    private val density = resources.displayMetrics.density
    private val scaledDensity = resources.displayMetrics.scaledDensity
    private val backgroundPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val chevronPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        style = Paint.Style.STROKE
        strokeWidth = 2.2f * density
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textSize = 13.5f * scaledDensity
        textAlign = Paint.Align.CENTER
        typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD)
        setShadowLayer(3f * density, 0f, 1f * density, 0xA0000000.toInt())
    }
    private val chevron = Path()
    private var direction = 1
    private var seconds = 10
    private val fadeOut = Runnable {
        animate().cancel()
        animate()
            .alpha(0f)
            .scaleX(1.025f)
            .scaleY(1.025f)
            .setInterpolator(FADE_EASING)
            .setDuration(210L)
            .withEndAction {
                visibility = INVISIBLE
                scaleX = 1f
                scaleY = 1f
            }
            .start()
    }

    init {
        visibility = INVISIBLE
        alpha = 0f
        isClickable = false
        isFocusable = false
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
        setLayerType(LAYER_TYPE_SOFTWARE, null)
    }

    fun show(direction: Int, seconds: Int) {
        this.direction = if (direction < 0) -1 else 1
        this.seconds = seconds.coerceAtLeast(10)
        contentDescription = if (this.direction < 0) {
            "Rewind ${this.seconds} seconds"
        } else {
            "Forward ${this.seconds} seconds"
        }
        removeCallbacks(fadeOut)
        animate().cancel()
        visibility = VISIBLE
        alpha = 0f
        scaleX = 0.965f
        scaleY = 0.965f
        invalidate()
        animate()
            .alpha(1f)
            .scaleX(1f)
            .scaleY(1f)
            .setInterpolator(ENTER_EASING)
            .setDuration(115L)
            .start()
        postDelayed(fadeOut, HOLD_MS)
        announceForAccessibility(contentDescription)
    }

    fun hideImmediately() {
        removeCallbacks(fadeOut)
        animate().cancel()
        visibility = INVISIBLE
        alpha = 0f
        scaleX = 1f
        scaleY = 1f
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (width <= 0 || height <= 0) return

        val left = if (direction < 0) -width * 0.08f else width * 0.53f
        val right = if (direction < 0) width * 0.47f else width * 1.08f
        val top = height * 0.10f
        val bottom = height * 0.90f
        val colors = if (direction < 0) {
            intArrayOf(0x4AFFFFFF, 0x2EFFFFFF, 0x12FFFFFF, Color.TRANSPARENT)
        } else {
            intArrayOf(Color.TRANSPARENT, 0x12FFFFFF, 0x2EFFFFFF, 0x4AFFFFFF)
        }
        backgroundPaint.shader = LinearGradient(left, 0f, right, 0f, colors, null, Shader.TileMode.CLAMP)
        canvas.drawRoundRect(left, top, right, bottom, (bottom - top) * 0.48f, (bottom - top) * 0.48f, backgroundPaint)
        backgroundPaint.shader = null

        val centerX = if (direction < 0) width * 0.235f else width * 0.765f
        val centerY = height * 0.43f
        val arrowHeight = min(9f * density, height * 0.055f).coerceAtLeast(5f * density)
        val spacing = arrowHeight * 1.15f
        val alphas = if (direction < 0) intArrayOf(255, 165, 90) else intArrayOf(90, 165, 255)
        for (index in 0..2) {
            val offset = (index - 1) * spacing
            drawChevron(canvas, centerX + offset, centerY, arrowHeight, alphas[index])
        }

        val label = "$seconds seconds"
        val baseline = height * 0.655f - (labelPaint.ascent() + labelPaint.descent()) / 2f
        canvas.drawText(label, centerX, baseline, labelPaint)
    }

    private fun drawChevron(canvas: Canvas, centerX: Float, centerY: Float, size: Float, alpha: Int) {
        chevron.reset()
        if (direction > 0) {
            chevron.moveTo(centerX - size * 0.55f, centerY - size)
            chevron.lineTo(centerX + size * 0.40f, centerY)
            chevron.lineTo(centerX - size * 0.55f, centerY + size)
        } else {
            chevron.moveTo(centerX + size * 0.55f, centerY - size)
            chevron.lineTo(centerX - size * 0.40f, centerY)
            chevron.lineTo(centerX + size * 0.55f, centerY + size)
        }
        chevronPaint.alpha = alpha
        canvas.drawPath(chevron, chevronPaint)
    }

    override fun onDetachedFromWindow() {
        removeCallbacks(fadeOut)
        animate().cancel()
        super.onDetachedFromWindow()
    }

    companion object {
        private const val HOLD_MS = 620L
        private val ENTER_EASING = PathInterpolator(0.2f, 0f, 0f, 1f)
        private val FADE_EASING = PathInterpolator(0.4f, 0f, 1f, 1f)
    }
}
