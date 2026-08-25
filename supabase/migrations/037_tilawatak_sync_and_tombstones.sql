-- ============================================================================
-- Migration 037: Tilawatak Incremental Sync & Tombstones Architecture
-- Platform: TilawatakLilAlam (تلاوتك للعالم)
-- Description:
-- 1. Creates `sync_tombstones` table to track deleted records for client-side Incremental Sync.
-- 2. Creates automatic deletion triggers on core tables (reciters, recitations, competitions, announcements, reciter_honors, user_notifications).
-- 3. Configures REPLICA IDENTITY FULL and adds all core tables to `supabase_realtime` publication.
-- 4. Exposes fast RPC `get_incremental_sync_diff` for consolidated delta queries.
-- 5. Configures RLS policies granting public read access to sync tombstones.
-- ============================================================================

-- 1. Ensure public_recitations_view includes updated_at, listen_count, and like_count
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
WHERE r.status = 'APPROVED' AND rc.is_published = TRUE;

GRANT SELECT ON public.public_recitations_view TO anon, authenticated, service_role;

-- 2. Create sync_tombstones table
CREATE TABLE IF NOT EXISTS public.sync_tombstones (
    id BIGSERIAL PRIMARY KEY,
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for high-speed timestamp-based sync filtering
CREATE INDEX IF NOT EXISTS idx_sync_tombstones_lookup
    ON public.sync_tombstones(table_name, deleted_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_tombstones_deleted_at
    ON public.sync_tombstones(deleted_at DESC);

-- 2. Trigger function to record deleted items in sync_tombstones
CREATE OR REPLACE FUNCTION public.trg_log_sync_tombstone()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.sync_tombstones (table_name, record_id, deleted_at)
    VALUES (TG_TABLE_NAME, OLD.id::TEXT, NOW());
    RETURN OLD;
END;
$$;

-- 3. Attach tombstone triggers to tables
DROP TRIGGER IF EXISTS trg_tombstone_reciters ON public.reciters;
CREATE TRIGGER trg_tombstone_reciters
    AFTER DELETE ON public.reciters
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_log_sync_tombstone();

DROP TRIGGER IF EXISTS trg_tombstone_recitations ON public.recitations;
CREATE TRIGGER trg_tombstone_recitations
    AFTER DELETE ON public.recitations
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_log_sync_tombstone();

DROP TRIGGER IF EXISTS trg_tombstone_competitions ON public.competitions;
CREATE TRIGGER trg_tombstone_competitions
    AFTER DELETE ON public.competitions
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_log_sync_tombstone();

DROP TRIGGER IF EXISTS trg_tombstone_announcements ON public.announcements;
CREATE TRIGGER trg_tombstone_announcements
    AFTER DELETE ON public.announcements
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_log_sync_tombstone();

DROP TRIGGER IF EXISTS trg_tombstone_reciter_honors ON public.reciter_honors;
CREATE TRIGGER trg_tombstone_reciter_honors
    AFTER DELETE ON public.reciter_honors
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_log_sync_tombstone();

DROP TRIGGER IF EXISTS trg_tombstone_user_notifications ON public.user_notifications;
CREATE TRIGGER trg_tombstone_user_notifications
    AFTER DELETE ON public.user_notifications
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_log_sync_tombstone();

-- 4. Enable REPLICA IDENTITY FULL on all syncable tables
ALTER TABLE public.reciters REPLICA IDENTITY FULL;
ALTER TABLE public.recitations REPLICA IDENTITY FULL;
ALTER TABLE public.competitions REPLICA IDENTITY FULL;
ALTER TABLE public.announcements REPLICA IDENTITY FULL;
ALTER TABLE public.reciter_honors REPLICA IDENTITY FULL;
ALTER TABLE public.likes REPLICA IDENTITY FULL;
ALTER TABLE public.sync_tombstones REPLICA IDENTITY FULL;

-- 5. Register all tables in supabase_realtime publication
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.reciters;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;

        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.recitations;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;

        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.competitions;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;

        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.announcements;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;

        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.reciter_honors;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;

        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.likes;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;

        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.sync_tombstones;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
    END IF;
END $$;

-- 6. Configure RLS Policies on sync_tombstones
ALTER TABLE public.sync_tombstones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view sync tombstones" ON public.sync_tombstones;
CREATE POLICY "Public can view sync tombstones"
    ON public.sync_tombstones
    FOR SELECT
    USING (true);

GRANT SELECT ON public.sync_tombstones TO anon, authenticated, service_role;

-- 7. High-efficiency RPC for consolidated incremental sync
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
    v_reciters JSONB;
    v_recitations JSONB;
    v_competitions JSONB;
    v_announcements JSONB;
    v_honors JSONB;
    v_notifications JSONB;
    v_tombstones JSONB;
    v_sync_time TIMESTAMPTZ := NOW();
BEGIN
    -- If p_last_sync_timestamp is NULL, client wants everything (full initial sync)
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

        -- Honors (with joined reciter and reward details)
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

        -- User Notifications (if installation_id provided)
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
        -- Incremental: Only items updated after p_last_sync_timestamp
        SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
        INTO v_reciters
        FROM public_reciters_view r
        WHERE r.updated_at > p_last_sync_timestamp;

        SELECT COALESCE(jsonb_agg(to_jsonb(rc)), '[]'::jsonb)
        INTO v_recitations
        FROM public_recitations_view rc
        WHERE rc.updated_at > p_last_sync_timestamp;

        SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
        INTO v_competitions
        FROM public.competitions c
        WHERE c.is_published = TRUE AND c.updated_at > p_last_sync_timestamp;

        SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
        INTO v_announcements
        FROM public.announcements a
        WHERE a.is_published = TRUE AND a.updated_at > p_last_sync_timestamp;

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
        WHERE h.awarded_at > p_last_sync_timestamp;

        IF p_installation_id IS NOT NULL THEN
            SELECT COALESCE(jsonb_agg(to_jsonb(n)), '[]'::jsonb)
            INTO v_notifications
            FROM public.user_notifications n
            WHERE n.installation_id = p_installation_id AND n.created_at > p_last_sync_timestamp;
        ELSE
            v_notifications := '[]'::jsonb;
        END IF;

        -- Collect all tombstones: deleted items + items updated to unpublished/rejected
        SELECT COALESCE(jsonb_agg(t_union.item), '[]'::jsonb)
        INTO v_tombstones
        FROM (
            -- Explicit deletions from sync_tombstones
            SELECT jsonb_build_object(
                'table', t.table_name,
                'id', t.record_id,
                'deleted_at', t.deleted_at
            ) AS item
            FROM public.sync_tombstones t
            WHERE t.deleted_at > p_last_sync_timestamp

            UNION ALL

            -- Reciters that were unpublished since last sync
            SELECT jsonb_build_object(
                'table', 'reciters',
                'id', r_unpub.id::TEXT,
                'deleted_at', r_unpub.updated_at
            ) AS item
            FROM public.reciters r_unpub
            WHERE r_unpub.is_published = FALSE AND r_unpub.updated_at > p_last_sync_timestamp

            UNION ALL

            -- Recitations that were rejected/unapproved or reciter unpublished since last sync
            SELECT jsonb_build_object(
                'table', 'recitations',
                'id', rc_unapp.id::TEXT,
                'deleted_at', rc_unapp.updated_at
            ) AS item
            FROM public.recitations rc_unapp
            JOIN public.reciters rc_parent ON rc_unapp.reciter_id = rc_parent.id
            WHERE (rc_unapp.status <> 'APPROVED' OR rc_parent.is_published = FALSE)
              AND rc_unapp.updated_at > p_last_sync_timestamp
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
