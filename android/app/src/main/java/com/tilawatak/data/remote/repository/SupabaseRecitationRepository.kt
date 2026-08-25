package com.tilawatak.data.remote.repository

import com.tilawatak.data.remote.sync.TilawatakSyncEngine
import com.tilawatak.domain.model.LikeResult
import com.tilawatak.domain.model.ListenEvent
import com.tilawatak.domain.model.Recitation
import com.tilawatak.domain.repository.IRecitationRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

class SupabaseRecitationRepository(
    private val defaultInstallationId: String = "inst_anonymous_default",
    private val syncEngine: TilawatakSyncEngine = TilawatakSyncEngine.getInstance(null, defaultInstallationId)
) : IRecitationRepository {

    override fun getRecitationsStream(): Flow<List<Recitation>> {
        return syncEngine.recitations
    }

    fun refreshRecitations() {
        syncEngine.triggerSync(forceFull = true)
    }

    /**
     * Loads approved recitations for a specific reciter,
     * ordered strictly by newest published first (published_at DESC).
     */
    override suspend fun getRecitationsByReciter(reciterId: String): Result<List<Recitation>> {
        val list = syncEngine.recitations.value
            .filter { it.reciterId == reciterId }
            .sortedByDescending { it.publishedAtEpochMs }
        return Result.success(list)
    }

    /**
     * Toggles recitation like using SISA optimistic update & Supabase RPC toggle_recitation_like.
     */
    override suspend fun toggleLike(recitationId: String, userId: String): Result<LikeResult> {
        return syncEngine.toggleLike(recitationId)
    }

    /**
     * Records a meaningful listen event using SISA optimistic update & Supabase RPC record_listen_event.
     */
    override suspend fun recordListenEvent(event: ListenEvent): Result<Unit> {
        return syncEngine.recordListenEvent(event)
    }
}

