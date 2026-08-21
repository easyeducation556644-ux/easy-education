package com.easyeducation.app

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.util.AttributeSet
import android.view.View
import android.view.animation.PathInterpolator
import kotlin.math.min

/**
 * Lightweight quick-seek feedback shared by online and downloaded playback.
 *
 * The supplied YouTube build uses a directional rounded overlay, three arrows and a duration label.
 * This clean-room view keeps those observable interaction cues while using original drawing code
 * and a full-height grey surface that remains legible over both bright and dark video.
 */
class YoutubeQuickSeekFeedbackView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : View(context, attrs) {
    private val density = resources.displayMetrics.density
    private val scaledDensity = resources.displayMetrics.scaledDensity
    private val backgroundPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val arrowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        style = Paint.Style.FILL
    }
    private val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textSize = 13.5f * scaledDensity
        textAlign = Paint.Align.CENTER
        typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD)
        setShadowLayer(3f * density, 0f, 1f * density, 0xA0000000.toInt())
    }
    private val arrow = Path()
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
        val entering = visibility != VISIBLE || alpha <= 0.05f
        visibility = VISIBLE
        invalidate()
        if (entering) {
            alpha = 0f
            scaleX = 0.975f
            scaleY = 0.975f
            animate()
                .alpha(1f)
                .scaleX(1f)
                .scaleY(1f)
                .setInterpolator(ENTER_EASING)
                .setDuration(130L)
                .start()
        } else {
            // Continued taps update the number without replaying a zero-alpha flash.
            alpha = 1f
            scaleX = 1.012f
            scaleY = 1.012f
            animate()
                .scaleX(1f)
                .scaleY(1f)
                .setInterpolator(ENTER_EASING)
                .setDuration(95L)
                .start()
        }
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

        val left = if (direction < 0) -width * 0.18f else width * 0.50f
        val right = if (direction < 0) width * 0.50f else width * 1.18f
        val top = 0f
        val bottom = height.toFloat()
        backgroundPaint.color = 0x913A3A3A.toInt()
        canvas.drawRoundRect(left, top, right, bottom, height * 0.46f, height * 0.46f, backgroundPaint)

        val centerX = if (direction < 0) width * 0.235f else width * 0.765f
        val centerY = height * 0.43f
        val arrowHeight = min(12f * density, height * 0.072f).coerceAtLeast(7f * density)
        val spacing = arrowHeight * 1.22f
        val alphas = if (direction < 0) intArrayOf(255, 165, 90) else intArrayOf(90, 165, 255)
        for (index in 0..2) {
            val offset = (index - 1) * spacing
            drawArrow(canvas, centerX + offset, centerY, arrowHeight, alphas[index])
        }

        val label = "$seconds seconds"
        val baseline = centerY + min(48f * density, height * 0.20f) -
            (labelPaint.ascent() + labelPaint.descent()) / 2f
        canvas.drawText(label, centerX, baseline, labelPaint)
    }

    private fun drawArrow(canvas: Canvas, centerX: Float, centerY: Float, size: Float, alpha: Int) {
        arrow.reset()
        if (direction > 0) {
            arrow.moveTo(centerX - size * 0.54f, centerY - size)
            arrow.lineTo(centerX + size * 0.66f, centerY)
            arrow.lineTo(centerX - size * 0.54f, centerY + size)
        } else {
            arrow.moveTo(centerX + size * 0.54f, centerY - size)
            arrow.lineTo(centerX - size * 0.66f, centerY)
            arrow.lineTo(centerX + size * 0.54f, centerY + size)
        }
        arrow.close()
        arrowPaint.alpha = alpha
        canvas.drawPath(arrow, arrowPaint)
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
