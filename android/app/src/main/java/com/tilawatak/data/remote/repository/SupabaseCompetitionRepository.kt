package com.tilawatak.data.remote.repository

import com.tilawatak.data.remote.SupabaseContracts
import com.tilawatak.data.remote.dto.SupabaseDtoMappers
import com.tilawatak.data.remote.http.SupabaseHttpClient
import com.tilawatak.data.remote.sync.TilawatakSyncEngine
import com.tilawatak.domain.model.Competition
import com.tilawatak.domain.repository.ICompetitionRepository
import kotlinx.coroutines.flow.Flow
import org.json.JSONArray

class SupabaseCompetitionRepository(
    private val syncEngine: TilawatakSyncEngine = TilawatakSyncEngine.getInstance()
) : ICompetitionRepository {

    override fun getCompetitionsStream(): Flow<List<Competition>> {
        return syncEngine.competitions
    }

    override suspend fun getActiveCompetitions(): Result<List<Competition>> {
        val cached = syncEngine.competitions.value
        if (cached.isNotEmpty()) return Result.success(cached)

        val queryParams = mapOf(
            "select" to "*",
            "is_published" to "eq.true",
            "order" to "start_at.desc"
        )
        val response = SupabaseHttpClient.get(SupabaseContracts.TABLE_COMPETITIONS, queryParams)
        return response.mapCatching { jsonStr ->
            val jsonArray = JSONArray(jsonStr)
            val list = mutableListOf<Competition>()
            for (i in 0 until jsonArray.length()) {
                list.add(SupabaseDtoMappers.mapJsonToCompetition(jsonArray.getJSONObject(i)))
            }
            list
        }
    }

    override suspend fun getCompetitionById(id: String): Result<Competition?> {
        val cached = syncEngine.competitions.value.find { it.id == id }
        if (cached != null) return Result.success(cached)

        val queryParams = mapOf(
            "select" to "*",
            "id" to "eq.$id",
            "limit" to "1"
        )
        val response = SupabaseHttpClient.get(SupabaseContracts.TABLE_COMPETITIONS, queryParams)
        return response.mapCatching { jsonStr ->
            val jsonArray = JSONArray(jsonStr)
            if (jsonArray.length() > 0) {
                SupabaseDtoMappers.mapJsonToCompetition(jsonArray.getJSONObject(0))
            } else {
                null
            }
        }
    }
}

