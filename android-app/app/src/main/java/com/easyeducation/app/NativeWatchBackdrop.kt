package com.easyeducation.app

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import java.lang.ref.WeakReference
import kotlin.math.roundToInt

/**
 * Keeps a small, short-lived snapshot of the page that opened a class.
 *
 * Compose Navigation does not keep the previous destination drawn after the watch destination has
 * settled. YouTube's watch page is layered above its previous page, however, so a minimize gesture
 * can reveal that page immediately. This snapshot supplies the same visual layer during the gesture
 * and is removed as soon as the real previous destination is visible again.
 */
object NativeWatchBackdrop {
    private var bitmap: Bitmap? = null
    private var owner = WeakReference<Activity>(null)
    private var attachedView = WeakReference<ImageView>(null)

    /** Capture only the app's Compose root, never a floating player/overlay added above it. */
    fun capture(context: Context) {
        val activity = context.findActivity() ?: return
        val root = activity.findViewById<FrameLayout>(android.R.id.content) ?: return
        val page = root.getChildAtOrNull(0) ?: return
        if (page.width <= 0 || page.height <= 0) return

        detach(clearSnapshot = true)
        val scale = minOf(1f, MAX_CAPTURE_WIDTH_PX / page.width.toFloat())
        val targetWidth = (page.width * scale).roundToInt().coerceAtLeast(1)
        val targetHeight = (page.height * scale).roundToInt().coerceAtLeast(1)
        val captured = runCatching {
            Bitmap.createBitmap(targetWidth, targetHeight, Bitmap.Config.ARGB_8888).also { image ->
                Canvas(image).apply {
                    scale(scale, scale)
                    page.draw(this)
                }
            }
        }.getOrNull() ?: return

        bitmap = captured
        owner = WeakReference(activity)
    }

    /** Place the captured page immediately below the live Compose page being minimized. */
    fun attachBelow(activity: Activity, page: View): View? {
        val captured = bitmap ?: return null
        if (owner.get() !== activity || captured.isRecycled) return null
        val root = activity.findViewById<FrameLayout>(android.R.id.content) ?: return null

        attachedView.get()?.let { old -> (old.parent as? ViewGroup)?.removeView(old) }
        val backdrop = ImageView(activity).apply {
            setImageBitmap(captured)
            scaleType = ImageView.ScaleType.FIT_XY
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            isClickable = false
            isFocusable = false
        }
        val pageIndex = root.indexOfChild(page).takeIf { it >= 0 } ?: 0
        root.addView(
            backdrop,
            pageIndex,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        attachedView = WeakReference(backdrop)
        return backdrop
    }

    fun detach(clearSnapshot: Boolean = false) {
        attachedView.get()?.let { view -> (view.parent as? ViewGroup)?.removeView(view) }
        attachedView.clear()
        if (clearSnapshot) {
            bitmap?.takeUnless(Bitmap::isRecycled)?.recycle()
            bitmap = null
            owner.clear()
        }
    }

    fun clear() = detach(clearSnapshot = true)

    private fun ViewGroup.getChildAtOrNull(index: Int): View? =
        if (index in 0 until childCount) getChildAt(index) else null

    private fun Context.findActivity(): Activity? {
        var current: Context? = this
        while (current is ContextWrapper) {
            if (current is Activity) return current
            current = current.baseContext
        }
        return current as? Activity
    }

    private const val MAX_CAPTURE_WIDTH_PX = 720f
}
