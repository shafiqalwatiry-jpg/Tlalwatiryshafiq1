-- ============================================================================
-- Migration 033: Reciter Visual Identity Enhancements (Banner & Logo)
-- Description: Adds banner_image_path and logo_image_path to reciters table,
-- and updates public_reciters_view, reciter_statistics_view, and recitation_statistics_view.
-- ============================================================================

-- 1. Add columns to reciters table if not exists
ALTER TABLE public.reciters ADD COLUMN IF NOT EXISTS banner_image_path TEXT;
ALTER TABLE public.reciters ADD COLUMN IF NOT EXISTS logo_image_path TEXT;

-- 2. Recreate public_reciters_view to include banner and logo
DROP VIEW IF EXISTS public.public_reciters_view CASCADE;
CREATE OR REPLACE VIEW public.public_reciters_view AS
SELECT
    id,
    CASE
        WHEN use_pseudonym = TRUE AND pseudonym IS NOT NULL AND TRIM(pseudonym) <> '' THEN pseudonym
        ELSE display_name
    END AS public_name,
    gender,
    country,
    bio,
    profile_image_path,
    banner_image_path,
    logo_image_path,
    is_verified,
    is_featured,
    is_published,
    created_at,
    updated_at
FROM reciters
WHERE is_published = TRUE;

GRANT SELECT ON public.public_reciters_view TO anon, authenticated, service_role;

-- 3. Recreate reciter_statistics_view to include banner and logo
DROP VIEW IF EXISTS public.reciter_statistics_view CASCADE;
CREATE OR REPLACE VIEW public.reciter_statistics_view AS
SELECT
    rc.id AS reciter_id,
    CASE
        WHEN rc.use_pseudonym = TRUE AND rc.pseudonym IS NOT NULL AND TRIM(rc.pseudonym) <> '' THEN rc.pseudonym
        ELSE rc.display_name
    END AS public_name,
    rc.gender,
    rc.country,
    rc.bio,
    rc.profile_image_path,
    rc.banner_image_path,
    rc.logo_image_path,
    rc.is_verified,
    rc.is_featured,
    rc.is_published,
    rc.created_at,
    COALESCE(rec_stats.total_recitations, 0)::BIGINT AS total_recitations,
    COALESCE(lk_stats.total_likes, 0)::BIGINT AS total_likes,
    COALESCE(ls_stats.total_listens, 0)::BIGINT AS total_listens,
    (
        (COALESCE(lk_stats.total_likes, 0)::BIGINT * 3) +
        (COALESCE(ls_stats.total_listens, 0)::BIGINT * 1) +
        (COALESCE(rec_stats.total_recitations, 0)::BIGINT * 5)
    )::BIGINT AS ranking_score,
    rc.id AS id,
    rc.display_name,
    rc.pseudonym,
    rc.use_pseudonym,
    rc.profile_image_path AS avatar_url,
    rc.banner_image_path AS banner_url,
    rc.logo_image_path AS logo_url
FROM public.reciters rc
LEFT JOIN (
    SELECT reciter_id, COUNT(*) AS total_recitations
    FROM public.recitations
    WHERE status = 'APPROVED' AND (is_published IS NULL OR is_published = TRUE)
    GROUP BY reciter_id
) rec_stats ON rec_stats.reciter_id = rc.id
LEFT JOIN (
    SELECT r.reciter_id, COUNT(l.id) AS total_likes
    FROM public.recitations r
    JOIN public.likes l ON l.recitation_id = r.id
    WHERE r.status = 'APPROVED' AND (r.is_published IS NULL OR r.is_published = TRUE)
    GROUP BY r.reciter_id
) lk_stats ON lk_stats.reciter_id = rc.id
LEFT JOIN (
    SELECT r.reciter_id, COUNT(le.id) AS total_listens
    FROM public.recitations r
    JOIN public.listen_events le ON le.recitation_id = r.id
    WHERE r.status = 'APPROVED' AND (r.is_published IS NULL OR r.is_published = TRUE)
    GROUP BY r.reciter_id
) ls_stats ON ls_stats.reciter_id = rc.id
WHERE rc.is_published = TRUE;

GRANT SELECT ON public.reciter_statistics_view TO anon, authenticated, service_role;

-- 4. Recreate recitation_statistics_view to include reciter banner and logo
DROP VIEW IF EXISTS public.recitation_statistics_view CASCADE;
CREATE OR REPLACE VIEW public.recitation_statistics_view AS
SELECT
    r.id AS recitation_id,
    r.reciter_id,
    r.surah_name,
    r.surah_number,
    r.ayah_start,
    r.ayah_end,
    r.riwayah,
    r.duration_seconds,
    r.audio_storage_path,
    r.external_audio_url,
    r.cover_image_path,
    r.status,
    r.is_staff_pick,
    r.published_at,
    COALESCE(lk.total_likes, 0)::BIGINT AS total_likes,
    COALESCE(le.total_listens, 0)::BIGINT AS total_listens,
    r.id AS id,
    CASE
        WHEN rc.use_pseudonym = TRUE AND rc.pseudonym IS NOT NULL AND TRIM(rc.pseudonym) <> '' THEN rc.pseudonym
        ELSE rc.display_name
    END AS reciter_name,
    rc.profile_image_path AS reciter_avatar,
    rc.banner_image_path AS reciter_banner,
    rc.logo_image_path AS reciter_logo,
    rc.country AS reciter_country,
    CASE
        WHEN r.ayah_start = 1 AND ((r.surah_number = 1 AND r.ayah_end = 7) OR (r.surah_number = 108 AND r.ayah_end = 3) OR (r.ayah_end <= r.ayah_start)) THEN 'كاملة'
        ELSE 'الآيات ' || r.ayah_start || ' - ' || r.ayah_end
    END AS ayah_range,
    r.description,
    r.created_at,
    COALESCE(lk.total_likes, 0)::BIGINT AS like_count,
    COALESCE(le.total_listens, 0)::BIGINT AS listen_count
FROM public.recitations r
JOIN public.reciters rc ON rc.id = r.reciter_id
LEFT JOIN (
    SELECT recitation_id, COUNT(*) AS total_likes
    FROM public.likes
    GROUP BY recitation_id
) lk ON lk.recitation_id = r.id
LEFT JOIN (
    SELECT recitation_id, COUNT(*) AS total_listens
    FROM public.listen_events
    GROUP BY recitation_id
) le ON le.recitation_id = r.id
WHERE r.status = 'APPROVED' AND rc.is_published = TRUE AND (r.is_published IS NULL OR r.is_published = TRUE);

GRANT SELECT ON public.recitation_statistics_view TO anon, authenticated, service_role;
