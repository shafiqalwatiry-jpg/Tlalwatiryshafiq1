package com.tilawatak.data.remote.repository

import com.tilawatak.data.remote.SupabaseContracts
import com.tilawatak.data.remote.dto.SupabaseDtoMappers
import com.tilawatak.data.remote.http.SupabaseHttpClient
import com.tilawatak.data.remote.sync.TilawatakSyncEngine
import com.tilawatak.domain.model.Announcement
import com.tilawatak.domain.repository.IAnnouncementRepository
import kotlinx.coroutines.flow.Flow
import org.json.JSONArray

class SupabaseAnnouncementRepository(
    private val syncEngine: TilawatakSyncEngine = TilawatakSyncEngine.getInstance()
) : IAnnouncementRepository {

    override fun getAnnouncementsStream(): Flow<List<Announcement>> {
        return syncEngine.announcements
    }

    override suspend fun getPublishedAnnouncements(): Result<List<Announcement>> {
        val cached = syncEngine.announcements.value
        if (cached.isNotEmpty()) return Result.success(cached)

        val queryParams = mapOf(
            "select" to "*",
            "is_published" to "eq.true",
            "order" to "published_at.desc"
        )
        val response = SupabaseHttpClient.get(SupabaseContracts.TABLE_ANNOUNCEMENTS, queryParams)
        return response.mapCatching { jsonStr ->
            val jsonArray = JSONArray(jsonStr)
            val list = mutableListOf<Announcement>()
            for (i in 0 until jsonArray.length()) {
                list.add(SupabaseDtoMappers.mapJsonToAnnouncement(jsonArray.getJSONObject(i)))
            }
            list
        }
    }

    override suspend fun getAnnouncementById(id: String): Result<Announcement?> {
        val cached = syncEngine.announcements.value.find { it.id == id }
        if (cached != null) return Result.success(cached)

        val queryParams = mapOf(
            "select" to "*",
            "id" to "eq.$id",
            "limit" to "1"
        )
        val response = SupabaseHttpClient.get(SupabaseContracts.TABLE_ANNOUNCEMENTS, queryParams)
        return response.mapCatching { jsonStr ->
            val jsonArray = JSONArray(jsonStr)
            if (jsonArray.length() > 0) {
                SupabaseDtoMappers.mapJsonToAnnouncement(jsonArray.getJSONObject(0))
            } else {
                null
            }
        }
    }
}

