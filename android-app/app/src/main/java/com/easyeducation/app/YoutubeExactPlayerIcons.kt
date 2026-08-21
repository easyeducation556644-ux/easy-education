package com.easyeducation.app

import android.graphics.BitmapFactory
import android.graphics.drawable.BitmapDrawable
import android.util.Base64
import android.view.ViewGroup
import androidx.appcompat.widget.AppCompatImageButton

/** Exact permitted YouTube 21.33.322 player-control glyphs used only in the video presentation UI. */
object YoutubeExactPlayerIcons {
    fun apply(surface: YoutubeStylePlayerView, fullscreen: Boolean) {
        val controls = surface.child(1) as? ViewGroup ?: return
        val top = controls.child(0) as? ViewGroup
        val center = controls.child(1) as? ViewGroup
        val bottom = controls.child(3) as? ViewGroup
        val bottomRow = bottom?.child(1) as? ViewGroup

        (top?.child(0) as? AppCompatImageButton)?.apply { setExact(BACK); setPadding(dp(11), dp(11), dp(11), dp(11)) }
        (top?.child(3) as? AppCompatImageButton)?.apply { setExact(SETTINGS); setPadding(dp(10), dp(10), dp(10), dp(10)) }
        (top?.child(4) as? AppCompatImageButton)?.apply { setExact(MINIMIZE); setPadding(dp(10), dp(10), dp(10), dp(10)) }
        (center?.child(0) as? AppCompatImageButton)?.apply { setExact(PREVIOUS); setPadding(dp(4), dp(4), dp(4), dp(4)) }
        (center?.child(1) as? AppCompatImageButton)?.apply { setPadding(dp(7), dp(7), dp(7), dp(7)) }
        (center?.child(2) as? AppCompatImageButton)?.apply { setExact(NEXT); setPadding(dp(4), dp(4), dp(4), dp(4)) }
        (bottomRow?.child(1) as? AppCompatImageButton)?.apply {
            setExact(if (fullscreen) FULLSCREEN_EXIT else FULLSCREEN)
            setPadding(dp(8), dp(8), dp(8), dp(8))
        }
    }

    fun applyMini(close: AppCompatImageButton, expand: AppCompatImageButton) {
        close.setExact(CLOSE)
        expand.setExact(FULLSCREEN)
    }

    private fun AppCompatImageButton.setExact(encoded: String) {
        val bytes = Base64.decode(encoded, Base64.DEFAULT)
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        setImageDrawable(BitmapDrawable(resources, bitmap).apply {
            setTargetDensity(android.util.DisplayMetrics.DENSITY_XHIGH)
        })
    }

    private fun AppCompatImageButton.dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
    private fun ViewGroup.child(index: Int) = if (index in 0 until childCount) getChildAt(index) else null

    private const val BACK = "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAQAAAD9CzEMAAAASklEQVR4Ae2WUQEAERTAtFLtfb7IEoAGALAF2MBxBgBqCRp0rj6jc/UZmat3waLPoEePvpnJ+uWBCYllm0yCBAkSMvnn97DfdwCIFY44W6EMGjoAAAAASUVORK5CYII="
    private const val SETTINGS = "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAQAAAD9CzEMAAAB+UlEQVRYCe3Bz0uTcQDH8c9I20Bdqcjc36DooV8IM0k8hF0SL0Ed8g+IwA5beigikTrUoVOX6jAa2x8RCVYgdIswqC45NonRj3nQxfbusB32PM/3+zj0exF8vaRjRwQf8duQOyQxGZYrTGKSkissYHJTrrCCyUO5QgGTvA6CWSrkmVYLAzxiB5MdVulXC9Pk+cWswhHlO02bLDLAdSqE+ck1BrnDF5q+EVUY7tKuRidqtMvIjiRVDqtKUja8woWXMuMcDVxocFZBRPiAK+8VxDzhtkgzQpQoo2QoEm5OflxiD7ssPWpDLzns9phSEBMUMcsSkQ8Rcpj94LzMSLBG0BY9MqCPEkFvGJIdXTzBLy0LlvB7zAnthwpeI7JgDK+yOkEdr6gsiOH1T52gjldUFsTwqqkTVPAalQXjeJW0H7p5hl9GFizj95Qu2ZFknaAivTIgTpmgNRIyY5ISZjki8iFCAbMiEwpihhp2OfrUhjgF7GpMyY+rhCuxxBgxYoyzTJlwVxTEOq68lQlnaOBCnXGZ8QIXnsuGBH85rN8MyY407XbpxC7tFhWGk3yl6RO3OM0824QpM0c/t/lM0ybdCsdltsmSUguneEAVkz/cI64WLvKaMjM6CPKYZOUKK5jclyssYHJDrpDC5IJcYRiTQbnDBn7vdOyI+A/vtlfGLtSHswAAAABJRU5ErkJggg=="
    private const val MINIMIZE = "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAe0lEQVR4Ae3PMRXDMADEUEMypDJqGTQMA0EdPHm+V98QfQTSeBxJkiRJAj7AHCFgAu/T8RfLDcww/mb5no5nn4jiOTYBvACSiS1+d42lP9GPzyf68flEPz6f6MdnE/34cCKM708E8e2JPL4/kcf3J/L4/sRf4iVJkiTpB9ZcN9RfUyX3AAAAAElFTkSuQmCC"
    private const val PREVIOUS = "iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAQAAABIkb+zAAABO0lEQVR4Ae3ZsS1HYRSG8S+Sf3Ob2ylp1fQMwARMwARMwARMwAQWuAOoaZU6lUIij+IUJ1G5CcWTvO+Z4Ffc5PlyR/abZVmWZVmWZVmWZVmWZfzc+MObeWCsu8Ha+z/AEa9gBWy44QusgD2eAKyACz7ACtjmEcAKOOENrICJOwAr4IAXsAK2uOITrIBdFgAr4Ix3cAKqdAAroEpHCujSUQK6dJSAKh0poEtHCajSkQK6dJSAKh0poEtHCejSUQKqdMSAUzOgboeFmvgjvjR/xHX7PHsBdRO3ZkDdsTkl9DHXd27OafmDpm/DtflJWXdoftTXzdy7AV1LYkDVkhrQtaQFdC2JAVVLakDXkhig/8nXtaQG6H90dy2JAV1LYkDV0mqA/AIIIAD5BRBAAPILIIAAxBdAAAEEEEAA37X6elTA1sHFAAAAAElFTkSuQmCC"
    private const val NEXT = "iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAQAAABIkb+zAAABLElEQVR4Ae3aMS4FYQBF4YlEodIptdT0NmAHVsAK2AEbGDuwgrGAsQD1ayl1mmkmkau8iYqJ5iTn/AuQL+G9+88YzMzMzMzMzMzMflOecpjhH8/Phr+dLT/wPRdsQPKVh+yTAUnymlM2IFlyQwW05xyxAclHLqmA9pgDNiDZ5ZwNSNbcZY8JaC85ZgOSz1xBAa1rCQroWoICupawgK4lLKBrCQzoWsICupbAgK4lLKBrCQzoWsICupawgK4lMIAPmMm/QmtuyX/Eu5yRP0ZH8hcZfEpM5DG35Jp9oTkhXynvyVfKt22Xeh+r+GBrxj5a7NJBArp0qIAR+4KD/4ppwr7k69IBArp0kIAuHSSgS4cKQP27DeAIECAAfgQIEAA/AgQIECBAgAABAsDnGzzOeiz06bgMAAAAAElFTkSuQmCC"
    private const val FULLSCREEN = "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwAQAAAAB/ecQqAAAAAnRSTlMAAHaTzTgAAAAeSURBVHgBY6ASsP/A/wcXZQNGhCkyAfE24HUndQAAXlkXcQ24P7gAAAAASUVORK5CYII="
    private const val FULLSCREEN_EXIT = "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwAQAAAAB/ecQqAAAAAnRSTlMAAHaTzTgAAAAeSURBVHgBY6AW+MBPJGX/gf8Pdoo8gNdM4l1GJQAAivsdxcvmSJAAAAAASUVORK5CYII="
    private const val CLOSE = "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAQAAAD9CzEMAAAAk0lEQVR4Ae3WxxmDQBBDYYcit0DHHm0QfFxF5pFH551fZPYSOW4iEd31VOq9Oump+zD+K+nfVGH8X9J3QIWeKtNc4XyVZ7dsQx0VthKoQHgfxnkHcN4RnHcI5x3DeQdp3ipw3iqc5ys4ni/gLxF/k/nHdNsvGv+p4D92/Od6/R8O/8vkf/rrb1v4jRe/dYxEIkdKAbByXpvsailuAAAAAElFTkSuQmCC"
}
