package com.tilawatak.data

import android.content.Context
import com.tilawatak.data.local.DefaultAnonymousInstallationIdProvider
import com.tilawatak.data.remote.DataSourceMode
import com.tilawatak.data.remote.SupabaseConfig
import com.tilawatak.data.remote.repository.SupabaseAnnouncementRepository
import com.tilawatak.data.remote.repository.SupabaseCompetitionRepository
import com.tilawatak.data.remote.repository.SupabaseLikeRepository
import com.tilawatak.data.remote.repository.SupabaseListenEventRepository
import com.tilawatak.data.remote.repository.SupabaseRecitationRepository
import com.tilawatak.data.remote.repository.SupabaseReciterRepository
import com.tilawatak.data.remote.repository.SupabaseRewardRepository
import com.tilawatak.data.remote.repository.SupabaseStatisticsRepository
import com.tilawatak.data.remote.repository.SupabaseSubmissionRepository
import com.tilawatak.data.remote.sync.TilawatakSyncEngine
import com.tilawatak.data.repository.MockAdminAuthRepository
import com.tilawatak.data.repository.MockAdminNotificationRepository
import com.tilawatak.data.repository.MockAdminRepository
import com.tilawatak.domain.provider.AnonymousInstallationIdProvider
import com.tilawatak.domain.repository.IAdminAuthRepository
import com.tilawatak.domain.repository.IAdminNotificationRepository
import com.tilawatak.domain.repository.IAdminRepository
import com.tilawatak.domain.repository.IAnnouncementRepository
import com.tilawatak.domain.repository.ICompetitionRepository
import com.tilawatak.domain.repository.ILikeRepository
import com.tilawatak.domain.repository.IListenEventRepository
import com.tilawatak.domain.repository.IRecitationRepository
import com.tilawatak.domain.repository.IReciterRepository
import com.tilawatak.domain.repository.IRewardRepository
import com.tilawatak.domain.repository.IStatisticsRepository
import com.tilawatak.domain.repository.ISubmissionRepository

/**
 * Production dependency provider powered by SISA (TilawatakSyncEngine)
 * and Supabase live data architecture.
 */
class RepositoryProvider(
    val context: Context? = null,
    val mode: DataSourceMode = DataSourceMode.SUPABASE,
    val installationIdProvider: AnonymousInstallationIdProvider = DefaultAnonymousInstallationIdProvider()
) {
    val installationId: String
        get() = installationIdProvider.getInstallationId()

    val syncEngine: TilawatakSyncEngine by lazy {
        TilawatakSyncEngine.getInstance(context, installationId)
    }

    // Supabase Live SISA implementations
    private val supabaseReciterRepo by lazy { SupabaseReciterRepository(syncEngine) }
    private val supabaseRecitationRepo by lazy { SupabaseRecitationRepository(installationId, syncEngine) }
    private val supabaseStatsRepo by lazy { SupabaseStatisticsRepository() }
    private val supabaseSubmissionRepo by lazy { SupabaseSubmissionRepository(syncEngine) }
    private val supabaseLikeRepo by lazy { SupabaseLikeRepository(installationId) }
    private val supabaseListenEventRepo by lazy { SupabaseListenEventRepository(installationId) }
    private val supabaseAnnouncementRepo by lazy { SupabaseAnnouncementRepository(syncEngine) }
    private val supabaseCompetitionRepo by lazy { SupabaseCompetitionRepository(syncEngine) }
    private val supabaseRewardRepo by lazy { SupabaseRewardRepository() }

    val reciterRepository: IReciterRepository
        get() = supabaseReciterRepo

    val recitationRepository: IRecitationRepository
        get() = supabaseRecitationRepo

    val statisticsRepository: IStatisticsRepository
        get() = supabaseStatsRepo

    val submissionRepository: ISubmissionRepository
        get() = supabaseSubmissionRepo

    val likeRepository: ILikeRepository
        get() = supabaseLikeRepo

    val listenEventRepository: IListenEventRepository
        get() = supabaseListenEventRepo

    val announcementRepository: IAnnouncementRepository
        get() = supabaseAnnouncementRepo

    val competitionRepository: ICompetitionRepository
        get() = supabaseCompetitionRepo

    val rewardRepository: IRewardRepository
        get() = supabaseRewardRepo

    val adminNotificationRepository: IAdminNotificationRepository by lazy {
        MockAdminNotificationRepository()
    }

    val adminAuthRepository: IAdminAuthRepository by lazy {
        MockAdminAuthRepository()
    }

    val adminRepository: IAdminRepository by lazy {
        MockAdminRepository(
            reciterRepository = supabaseReciterRepo,
            recitationRepository = supabaseRecitationRepo,
            submissionRepository = supabaseSubmissionRepo,
            announcementRepository = supabaseAnnouncementRepo,
            competitionRepository = supabaseCompetitionRepo
        )
    }
}

