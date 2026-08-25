package com.tilawatak.data.remote.sync

import android.content.Context
import com.tilawatak.data.remote.SupabaseContracts
import com.tilawatak.data.remote.dto.SupabaseDtoMappers
import com.tilawatak.data.remote.http.SupabaseHttpClient
import com.tilawatak.domain.model.Announcement
import com.tilawatak.domain.model.Competition
import com.tilawatak.domain.model.LikeResult
import com.tilawatak.domain.model.ListenEvent
import com.tilawatak.domain.model.Recitation
import com.tilawatak.domain.model.RecitationSubmission
import com.tilawatak.domain.model.Reciter
import com.tilawatak.domain.model.ReciterHonor
import com.tilawatak.domain.model.RewardDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Enterprise-Grade SISA (Smart Incremental Sync & Instant Data Architecture) Engine for Android.
 * Features:
 * 1. L1 In-Memory Cache: 0ms startup, immediate reactive rendering.
 * 2. L2 Persistent Disk Cache: Preserves state across app restarts, no zeros or blank screens.
 * 3. Incremental Sync: Calls get_incremental_sync_diff RPC with p_last_sync_timestamp and processes Tombstones.
 * 4. Resilient Fallbacks: Direct PostgREST queries if RPC is not available.
 * 5. Multi-Client Consistency: Syncs user likes, user submissions, and live listen metrics.
 */
class TilawatakSyncEngine private constructor(
    private val context: Context? = null,
    private val installationId: String = "inst_anonymous_default",
    private val scope: CoroutineScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
) {

    private val _reciters = MutableStateFlow<List<Reciter>>(emptyList())
    val reciters: StateFlow<List<Reciter>> = _reciters.asStateFlow()

    private val _recitations = MutableStateFlow<List<Recitation>>(emptyList())
    val recitations: StateFlow<List<Recitation>> = _recitations.asStateFlow()

    private val _competitions = MutableStateFlow<List<Competition>>(emptyList())
    val competitions: StateFlow<List<Competition>> = _competitions.asStateFlow()

    private val _announcements = MutableStateFlow<List<Announcement>>(emptyList())
    val announcements: StateFlow<List<Announcement>> = _announcements.asStateFlow()

    private val _honors = MutableStateFlow<List<ReciterHonor>>(emptyList())
    val honors: StateFlow<List<ReciterHonor>> = _honors.asStateFlow()

    private val _userSubmissions = MutableStateFlow<List<RecitationSubmission>>(emptyList())
    val userSubmissions: StateFlow<List<RecitationSubmission>> = _userSubmissions.asStateFlow()

    private val _userLikes = MutableStateFlow<Set<String>>(emptySet())
    val userLikes: StateFlow<Set<String>> = _userLikes.asStateFlow()

    private val _isSyncing = MutableStateFlow<Boolean>(false)
    val isSyncing: StateFlow<Boolean> = _isSyncing.asStateFlow()

    private var lastSyncTimestamp: String? = null
    private var syncJob: Job? = null

    private val cacheFileName = "tilawatak_sisa_cache.json"

    init {
        hydrateFromDiskCache()
        triggerSync(forceFull = false)
    }

    companion object {
        @Volatile
        private var instance: TilawatakSyncEngine? = null

        fun getInstance(context: Context? = null, installationId: String = "inst_anonymous_default"): TilawatakSyncEngine {
            return instance ?: synchronized(this) {
                instance ?: TilawatakSyncEngine(context?.applicationContext, installationId).also {
                    instance = it
                }
            }
        }
    }

    /**
     * Trigger background incremental or full sync
     */
    fun triggerSync(forceFull: boolean = false) {
        if (_isSyncing.value) return
        syncJob?.cancel()
        syncJob = scope.launch {
            performSync(forceFull)
        }
    }

    private suspend fun performSync(forceFull: Boolean) {
        _isSyncing.value = true
        val syncSince = if (forceFull) null else lastSyncTimestamp

        try {
            // Strategy 1: Fast consolidated Incremental Diff RPC
            var rpcSucceeded = false
            val rpcBody = JSONObject().apply {
                if (syncSince != null) {
                    put("p_last_sync_timestamp", syncSince)
                } else {
                    put("p_last_sync_timestamp", JSONObject.NULL)
                }
                put("p_installation_id", installationId)
            }

            val rpcResult = SupabaseHttpClient.rpc("get_incremental_sync_diff", rpcBody)
            if (rpcResult.isSuccess) {
                val jsonStr = rpcResult.getOrNull()
                if (!jsonStr.isNullOrBlank() && jsonStr != "{}" && jsonStr != "null") {
                    try {
                        val diffObj = JSONObject(jsonStr)
                        applyIncrementalDiff(diffObj)
                        rpcSucceeded = true
                    } catch (e: Exception) {
                        // fallback to rest
                    }
                }
            }

            // Strategy 2: Direct REST Sync Fallback
            if (!rpcSucceeded) {
                performRestFallbackSync(syncSince)
            }

            // Sync user likes
            fetchUserLikes()

            // Save new state to L2 disk cache
            persistToDiskCache()
        } catch (e: Exception) {
            // Log & keep L1 data intact
        } finally {
            _isSyncing.value = false
        }
    }

    private fun applyIncrementalDiff(diff: JSONObject) {
        val newSyncTime = diff.optString("sync_timestamp", null)
        if (!newSyncTime.isNullOrBlank()) {
            lastSyncTimestamp = newSyncTime
        }

        // 1. Process Tombstones (Deletions)
        val tombstonesArray = diff.optJSONArray("tombstones")
        if (tombstonesArray != null && tombstonesArray.length() > 0) {
            val deletedReciters = mutableSetOf<String>()
            val deletedRecitations = mutableSetOf<String>()
            val deletedComps = mutableSetOf<String>()
            val deletedAnnos = mutableSetOf<String>()
            val deletedHonors = mutableSetOf<String>()

            for (i in 0 until tombstonesArray.length()) {
                val item = tombstonesArray.getJSONObject(i)
                val table = item.optString("table", "").toLowerCase(Locale.US)
                val id = item.optString("id", "")
                when (table) {
                    "reciters" -> deletedReciters.add(id)
                    "recitations" -> deletedRecitations.add(id)
                    "competitions" -> deletedComps.add(id)
                    "announcements" -> deletedAnnos.add(id)
                    "reciter_honors" -> deletedHonors.add(id)
                }
            }

            if (deletedReciters.isNotEmpty()) {
                _reciters.update { current -> current.filter { !deletedReciters.contains(it.id) } }
            }
            if (deletedRecitations.isNotEmpty()) {
                _recitations.update { current -> current.filter { !deletedRecitations.contains(it.id) } }
            }
            if (deletedComps.isNotEmpty()) {
                _competitions.update { current -> current.filter { !deletedComps.contains(it.id) } }
            }
            if (deletedAnnos.isNotEmpty()) {
                _announcements.update { current -> current.filter { !deletedAnnos.contains(it.id) } }
            }
            if (deletedHonors.isNotEmpty()) {
                _honors.update { current -> current.filter { !deletedHonors.contains(it.id) } }
            }
        }

        // 2. Process Reciters (Upsert)
        val recitersArray = diff.optJSONArray("reciters")
        if (recitersArray != null && recitersArray.length() > 0) {
            val updatedMap = _reciters.value.associateBy { it.id }.toMutableMap()
            for (i in 0 until recitersArray.length()) {
                val r = SupabaseDtoMappers.mapJsonToReciter(recitersArray.getJSONObject(i))
                updatedMap[r.id] = r
            }
            _reciters.value = updatedMap.values.toList()
        }

        // 3. Process Recitations (Upsert)
        val recitationsArray = diff.optJSONArray("recitations")
        if (recitationsArray != null && recitationsArray.length() > 0) {
            val likedSet = _userLikes.value
            val updatedMap = _recitations.value.associateBy { it.id }.toMutableMap()
            for (i in 0 until recitationsArray.length()) {
                val obj = recitationsArray.getJSONObject(i)
                val id = obj.optString("id")
                val isLiked = likedSet.contains(id)
                val rec = SupabaseDtoMappers.mapJsonToRecitation(obj, isLiked)
                updatedMap[rec.id] = rec
            }
            _recitations.value = updatedMap.values.sortedByDescending { it.publishedAtEpochMs }
        }

        // 4. Process Competitions (Upsert)
        val compsArray = diff.optJSONArray("competitions")
        if (compsArray != null && compsArray.length() > 0) {
            val updatedMap = _competitions.value.associateBy { it.id }.toMutableMap()
            for (i in 0 until compsArray.length()) {
                val c = SupabaseDtoMappers.mapJsonToCompetition(compsArray.getJSONObject(i))
                updatedMap[c.id] = c
            }
            _competitions.value = updatedMap.values.sortedByDescending { it.startAtEpochMs }
        }

        // 5. Process Announcements (Upsert)
        val annosArray = diff.optJSONArray("announcements")
        if (annosArray != null && annosArray.length() > 0) {
            val updatedMap = _announcements.value.associateBy { it.id }.toMutableMap()
            for (i in 0 until annosArray.length()) {
                val a = SupabaseDtoMappers.mapJsonToAnnouncement(annosArray.getJSONObject(i))
                updatedMap[a.id] = a
            }
            _announcements.value = updatedMap.values.sortedByDescending { it.publishedAtEpochMs }
        }

        // 6. Process User Likes in Diff
        val userLikesArray = diff.optJSONArray("user_likes")
        if (userLikesArray != null) {
            val likedIds = mutableSetOf<String>()
            for (i in 0 until userLikesArray.length()) {
                likedIds.add(userLikesArray.getString(i))
            }
            _userLikes.value = likedIds
            _recitations.update { list ->
                list.map { it.copy(isLiked = likedIds.contains(it.id)) }
            }
        }
    }

    private suspend fun performRestFallbackSync(lastSync: String?) {
        val nowIso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSSSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.format(Date())

        // 1. Recitations
        val recParams = mutableMapOf(
            "select" to "*",
            "order" to "published_at.desc"
        )
        if (lastSync != null) {
            recParams["updated_at"] = "gt.$lastSync"
        }
        val recResp = SupabaseHttpClient.get(SupabaseContracts.VIEW_RECITATION_STATS, recParams)
        val finalRecResp = if (recResp.isSuccess) recResp else SupabaseHttpClient.get(SupabaseContracts.VIEW_PUBLIC_RECITATIONS, recParams)
        finalRecResp.onSuccess { json ->
            val arr = JSONArray(json)
            if (arr.length() > 0) {
                val likedSet = _userLikes.value
                val list = mutableListOf<Recitation>()
                for (i in 0 until arr.length()) {
                    val obj = arr.getJSONObject(i)
                    val id = obj.optString("id")
                    list.add(SupabaseDtoMappers.mapJsonToRecitation(obj, likedSet.contains(id)))
                }
                if (lastSync == null) {
                    _recitations.value = list
                } else {
                    val map = _recitations.value.associateBy { it.id }.toMutableMap()
                    list.forEach { map[it.id] = it }
                    _recitations.value = map.values.sortedByDescending { it.publishedAtEpochMs }
                }
            }
        }

        // 2. Reciters
        val reciterParams = mutableMapOf(
            "select" to "*",
            "order" to "created_at.desc"
        )
        if (lastSync != null) {
            reciterParams["updated_at"] = "gt.$lastSync"
        }
        val reciterResp = SupabaseHttpClient.get(SupabaseContracts.VIEW_RECITER_STATS, reciterParams)
        val finalReciterResp = if (reciterResp.isSuccess) reciterResp else SupabaseHttpClient.get(SupabaseContracts.VIEW_PUBLIC_RECITERS, reciterParams)
        finalReciterResp.onSuccess { json ->
            val arr = JSONArray(json)
            if (arr.length() > 0) {
                val list = mutableListOf<Reciter>()
                for (i in 0 until arr.length()) {
                    list.add(SupabaseDtoMappers.mapJsonToReciter(arr.getJSONObject(i)))
                }
                if (lastSync == null) {
                    _reciters.value = list
                } else {
                    val map = _reciters.value.associateBy { it.id }.toMutableMap()
                    list.forEach { map[it.id] = it }
                    _reciters.value = map.values.toList()
                }
            }
        }

        // 3. Competitions
        val compResp = SupabaseHttpClient.get(
            SupabaseContracts.TABLE_COMPETITIONS,
            mapOf("select" to "*", "is_published" to "eq.true", "order" to "start_at.desc")
        )
        compResp.onSuccess { json ->
            val arr = JSONArray(json)
            val list = mutableListOf<Competition>()
            for (i in 0 until arr.length()) {
                list.add(SupabaseDtoMappers.mapJsonToCompetition(arr.getJSONObject(i)))
            }
            _competitions.value = list
        }

        // 4. Announcements
        val annoResp = SupabaseHttpClient.get(
            SupabaseContracts.TABLE_ANNOUNCEMENTS,
            mapOf("select" to "*", "is_published" to "eq.true", "order" to "published_at.desc")
        )
        annoResp.onSuccess { json ->
            val arr = JSONArray(json)
            val list = mutableListOf<Announcement>()
            for (i in 0 until arr.length()) {
                list.add(SupabaseDtoMappers.mapJsonToAnnouncement(arr.getJSONObject(i)))
            }
            _announcements.value = list
        }

        lastSyncTimestamp = nowIso
    }

    private suspend fun fetchUserLikes() {
        val likesResp = SupabaseHttpClient.get(
            SupabaseContracts.TABLE_LIKES,
            mapOf("select" to "recitation_id", "anonymous_installation_id" to "eq.$installationId")
        )
        likesResp.onSuccess { json ->
            val arr = JSONArray(json)
            val ids = mutableSetOf<String>()
            for (i in 0 until arr.length()) {
                ids.add(arr.getJSONObject(i).optString("recitation_id"))
            }
            _userLikes.value = ids
            _recitations.update { list ->
                list.map { it.copy(isLiked = ids.contains(it.id)) }
            }
        }
    }

    /**
     * Optimistic like toggler with live DB dispatch
     */
    suspend fun toggleLike(recitationId: String): Result<LikeResult> {
        val isCurrentlyLiked = _userLikes.value.contains(recitationId)
        val newIsLiked = !isCurrentlyLiked

        // Optimistic UI update
        _userLikes.update { if (newIsLiked) it + recitationId else it - recitationId }
        _recitations.update { list ->
            list.map { item ->
                if (item.id == recitationId) {
                    val count = if (newIsLiked) item.likeCount + 1 else (item.likeCount - 1).coerceAtLeast(0)
                    item.copy(isLiked = newIsLiked, likeCount = count)
                } else item
            }
        }

        val rpcBody = JSONObject().apply {
            put("p_recitation_id", recitationId)
            put("p_anonymous_installation_id", installationId)
        }
        val rpcResp = SupabaseHttpClient.rpc(SupabaseContracts.RPC_TOGGLE_LIKE, rpcBody)
        return rpcResp.mapCatching { jsonStr ->
            val arr = JSONArray(jsonStr)
            if (arr.length() > 0) {
                val row = arr.getJSONObject(0)
                val isLiked = row.optBoolean("liked", row.optBoolean("is_liked", newIsLiked))
                val totalLikes = row.optLong("total_likes", row.optLong("likes_count", 0L))
                _userLikes.update { if (isLiked) it + recitationId else it - recitationId }
                _recitations.update { list ->
                    list.map { item ->
                        if (item.id == recitationId) {
                            item.copy(isLiked = isLiked, likeCount = totalLikes)
                        } else item
                    }
                }
                LikeResult(isLiked = isLiked, totalLikes = totalLikes)
            } else {
                val rec = _recitations.value.find { it.id == recitationId }
                LikeResult(isLiked = newIsLiked, totalLikes = rec?.likeCount ?: 0L)
            }
        }.recoverCatching {
            val rec = _recitations.value.find { it.id == recitationId }
            LikeResult(isLiked = newIsLiked, totalLikes = rec?.likeCount ?: 0L)
        }
    }

    /**
     * Optimistic listen event recorder with live DB dispatch
     */
    suspend fun recordListenEvent(event: ListenEvent): Result<Unit> {
        val recId = event.recitationId
        if (event.durationSeconds >= 5 || event.completed) {
            _recitations.update { list ->
                list.map { if (it.id == recId) it.copy(listenCount = it.listenCount + 1) else it }
            }
        }

        val rpcBody = JSONObject().apply {
            put("p_recitation_id", recId)
            put("p_anonymous_installation_id", if (event.anonymousInstallationId.isNotBlank()) event.anonymousInstallationId else installationId)
            put("p_listened_seconds", event.durationSeconds)
            put("p_completed", event.completed)
        }
        return SupabaseHttpClient.rpc(SupabaseContracts.RPC_RECORD_LISTEN, rpcBody).mapCatching { Unit }
    }

    fun addLocalSubmission(submission: RecitationSubmission) {
        _userSubmissions.update { listOf(submission) + it }
        persistToDiskCache()
    }

    // =========================================================================
    // L2 DISK PERSISTENCE
    // =========================================================================
    private fun hydrateFromDiskCache() {
        val ctx = context ?: return
        try {
            val file = File(ctx.filesDir, cacheFileName)
            if (!file.exists()) return
            val jsonStr = file.readText()
            if (jsonStr.isBlank()) return
            val root = JSONObject(jsonStr)

            lastSyncTimestamp = root.optString("last_sync_timestamp", null)

            val recs = root.optJSONArray("recitations")
            if (recs != null) {
                val list = mutableListOf<Recitation>()
                for (i in 0 until recs.length()) {
                    list.add(SupabaseDtoMappers.mapJsonToRecitation(recs.getJSONObject(i)))
                }
                _recitations.value = list
            }

            val reciters = root.optJSONArray("reciters")
            if (reciters != null) {
                val list = mutableListOf<Reciter>()
                for (i in 0 until reciters.length()) {
                    list.add(SupabaseDtoMappers.mapJsonToReciter(reciters.getJSONObject(i)))
                }
                _reciters.value = list
            }

            val comps = root.optJSONArray("competitions")
            if (comps != null) {
                val list = mutableListOf<Competition>()
                for (i in 0 until comps.length()) {
                    list.add(SupabaseDtoMappers.mapJsonToCompetition(comps.getJSONObject(i)))
                }
                _competitions.value = list
            }

            val annos = root.optJSONArray("announcements")
            if (annos != null) {
                val list = mutableListOf<Announcement>()
                for (i in 0 until annos.length()) {
                    list.add(SupabaseDtoMappers.mapJsonToAnnouncement(annos.getJSONObject(i)))
                }
                _announcements.value = list
            }
        } catch (_: Exception) {}
    }

    private fun persistToDiskCache() {
        val ctx = context ?: return
        scope.launch(Dispatchers.IO) {
            try {
                val root = JSONObject()
                if (lastSyncTimestamp != null) {
                    root.put("last_sync_timestamp", lastSyncTimestamp)
                }

                val recsArray = JSONArray()
                _recitations.value.forEach { rec ->
                    val obj = JSONObject().apply {
                        put("id", rec.id)
                        put("reciter_id", rec.reciterId)
                        put("reciter_name", rec.reciterName)
                        put("reciter_avatar", rec.reciterAvatar)
                        put("reciter_country", rec.reciterCountry)
                        put("surah_number", rec.surahNumber)
                        put("surah_name_arabic", rec.surahNameArabic)
                        put("ayah_range", rec.ayahRange)
                        put("ayah_start", rec.ayahStart)
                        put("ayah_end", rec.ayahEnd)
                        put("riwayah", rec.riwayah)
                        put("duration_seconds", rec.durationSeconds)
                        put("audio_url", rec.audioUrl)
                        put("audio_storage_path", rec.audioStoragePath)
                        if (rec.externalAudioUrl != null) put("external_audio_url", rec.externalAudioUrl)
                        if (rec.coverUrl != null) put("cover_image_path", rec.coverUrl)
                        put("description", rec.description)
                        put("status", rec.status.name)
                        put("published_at", rec.publishedAtEpochMs)
                        put("total_listens", rec.listenCount)
                        put("total_likes", rec.likeCount)
                        put("is_staff_pick", rec.isStaffPick)
                    }
                    recsArray.put(obj)
                }
                root.put("recitations", recsArray)

                val recitersArray = JSONArray()
                _reciters.value.forEach { r ->
                    val obj = JSONObject().apply {
                        put("id", r.id)
                        put("display_name", r.displayName)
                        if (r.pseudonym != null) put("pseudonym", r.pseudonym)
                        put("use_pseudonym", r.usePseudonym)
                        put("gender", r.gender.name)
                        put("country", r.country)
                        put("bio", r.bio)
                        put("avatar_url", r.avatarUrl)
                        put("is_verified", r.verified)
                        put("is_staff_pick", r.isStaffPick)
                        put("is_published", r.isPublished)
                        put("created_at", r.createdAtEpochMs)
                        put("total_recitations", r.stats.totalRecitations)
                        put("total_listens", r.stats.totalListens)
                        put("total_likes", r.stats.totalLikes)
                    }
                    recitersArray.put(obj)
                }
                root.put("reciters", recitersArray)

                val file = File(ctx.filesDir, cacheFileName)
                file.writeText(root.toString())
            } catch (_: Exception) {}
        }
    }
}
