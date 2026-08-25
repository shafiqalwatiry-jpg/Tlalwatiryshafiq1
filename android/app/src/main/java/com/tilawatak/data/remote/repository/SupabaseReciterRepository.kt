package com.tilawatak.data.remote.repository

import com.tilawatak.data.remote.SupabaseContracts
import com.tilawatak.data.remote.dto.SupabaseDtoMappers
import com.tilawatak.data.remote.http.SupabaseHttpClient
import com.tilawatak.data.remote.sync.TilawatakSyncEngine
import com.tilawatak.domain.model.Reciter
import com.tilawatak.domain.repository.IReciterRepository
import kotlinx.coroutines.flow.Flow
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

class SupabaseReciterRepository(
    private val syncEngine: TilawatakSyncEngine = TilawatakSyncEngine.getInstance()
) : IReciterRepository {

    override fun getRecitersStream(): Flow<List<Reciter>> {
        return syncEngine.reciters
    }

    fun refreshReciters() {
        syncEngine.triggerSync(forceFull = true)
    }

    override suspend fun getReciterById(id: String): Result<Reciter?> {
        val cached = syncEngine.reciters.value.find { it.id == id }
        if (cached != null) return Result.success(cached)

        val queryParams = mapOf(
            "select" to "*",
            "id" to "eq.$id",
            "limit" to "1"
        )
        val response = SupabaseHttpClient.get(SupabaseContracts.VIEW_RECITER_STATS, queryParams)
        val respToUse = if (response.isSuccess) response else SupabaseHttpClient.get(SupabaseContracts.VIEW_PUBLIC_RECITERS, queryParams)
        return respToUse.mapCatching { jsonStr ->
            val jsonArray = JSONArray(jsonStr)
            if (jsonArray.length() > 0) {
                SupabaseDtoMappers.mapJsonToReciter(jsonArray.getJSONObject(0))
            } else {
                null
            }
        }
    }

    override suspend fun getFeaturedReciters(): Result<List<Reciter>> {
        val cached = syncEngine.reciters.value.filter { it.isStaffPick || it.verified }
        if (cached.isNotEmpty()) return Result.success(cached)

        val queryParams = mapOf(
            "select" to "*",
            "or" to "(is_staff_pick.eq.true,is_verified.eq.true)",
            "limit" to "10"
        )
        val response = SupabaseHttpClient.get(SupabaseContracts.VIEW_RECITER_STATS, queryParams)
        val respToUse = if (response.isSuccess) response else SupabaseHttpClient.get(SupabaseContracts.VIEW_PUBLIC_RECITERS, queryParams)
        return respToUse.mapCatching { jsonStr ->
            val jsonArray = JSONArray(jsonStr)
            val list = mutableListOf<Reciter>()
            for (i in 0 until jsonArray.length()) {
                list.add(SupabaseDtoMappers.mapJsonToReciter(jsonArray.getJSONObject(i)))
            }
            list
        }
    }

    override suspend fun searchReciters(query: String): Result<List<Reciter>> {
        val trimmed = query.trim()
        if (trimmed.isEmpty()) return Result.success(syncEngine.reciters.value)

        val localMatches = syncEngine.reciters.value.filter { r ->
            r.displayName.contains(trimmed, ignoreCase = true) ||
            (r.pseudonym?.contains(trimmed, ignoreCase = true) == true) ||
            r.country.contains(trimmed, ignoreCase = true)
        }
        if (localMatches.isNotEmpty()) return Result.success(localMatches)

        val rpcBody = JSONObject().apply {
            put("search_term", trimmed)
        }
        val response = SupabaseHttpClient.rpc(SupabaseContracts.RPC_SEARCH_RECITERS, rpcBody)
        return response.mapCatching { jsonStr ->
            val jsonArray = JSONArray(jsonStr)
            val list = mutableListOf<Reciter>()
            for (i in 0 until jsonArray.length()) {
                list.add(SupabaseDtoMappers.mapJsonToReciter(jsonArray.getJSONObject(i)))
            }
            list
        }.recoverCatching {
            localMatches
        }
    }

    override suspend fun getNewestReciters(limit: Int): Result<List<Reciter>> {
        val list = syncEngine.reciters.value
            .sortedByDescending { it.createdAtEpochMs }
            .take(limit)
        return Result.success(list)
    }
}


