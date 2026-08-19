package com.easyeducation.app

/**
 * Motion/dimension constants read from the permitted YouTube 21.33.322 player resources.
 * Scope is intentionally limited to video/watch/miniplayer presentation parity.
 */
object YoutubeParityMotion {
    const val WATCH_TRANSITION_MS = 350L
    const val WATCH_MIN_MAX_MS = 410L
    const val WATCH_DOWN_OUT_MS = 500L
    const val WATCH_REVEAL_FROM_BOTTOM_MS = 335L
    const val WATCH_HIDDEN_MS = 1000L

    const val MINI_CORNER_RADIUS_DP = 8
    const val MINI_ELEVATION_DP = 2
    const val MINI_INSET_DP = 8
    const val MINI_MAX_SIZE_DP = 640
    const val MINI_SEEK_ICON_DP = 48
}
