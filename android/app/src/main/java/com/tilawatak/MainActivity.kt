package com.tilawatak

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.tilawatak.audio.Media3AudioPlayerService
import com.tilawatak.data.RepositoryProvider
import com.tilawatak.data.local.DefaultAnonymousInstallationIdProvider
import com.tilawatak.data.remote.DataSourceMode
import com.tilawatak.data.remote.SupabaseConfig
import com.tilawatak.notification.NotificationHelper
import com.tilawatak.ui.TilawatakApp

class MainActivity : ComponentActivity() {

    // Clean Architecture Repositories & Local Providers
    private val installationIdProvider by lazy { DefaultAnonymousInstallationIdProvider() }
    private val repositoryProvider by lazy {
        RepositoryProvider(
            context = applicationContext,
            mode = DataSourceMode.SUPABASE,
            installationIdProvider = installationIdProvider
        )
    }

    private val audioPlayerService by lazy {
        Media3AudioPlayerService(
            context = applicationContext,
            recitationRepository = repositoryProvider.recitationRepository
        )
    }

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { _ ->
        // Gracefully handle permission result (granted or denied) without crashes or null channels
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Ensure permanent notification channel is initialized
        NotificationHelper.createNotificationChannel(this)

        // Request notification permission on Android 13+ if not already granted
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(
                    this,
                    Manifest.permission.POST_NOTIFICATIONS
                ) != PackageManager.PERMISSION_GRANTED
            ) {
                notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }

        setContent {
            TilawatakApp(
                reciterRepository = repositoryProvider.reciterRepository,
                recitationRepository = repositoryProvider.recitationRepository,
                statisticsRepository = repositoryProvider.statisticsRepository,
                submissionRepository = repositoryProvider.submissionRepository,
                audioPlayerService = audioPlayerService,
                announcementRepository = repositoryProvider.announcementRepository,
                competitionRepository = repositoryProvider.competitionRepository,
                rewardRepository = repositoryProvider.rewardRepository,
                installationIdProvider = installationIdProvider
            )
        }
    }
}
