package com.tilawatak.data.remote

import com.tilawatak.lilalam.BuildConfig

enum class DataSourceMode {
    MOCK,
    SUPABASE
}

/**
 * Replaceable Supabase Configuration Abstraction.
 * NEVER hardcodes private secret keys or service role keys.
 * Only uses the public Supabase URL and anonymous public API key.
 */
object SupabaseConfig {

    const val DEFAULT_SUPABASE_URL = "https://ixkganrxtkywypvqkqkn.supabase.co"
    // Public anonymous key (read-only for published content + public submission insertion)
    const val DEFAULT_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4a2dhbnJ4dGt5d3lwdnFrcWtuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3MjM3OTYsImV4cCI6MjEwMjI5OTc5Nn0.SPHzwpfZpCpo6vrbKZ5wjiPlQE9e7UTMEbPcZGZ7gRQ"

    @Volatile
    var currentMode: DataSourceMode = DataSourceMode.SUPABASE

    @Volatile
    var supabaseUrl: String = try {
        BuildConfig.SUPABASE_URL.ifBlank { DEFAULT_SUPABASE_URL }
    } catch (e: Throwable) {
        DEFAULT_SUPABASE_URL
    }

    @Volatile
    var supabaseAnonKey: String = try {
        BuildConfig.SUPABASE_ANON_KEY.ifBlank { DEFAULT_ANON_KEY }
    } catch (e: Throwable) {
        DEFAULT_ANON_KEY
    }

    val restBaseUrl: String
        get() = "$supabaseUrl/rest/v1"

    val storageBaseUrl: String
        get() = "$supabaseUrl/storage/v1"

    /**
     * Convert Google Drive audio or image share links to direct streaming URLs
     */
    fun transformGoogleDriveUrl(url: String): String {
        if (url.isBlank() || (!url.contains("drive.google.com") && !url.contains("docs.google.com"))) {
            return url
        }
        val fileIdRegex = Regex("""(?:/file/d/|[?&]id=)([a-zA-Z0-9_-]+)""")
        val match = fileIdRegex.find(url)
        val fileId = match?.groupValues?.getOrNull(1)
        return if (!fileId.isNullOrBlank()) {
            "https://docs.google.com/uc?export=download&id=$fileId"
        } else {
            url
        }
    }

    fun isValidAudioUrl(url: String?): Boolean {
        if (url.isNullOrBlank()) return false
        val trimmed = url.trim()
        if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://") && !trimmed.startsWith("blob:") && !trimmed.startsWith("file://")) {
            return false
        }
        val lower = trimmed.toLowerCase()
        if (lower.contains("supabase.com/dashboard") ||
            lower.contains("google.com/search") ||
            lower.contains("youtube.com/watch") ||
            lower.contains("youtu.be") ||
            lower.endsWith(".html") ||
            lower.endsWith(".htm") ||
            lower.endsWith(".php")
        ) {
            return false
        }
        return true
    }

    /**
     * Resolves storage path to a complete public URL without duplicating bucket names.
     */
    fun getPublicStorageUrl(path: String?, defaultBucket: String): String {
        if (path.isNullOrBlank()) return ""
        val trimmed = path.trim()
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("blob:") || trimmed.startsWith("file://")) {
            return trimmed
        }
        val cleanPath = if (trimmed.startsWith("/")) trimmed.substring(1) else trimmed
        val parts = cleanPath.split("/").filter { it.isNotBlank() }
        return if (parts.size >= 2) {
            val bucket = parts[0]
            val objPath = parts.subList(1, parts.size).joinToString("/")
            "$storageBaseUrl/object/public/$bucket/$objPath"
        } else {
            "$storageBaseUrl/object/public/$defaultBucket/$cleanPath"
        }
    }

    fun getPublicAudioUrl(storagePath: String?): String {
        return getPublicStorageUrl(storagePath, SupabaseContracts.BUCKET_RECITATION_AUDIO)
    }

    fun getPublicCoverUrl(coverPath: String?): String? {
        if (coverPath.isNullOrBlank()) return null
        return getPublicStorageUrl(coverPath, SupabaseContracts.BUCKET_RECITATION_COVERS).ifBlank { null }
    }

    fun getPublicAvatarUrl(avatarPath: String?): String {
        if (avatarPath.isNullOrBlank()) return ""
        if (avatarPath.contains("drive.google.com") || avatarPath.contains("docs.google.com")) {
            val fileIdRegex = Regex("""(?:/file/d/|[?&]id=)([a-zA-Z0-9_-]+)""")
            val match = fileIdRegex.find(avatarPath)
            val fileId = match?.groupValues?.getOrNull(1)
            if (!fileId.isNullOrBlank()) {
                return "https://lh3.googleusercontent.com/d/$fileId"
            }
        }
        return getPublicStorageUrl(avatarPath, SupabaseContracts.BUCKET_PROFILE_IMAGES)
    }

    /**
     * Resolves full audio URL following 3-step hierarchy:
     * 1. external_audio_url
     * 2. audio_storage_path
     * 3. audio_url
     */
    fun resolveAudioUrl(
        externalAudioUrl: String?,
        audioStoragePath: String?,
        directAudioUrl: String?
    ): String {
        if (!externalAudioUrl.isNullOrBlank()) {
            val transformed = transformGoogleDriveUrl(externalAudioUrl.trim())
            if (isValidAudioUrl(transformed)) {
                return transformed
            }
        }
        if (!audioStoragePath.isNullOrBlank()) {
            val storageUrl = getPublicAudioUrl(audioStoragePath.trim())
            if (isValidAudioUrl(storageUrl)) {
                return storageUrl
            }
        }
        if (!directAudioUrl.isNullOrBlank()) {
            val transformed = transformGoogleDriveUrl(directAudioUrl.trim())
            if (isValidAudioUrl(transformed)) {
                return transformed
            }
        }
        return ""
    }
}

