package com.tilawatak

import android.app.Application
import com.tilawatak.notification.NotificationHelper

class TilawatakApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // Initialize permanent notification channel at app boot
        NotificationHelper.createNotificationChannel(this)
    }
}
