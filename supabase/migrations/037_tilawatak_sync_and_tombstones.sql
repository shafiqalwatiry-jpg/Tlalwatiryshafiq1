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

-- 1. Create sync_tombstones table
CREATE TABLE IF NOT EXISTS public.sync_tombstones (
    id BIGSERIAL PRIMARY KEY,
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for high-speed timestamp-based sync filtering
CREATE INDEX IF NOT EXISTS idx_sync_tombstones_lookup
    ON public.sync_tombstones(table_name, deleted_at DESC);

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

        -- Honors
        SELECT COALESCE(jsonb_agg(to_jsonb(h)), '[]'::jsonb)
        INTO v_honors
        FROM public.reciter_honors h;

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

        SELECT COALESCE(jsonb_agg(to_jsonb(h)), '[]'::jsonb)
        INTO v_honors
        FROM public.reciter_honors h
        WHERE h.created_at > p_last_sync_timestamp;

        IF p_installation_id IS NOT NULL THEN
            SELECT COALESCE(jsonb_agg(to_jsonb(n)), '[]'::jsonb)
            INTO v_notifications
            FROM public.user_notifications n
            WHERE n.installation_id = p_installation_id AND n.created_at > p_last_sync_timestamp;
        ELSE
            v_notifications := '[]'::jsonb;
        END IF;

        -- Collect all tombstones deleted after p_last_sync_timestamp
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'table', t.table_name,
            'id', t.record_id,
            'deleted_at', t.deleted_at
        )), '[]'::jsonb)
        INTO v_tombstones
        FROM public.sync_tombstones t
        WHERE t.deleted_at > p_last_sync_timestamp;
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
