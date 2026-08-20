package com.easyeducation.app

import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebView

class EasyEducationApplication : Application(), Application.ActivityLifecycleCallbacks {
    override fun onCreate() {
        super.onCreate()
        CookieManager.getInstance().setAcceptCookie(true)
        registerActivityLifecycleCallbacks(this)
    }

    private fun configureEmbeddedMedia(view: View?) {
        when (view) {
            is WebView -> {
                val cookies = CookieManager.getInstance()
                cookies.setAcceptCookie(true)
                cookies.setAcceptThirdPartyCookies(view, true)
                view.settings.mediaPlaybackRequiresUserGesture = false
                if (view.webViewClient !is RumbleFixingWebViewClient) {
                    view.webViewClient = RumbleFixingWebViewClient(view.webViewClient)
                }
            }
            is ViewGroup -> {
                for (index in 0 until view.childCount) {
                    configureEmbeddedMedia(view.getChildAt(index))
                }
            }
        }
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {
        configureEmbeddedMedia(activity.window?.decorView)
    }

    override fun onActivityResumed(activity: Activity) {
        configureEmbeddedMedia(activity.window?.decorView)
    }

    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit
}
