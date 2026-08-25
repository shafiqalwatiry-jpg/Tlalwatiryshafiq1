package com.tilawatak.data.remote.repository

import com.tilawatak.data.remote.SupabaseContracts
import com.tilawatak.data.remote.dto.SupabaseDtoMappers
import com.tilawatak.data.remote.http.SupabaseHttpClient
import com.tilawatak.data.remote.sync.TilawatakSyncEngine
import com.tilawatak.domain.model.RecitationSubmission
import com.tilawatak.domain.model.SubmissionStatus
import com.tilawatak.domain.repository.ISubmissionRepository
import kotlinx.coroutines.flow.Flow
import java.util.UUID

class SupabaseSubmissionRepository(
    private val syncEngine: TilawatakSyncEngine = TilawatakSyncEngine.getInstance()
) : ISubmissionRepository {

    override fun getUserSubmissions(): Flow<List<RecitationSubmission>> {
        return syncEngine.userSubmissions
    }

    /**
     * Submits a new recitation into Supabase recitation_submissions table.
     * Enforces PENDING status via database RLS and triggers.
     */
    override suspend fun submitRecitation(submission: RecitationSubmission): Result<RecitationSubmission> {
        val submissionId = if (submission.id.isNotBlank()) submission.id else UUID.randomUUID().toString()
        val storagePath = if (submission.audioStoragePath.isNotBlank()) {
            submission.audioStoragePath
        } else {
            "pending/${System.currentTimeMillis()}_${submissionId}.mp3"
        }

        val submissionToPersist = submission.copy(
            id = submissionId,
            audioStoragePath = storagePath,
            status = SubmissionStatus.PENDING,
            submittedAtEpochMs = System.currentTimeMillis()
        )

        // Strategy 1: Call secure RPC submit_recitation_public
        val rpcPayload = org.json.JSONObject().apply {
            put("p_display_name", submissionToPersist.displayName)
            if (!submissionToPersist.pseudonym.isNullOrBlank()) {
                put("p_pseudonym", submissionToPersist.pseudonym)
            } else {
                put("p_pseudonym", org.json.JSONObject.NULL)
            }
            put("p_use_pseudonym", submissionToPersist.usePseudonym)
            put("p_gender", submissionToPersist.gender.name)
            put("p_country", submissionToPersist.country)
            if (!submissionToPersist.profileImagePath.isNullOrBlank()) {
                put("p_profile_image_path", submissionToPersist.profileImagePath)
            } else {
                put("p_profile_image_path", org.json.JSONObject.NULL)
            }
            put("p_surah_number", submissionToPersist.surahNumber)
            put("p_surah_name", submissionToPersist.surahName)
            put("p_ayah_start", submissionToPersist.ayahStart)
            put("p_ayah_end", submissionToPersist.ayahEnd)
            put("p_riwayah", submissionToPersist.riwayah)
            put("p_description", submissionToPersist.description)
            put("p_audio_storage_path", submissionToPersist.audioStoragePath)
            if (!submissionToPersist.externalAudioUrl.isNullOrBlank()) {
                put("p_external_audio_url", submissionToPersist.externalAudioUrl)
            } else {
                put("p_external_audio_url", org.json.JSONObject.NULL)
            }
        }

        val rpcResult = SupabaseHttpClient.rpc(SupabaseContracts.RPC_SUBMIT_RECITATION, rpcPayload)
        if (rpcResult.isSuccess) {
            val jsonStr = rpcResult.getOrNull() ?: ""
            val createdId = jsonStr.replace("\"", "").trim()
            val finalSubmission = submissionToPersist.copy(id = if (createdId.isNotBlank()) createdId else submissionId)
            syncEngine.addLocalSubmission(finalSubmission)
            return Result.success(finalSubmission)
        }

        // Strategy 2: Direct REST POST
        val jsonPayload = SupabaseDtoMappers.mapSubmissionToJson(submissionToPersist)
        val restResponse = SupabaseHttpClient.post(
            endpoint = SupabaseContracts.TABLE_SUBMISSIONS,
            jsonBody = jsonPayload.toString(),
            preferReturnRepresentation = false
        )

        if (restResponse.isSuccess) {
            syncEngine.addLocalSubmission(submissionToPersist)
            return Result.success(submissionToPersist)
        }

        val error = restResponse.exceptionOrNull()
            ?: rpcResult.exceptionOrNull()
            ?: Exception("تعذر إرسال التلاوة، تحقق من الاتصال بالإنترنت وحاول مرة أخرى")
        return Result.failure(error)
    }

    /**
     * Uploads audio bytes to private Supabase storage bucket 'submission-audio'.
     */
    suspend fun uploadSubmissionAudio(
        fileName: String,
        audioBytes: ByteArray,
        mimeType: String = "audio/mpeg"
    ): Result<String> {
        val path = "pending/${System.currentTimeMillis()}_$fileName"
        return SupabaseHttpClient.uploadFile(
            bucketName = SupabaseContracts.BUCKET_SUBMISSION_AUDIO,
            filePath = path,
            fileBytes = audioBytes,
            mimeType = mimeType
        )
    }

    /**
     * Uploads profile image bytes to private Supabase storage bucket 'submission-images'.
     */
    suspend fun uploadSubmissionImage(
        fileName: String,
        imageBytes: ByteArray,
        mimeType: String = "image/jpeg"
    ): Result<String> {
        val path = "avatars/${System.currentTimeMillis()}_$fileName"
        return SupabaseHttpClient.uploadFile(
            bucketName = SupabaseContracts.BUCKET_SUBMISSION_IMAGES,
            filePath = path,
            fileBytes = imageBytes,
            mimeType = mimeType
        )
    }
}

