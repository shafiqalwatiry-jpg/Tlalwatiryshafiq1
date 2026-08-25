package com.tilawatak.notification

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.tilawatak.MainActivity

/**
 * Robust Android Notification Helper for Tilawatak LilAlam.
 * Guarantees a non-null, permanent Notification Channel ID ("tilawatak_notifications")
 * and prevents any "Failed to post notification on channel null" developer errors.
 */
object NotificationHelper {

    const val DEFAULT_CHANNEL_ID = "tilawatak_notifications"
    const val DEFAULT_CHANNEL_NAME = "إشعارات تلاوتك"
    const val DEFAULT_CHANNEL_DESC = "إشعارات منصة تلاوتك للعالم ومتابعة حالة التلاوات والاعتمادات"

    /**
     * Creates and registers the permanent notification channel on Android 8.0+ (API 26+).
     * Guaranteed to sanitize channelId and never allow null/empty values.
     */
    fun createNotificationChannel(context: Context, channelId: String = DEFAULT_CHANNEL_ID) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val safeChannelId = if (!channelId.isNullOrBlank()) channelId.trim() else DEFAULT_CHANNEL_ID
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
                ?: return

            // Create or update channel
            val existingChannel = notificationManager.getNotificationChannel(safeChannelId)
            if (existingChannel == null) {
                val channel = NotificationChannel(
                    safeChannelId,
                    DEFAULT_CHANNEL_NAME,
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = DEFAULT_CHANNEL_DESC
                    enableLights(true)
                    enableVibration(true)
                    setShowBadge(true)
                }
                notificationManager.createNotificationChannel(channel)
            }
        }
    }

    /**
     * Post a system notification safely.
     * 1. Sanitizes channelId (never null or whitespace)
     * 2. Asserts notification channel existence
     * 3. Respects Android 13+ POST_NOTIFICATIONS permission without crash
     */
    fun showNotification(
        context: Context,
        title: String?,
        message: String?,
        channelId: String? = null,
        notificationId: Int? = null
    ) {
        try {
            // 1. Sanitize Channel ID to guarantee it is NEVER null or empty
            val safeChannelId = if (!channelId.isNullOrBlank()) channelId.trim() else DEFAULT_CHANNEL_ID
            val safeTitle = if (!title.isNullOrBlank()) title.trim() else "تلاوتك للعالم"
            val safeMessage = if (!message.isNullOrBlank()) message.trim() else ""

            // 2. Ensure channel exists in system before posting
            createNotificationChannel(context, safeChannelId)

            // 3. Permission check for Android 13+ (Tiramisu / API 33+)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                val hasPermission = ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.POST_NOTIFICATIONS
                ) == PackageManager.PERMISSION_GRANTED

                if (!hasPermission) {
                    // Safe return without crash or channel error
                    return
                }
            }

            // 4. Create PendingIntent to launch MainActivity on tap
            val intent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val pendingIntent = PendingIntent.getActivity(
                context,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            // 5. Build Notification with strictly verified non-null Channel ID
            val smallIconRes = try {
                val appInfo = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
                if (appInfo.icon != 0) appInfo.icon else android.R.drawable.ic_dialog_info
            } catch (e: Exception) {
                android.R.drawable.ic_dialog_info
            }

            val builder = NotificationCompat.Builder(context, safeChannelId)
                .setSmallIcon(smallIconRes)
                .setContentTitle(safeTitle)
                .setContentText(safeMessage)
                .setStyle(NotificationCompat.BigTextStyle().bigText(safeMessage))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)

            val safeId = notificationId ?: (System.currentTimeMillis() % 100000).toInt()
            NotificationManagerCompat.from(context).notify(safeId, builder.build())
        } catch (e: Exception) {
            // Guard against any runtime unexpected exception
            e.printStackTrace()
        }
    }
}
