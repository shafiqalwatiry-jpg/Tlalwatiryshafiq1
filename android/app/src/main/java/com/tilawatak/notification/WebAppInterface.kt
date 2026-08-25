package com.tilawatak.notification

import android.content.Context
import android.webkit.JavascriptInterface

/**
 * WebAppInterface exposed to JavaScript as `window.AndroidBridge`.
 * Receives notification triggers from the web client and forwards them safely
 * to NotificationHelper with a guaranteed non-null Channel ID.
 */
class WebAppInterface(
    private val context: Context,
    private val onBiometricRequest: (() -> Unit)? = null
) {

    @JavascriptInterface
    fun showNotification(title: String?, message: String?, channelId: String? = null) {
        val safeChannel = if (!channelId.isNullOrBlank()) channelId.trim() else NotificationHelper.DEFAULT_CHANNEL_ID
        NotificationHelper.showNotification(
            context = context,
            title = title,
            message = message,
            channelId = safeChannel
        )
    }

    @JavascriptInterface
    fun postNotification(title: String?, message: String?, channelId: String? = null) {
        showNotification(title, message, channelId)
    }

    @JavascriptInterface
    fun notify(title: String?, message: String?, channelId: String? = null) {
        showNotification(title, message, channelId)
    }

    @JavascriptInterface
    fun requestBiometricAdminUnlock() {
        onBiometricRequest?.invoke()
    }
}
