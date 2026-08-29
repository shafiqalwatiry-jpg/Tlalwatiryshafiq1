-- Migration 038: Immediate Recitation Sync Hotfix
-- Fixes:
-- 1. Adds safety margin (clock skew buffer) to get_incremental_sync_diff to prevent dropped delta syncs
-- 2. Aligns public_recitations_view filters (status, is_published, reciter is_published) and columns (banner, logo)
-- 3. Guarantees newly approved / created recitations appear immediately on first open or background sync without hide/show toggle.

-- 1. Recreate public_recitations_view with full fields & resilient publication checks
DROP VIEW IF EXISTS public.public_recitations_view CASCADE;
CREATE OR REPLACE VIEW public.public_recitations_view AS
SELECT
    r.id,
    r.reciter_id,
    CASE
        WHEN rc.use_pseudonym = TRUE AND rc.pseudonym IS NOT NULL AND TRIM(rc.pseudonym) <> '' THEN rc.pseudonym
        ELSE rc.display_name
    END AS reciter_name,
    rc.profile_image_path AS reciter_avatar,
    rc.banner_image_path AS reciter_banner,
    rc.logo_image_path AS reciter_logo,
    rc.country AS reciter_country,
    r.surah_name,
    r.surah_number,
    r.ayah_start,
    r.ayah_end,
    CASE
        WHEN r.ayah_start = 1 AND (
            (r.surah_number = 1 AND r.ayah_end = 7) OR
            (r.surah_number = 108 AND r.ayah_end = 3) OR
            (r.ayah_end <= r.ayah_start)
        ) THEN 'كاملة'
        ELSE 'الآيات ' || r.ayah_start || ' - ' || r.ayah_end
    END AS ayah_range,
    r.riwayah,
    r.duration_seconds,
    r.audio_storage_path,
    r.external_audio_url,
    r.cover_image_path,
    r.description,
    r.status,
    r.is_staff_pick,
    r.published_at,
    r.created_at,
    COALESCE(r.updated_at, r.created_at) AS updated_at,
    COALESCE(ls.listen_count, 0)::BIGINT AS listen_count,
    COALESCE(lk.like_count, 0)::BIGINT AS like_count
FROM public.recitations r
JOIN public.reciters rc ON r.reciter_id = rc.id
LEFT JOIN (
    SELECT recitation_id, COUNT(*) AS listen_count
    FROM public.listen_events
    GROUP BY recitation_id
) ls ON r.id = ls.recitation_id
LEFT JOIN (
    SELECT recitation_id, COUNT(*) AS like_count
    FROM public.likes
    GROUP BY recitation_id
) lk ON r.id = lk.recitation_id
WHERE r.status = 'APPROVED'
  AND (r.is_published IS NULL OR r.is_published = TRUE)
  AND (rc.is_published IS NULL OR rc.is_published = TRUE);

GRANT SELECT ON public.public_recitations_view TO anon, authenticated, service_role;

-- 2. Enhanced get_incremental_sync_diff RPC with Clock-Skew Overlap Window
CREATE OR REPLACE FUNCTION public.get_incremental_sync_diff(
    p_last_sync_timestamp TIMESTAMPTZ,
    p_installation_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_effective_last_sync TIMESTAMPTZ;
    v_reciters JSONB;
    v_recitations JSONB;
    v_competitions JSONB;
    v_announcements JSONB;
    v_honors JSONB;
    v_notifications JSONB;
    v_tombstones JSONB;
    v_sync_time TIMESTAMPTZ := NOW();
BEGIN
    -- If p_last_sync_timestamp is NULL or older than 30 days, execute full sync
    IF p_last_sync_timestamp IS NULL THEN
        -- Reciters
        SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
        INTO v_reciters
        FROM public_reciters_view r;

        -- Recitations
        SELECT COALESCE(jsonb_agg(to_jsonb(rc)), '[]'::jsonb)
        INTO v_recitations
        FROM public_recitations_view rc;

        -- Competitions
        SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
        INTO v_competitions
        FROM public.competitions c
        WHERE c.is_published = TRUE;

        -- Announcements
        SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
        INTO v_announcements
        FROM public.announcements a
        WHERE a.is_published = TRUE;

        -- Honors
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id', h.id,
            'reciter_id', h.reciter_id,
            'reciter_name', COALESCE(rc.display_name, ''),
            'reciter_avatar', rc.profile_image_path,
            'reward_id', h.reward_id,
            'citation_note', h.citation_note,
            'awarded_at', h.awarded_at,
            'reward', jsonb_build_object(
                'id', rd.id,
                'code', rd.code,
                'title', rd.title,
                'description', rd.description,
                'category', rd.category,
                'badge_icon_path', rd.badge_icon_path,
                'is_active', rd.is_active,
                'created_at', rd.created_at
            )
        )), '[]'::jsonb)
        INTO v_honors
        FROM public.reciter_honors h
        LEFT JOIN public.reciters rc ON h.reciter_id = rc.id
        LEFT JOIN public.reward_definitions rd ON h.reward_id = rd.id;

        -- User Notifications
        IF p_installation_id IS NOT NULL THEN
            SELECT COALESCE(jsonb_agg(to_jsonb(n)), '[]'::jsonb)
            INTO v_notifications
            FROM public.user_notifications n
            WHERE n.installation_id = p_installation_id;
        ELSE
            v_notifications := '[]'::jsonb;
        END IF;

        v_tombstones := '[]'::jsonb;
    ELSE
        -- Incremental with 120-second safety window to absorb clock skew, transaction delays, and transit lag
        v_effective_last_sync := GREATEST(p_last_sync_timestamp - INTERVAL '120 seconds', '1970-01-01'::TIMESTAMPTZ);

        SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
        INTO v_reciters
        FROM public_reciters_view r
        WHERE r.updated_at > v_effective_last_sync;

        SELECT COALESCE(jsonb_agg(to_jsonb(rc)), '[]'::jsonb)
        INTO v_recitations
        FROM public_recitations_view rc
        WHERE rc.updated_at > v_effective_last_sync;

        SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
        INTO v_competitions
        FROM public.competitions c
        WHERE c.is_published = TRUE AND c.updated_at > v_effective_last_sync;

        SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
        INTO v_announcements
        FROM public.announcements a
        WHERE a.is_published = TRUE AND a.updated_at > v_effective_last_sync;

        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id', h.id,
            'reciter_id', h.reciter_id,
            'reciter_name', COALESCE(rc.display_name, ''),
            'reciter_avatar', rc.profile_image_path,
            'reward_id', h.reward_id,
            'citation_note', h.citation_note,
            'awarded_at', h.awarded_at,
            'reward', jsonb_build_object(
                'id', rd.id,
                'code', rd.code,
                'title', rd.title,
                'description', rd.description,
                'category', rd.category,
                'badge_icon_path', rd.badge_icon_path,
                'is_active', rd.is_active,
                'created_at', rd.created_at
            )
        )), '[]'::jsonb)
        INTO v_honors
        FROM public.reciter_honors h
        LEFT JOIN public.reciters rc ON h.reciter_id = rc.id
        LEFT JOIN public.reward_definitions rd ON h.reward_id = rd.id
        WHERE h.awarded_at > v_effective_last_sync;

        IF p_installation_id IS NOT NULL THEN
            SELECT COALESCE(jsonb_agg(to_jsonb(n)), '[]'::jsonb)
            INTO v_notifications
            FROM public.user_notifications n
            WHERE n.installation_id = p_installation_id AND n.created_at > v_effective_last_sync;
        ELSE
            v_notifications := '[]'::jsonb;
        END IF;

        -- Collect all tombstones: deleted items + items updated to unpublished/rejected
        SELECT COALESCE(jsonb_agg(t_union.item), '[]'::jsonb)
        INTO v_tombstones
        FROM (
            SELECT jsonb_build_object(
                'table', t.table_name,
                'id', t.record_id,
                'deleted_at', t.deleted_at
            ) AS item
            FROM public.sync_tombstones t
            WHERE t.deleted_at > v_effective_last_sync

            UNION ALL

            SELECT jsonb_build_object(
                'table', 'reciters',
                'id', r_unpub.id::TEXT,
                'deleted_at', r_unpub.updated_at
            ) AS item
            FROM public.reciters r_unpub
            WHERE r_unpub.is_published = FALSE AND r_unpub.updated_at > v_effective_last_sync

            UNION ALL

            SELECT jsonb_build_object(
                'table', 'recitations',
                'id', rc_unapp.id::TEXT,
                'deleted_at', rc_unapp.updated_at
            ) AS item
            FROM public.recitations rc_unapp
            JOIN public.reciters rc_parent ON rc_unapp.reciter_id = rc_parent.id
            WHERE (rc_unapp.status <> 'APPROVED' OR rc_unapp.is_published = FALSE OR rc_parent.is_published = FALSE)
              AND rc_unapp.updated_at > v_effective_last_sync
        ) t_union;
    END IF;

    RETURN jsonb_build_object(
        'sync_timestamp', v_sync_time,
        'reciters', v_reciters,
        'recitations', v_recitations,
        'competitions', v_competitions,
        'announcements', v_announcements,
        'honors', v_honors,
        'notifications', v_notifications,
        'tombstones', v_tombstones
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_incremental_sync_diff(TIMESTAMPTZ, TEXT) TO anon, authenticated, service_role;
