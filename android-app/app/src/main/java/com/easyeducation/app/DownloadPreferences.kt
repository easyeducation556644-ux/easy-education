package com.easyeducation.app

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities

object DownloadPreferences {
    private const val PREFS = "native_download_preferences_v2"
    private const val WIFI_ONLY = "wifi_only"

    fun wifiOnly(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(WIFI_ONLY, false)

    fun setWifiOnly(context: Context, enabled: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(WIFI_ONLY, enabled).apply()
    }

    fun isOnline(context: Context): Boolean {
        val connectivity = context.getSystemService(ConnectivityManager::class.java)
        val network = connectivity.activeNetwork ?: return false
        val caps = connectivity.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    fun isWifi(context: Context): Boolean {
        val connectivity = context.getSystemService(ConnectivityManager::class.java)
        val network = connectivity.activeNetwork ?: return false
        val caps = connectivity.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) &&
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
    }

    fun networkAllowed(context: Context): Boolean {
        if (!isOnline(context)) return false
        return !wifiOnly(context) || isWifi(context)
    }
}
