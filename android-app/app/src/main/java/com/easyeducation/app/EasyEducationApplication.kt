package com.easyeducation.app

import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import androidx.appcompat.widget.AppCompatImageButton
import com.google.firebase.auth.FirebaseAuth
import java.lang.ref.WeakReference
import java.util.WeakHashMap

class EasyEducationApplication : Application(), Application.ActivityLifecycleCallbacks {
    private var currentActivity = WeakReference<Activity>(null)
    private val layoutListeners = WeakHashMap<Activity, Pair<View, ViewTreeObserver.OnGlobalLayoutListener>>()
    private val authListener = FirebaseAuth.AuthStateListener { auth ->
        currentActivity.get()?.let { activity ->
            NativeCapturePolicy.refreshIfDue(activity, auth.currentUser)
        }
    }

    override fun onCreate() {
        super.onCreate()
        registerActivityLifecycleCallbacks(this)
        FirebaseAuth.getInstance().addAuthStateListener(authListener)
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {
        NativeCapturePolicy.applyCached(activity, FirebaseAuth.getInstance().currentUser)
    }

    override fun onActivityResumed(activity: Activity) {
        currentActivity = WeakReference(activity)
        NativeCapturePolicy.refreshIfDue(activity, FirebaseAuth.getInstance().currentUser)
        installFullscreenExitFixer(activity)
    }

    override fun onActivityPaused(activity: Activity) {
        if (currentActivity.get() === activity) currentActivity.clear()
    }

    override fun onActivityDestroyed(activity: Activity) {
        layoutListeners.remove(activity)?.let { (root, listener) ->
            if (root.viewTreeObserver.isAlive) root.viewTreeObserver.removeOnGlobalLayoutListener(listener)
        }
    }

    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit

    private fun installFullscreenExitFixer(activity: Activity) {
        if (layoutListeners.containsKey(activity)) return
        val root = activity.window.decorView
        val listener = ViewTreeObserver.OnGlobalLayoutListener {
            patchFullscreenPlayers(root)
        }
        root.viewTreeObserver.addOnGlobalLayoutListener(listener)
        layoutListeners[activity] = root to listener
        root.post { patchFullscreenPlayers(root) }
    }

    /**
     * YoutubeStylePlayerView already owns the bottom-right fullscreen control, but historically hid
     * it in fullscreen presentation. Keep that same control visible and turn it into an exit button.
     * This avoids creating another player surface or changing the fullscreen handoff lifecycle.
     */
    private fun patchFullscreenPlayers(view: View) {
        if (view is YoutubeStylePlayerView) patchPlayer(view)
        if (view is ViewGroup) {
            for (index in 0 until view.childCount) patchFullscreenPlayers(view.getChildAt(index))
        }
    }

    private fun patchPlayer(player: YoutubeStylePlayerView) {
        val buttons = mutableListOf<AppCompatImageButton>()
        collectButtons(player, buttons)
        val fullscreenPresentation = buttons.any {
            it.tag != FULLSCREEN_BUTTON_TAG && it.contentDescription?.toString() == "Exit full screen"
        }
        val button = buttons.firstOrNull {
            it.tag == FULLSCREEN_BUTTON_TAG || it.contentDescription?.toString() == "Full screen"
        } ?: return

        if (fullscreenPresentation) {
            button.tag = FULLSCREEN_BUTTON_TAG
            button.setImageResource(R.drawable.ic_player_fullscreen_exit)
            button.contentDescription = "Exit full screen"
            button.visibility = View.VISIBLE
            button.setOnClickListener { player.onExitFullscreenGesture?.invoke() }
        } else if (button.tag == FULLSCREEN_BUTTON_TAG) {
            button.setImageResource(R.drawable.ic_player_fullscreen)
            button.contentDescription = "Full screen"
            button.visibility = View.VISIBLE
            button.tag = null
            button.setOnClickListener { player.onFullscreen?.invoke() }
        }
    }

    private fun collectButtons(view: View, output: MutableList<AppCompatImageButton>) {
        if (view is AppCompatImageButton) output += view
        if (view is ViewGroup) {
            for (index in 0 until view.childCount) collectButtons(view.getChildAt(index), output)
        }
    }

    private companion object {
        const val FULLSCREEN_BUTTON_TAG = "easy_education_fullscreen_exit_button"
    }
}
