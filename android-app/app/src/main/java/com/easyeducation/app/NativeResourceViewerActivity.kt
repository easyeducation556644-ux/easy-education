package com.easyeducation.app

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.AppCompatImageButton

class NativeResourceViewerActivity : AppCompatActivity() {
    private lateinit var webView: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val rawUrl = intent.getStringExtra(EXTRA_URL).orEmpty().trim()
        val uri = runCatching { Uri.parse(rawUrl) }.getOrNull()
        if (uri == null || uri.scheme?.lowercase() !in setOf("http", "https")) {
            Toast.makeText(this, "This resource link cannot be opened.", Toast.LENGTH_LONG).show()
            finish()
            return
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.BLACK)
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(4), dp(6), dp(10), dp(6))
            setBackgroundColor(Color.rgb(20, 20, 20))
        }
        val back = AppCompatImageButton(this).apply {
            setImageResource(R.drawable.ic_player_back)
            contentDescription = "Back"
            setBackgroundColor(Color.TRANSPARENT)
            setColorFilter(Color.WHITE)
            setOnClickListener {
                if (::webView.isInitialized && webView.canGoBack()) webView.goBack() else finish()
            }
        }
        header.addView(back, LinearLayout.LayoutParams(dp(48), dp(48)))
        val title = TextView(this).apply {
            text = intent.getStringExtra(EXTRA_TITLE).orEmpty().ifBlank { "Resource" }
            setTextColor(Color.WHITE)
            textSize = 16f
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
        }
        header.addView(title, LinearLayout.LayoutParams(0, dp(48), 1f))
        root.addView(header, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        webView = WebView(this).apply {
            setBackgroundColor(Color.WHITE)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.setSupportMultipleWindows(false)
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val target = request.url
                    val scheme = target.scheme?.lowercase()
                    return if (scheme == "http" || scheme == "https") {
                        view.loadUrl(target.toString())
                        true
                    } else {
                        Toast.makeText(this@NativeResourceViewerActivity, "This link is not supported in the resource viewer.", Toast.LENGTH_SHORT).show()
                        true
                    }
                }
            }
        }
        root.addView(webView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
        webView.loadUrl(rawUrl)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        if (::webView.isInitialized) {
            webView.stopLoading()
            webView.loadUrl("about:blank")
            webView.destroy()
        }
        super.onDestroy()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    companion object {
        private const val EXTRA_URL = "resource_url"
        private const val EXTRA_TITLE = "resource_title"

        fun open(context: Context, title: String, url: String) {
            val intent = Intent(context, NativeResourceViewerActivity::class.java)
                .putExtra(EXTRA_TITLE, title)
                .putExtra(EXTRA_URL, url)
            context.startActivity(intent)
        }
    }
}
