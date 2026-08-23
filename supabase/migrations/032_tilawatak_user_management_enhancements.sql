-- ============================================================================
-- Migration 032: TilawatakLilAlam User Management & Suspension Enhancements
-- Description: Adds user_activity_logs table, strengthens suspension check in
-- submit_recitation_public RPC, and ensures indexes and policies for high performance.
-- ============================================================================

-- 1. Create user_activity_logs table
CREATE TABLE IF NOT EXISTS public.user_activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    installation_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    description TEXT NOT NULL,
    admin_name TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Create Indexes for High Performance User Search & Filtering
CREATE INDEX IF NOT EXISTS idx_user_profiles_installation_id ON public.user_profiles(installation_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_is_suspended ON public.user_profiles(is_suspended);
CREATE INDEX IF NOT EXISTS idx_user_profiles_is_completed ON public.user_profiles(is_profile_completed);
CREATE INDEX IF NOT EXISTS idx_user_profiles_country ON public.user_profiles(country);
CREATE INDEX IF NOT EXISTS idx_user_profiles_last_active ON public.user_profiles(last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_logs_install ON public.user_activity_logs(installation_id);

-- 3. Enable RLS on user_activity_logs
ALTER TABLE public.user_activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public insert user activity" ON public.user_activity_logs;
DROP POLICY IF EXISTS "Allow select user activity" ON public.user_activity_logs;

CREATE POLICY "Allow public insert user activity" ON public.user_activity_logs
    FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "Allow select user activity" ON public.user_activity_logs
    FOR SELECT TO anon, authenticated, service_role USING (true);

-- 4. Enhance submit_recitation_public RPC with strict suspension check
DROP FUNCTION IF EXISTS public.submit_recitation_public CASCADE;

CREATE OR REPLACE FUNCTION public.submit_recitation_public(
    p_display_name TEXT,
    p_pseudonym TEXT DEFAULT NULL,
    p_use_pseudonym BOOLEAN DEFAULT FALSE,
    p_gender TEXT DEFAULT 'MALE',
    p_country TEXT DEFAULT 'العالم الإسلامي',
    p_profile_image_path TEXT DEFAULT NULL,
    p_surah_number INTEGER DEFAULT 1,
    p_surah_name TEXT DEFAULT '',
    p_ayah_start INTEGER DEFAULT 1,
    p_ayah_end INTEGER DEFAULT 1,
    p_riwayah TEXT DEFAULT 'حفص عن عاصم',
    p_description TEXT DEFAULT '',
    p_audio_storage_path TEXT DEFAULT '',
    p_external_audio_url TEXT DEFAULT NULL,
    p_installation_id TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_is_suspended BOOLEAN := FALSE;
    v_suspended_reason TEXT := NULL;
    v_submission_id UUID;
BEGIN
    -- Check if user is suspended from submission
    IF p_installation_id IS NOT NULL THEN
        SELECT is_suspended, suspended_reason 
        INTO v_is_suspended, v_suspended_reason
        FROM public.user_profiles
        WHERE installation_id = p_installation_id;

        IF v_is_suspended THEN
            RAISE EXCEPTION 'حسابك مقيد من رفع ونشر التلاوات من قبل إدارة المنصة.% لا يمكنك رفع تلاوات جديدة.',
                COALESCE(' (السبب: ' || v_suspended_reason || ')', '');
        END IF;
    END IF;

    -- Insert recitation submission
    INSERT INTO public.recitation_submissions (
        display_name,
        pseudonym,
        use_pseudonym,
        gender,
        country,
        profile_image_path,
        surah_number,
        surah_name,
        ayah_start,
        ayah_end,
        riwayah,
        description,
        audio_storage_path,
        external_audio_url,
        installation_id,
        status,
        created_at
    ) VALUES (
        p_display_name,
        p_pseudonym,
        p_use_pseudonym,
        p_gender,
        p_country,
        p_profile_image_path,
        p_surah_number,
        p_surah_name,
        p_ayah_start,
        p_ayah_end,
        p_riwayah,
        p_description,
        p_audio_storage_path,
        p_external_audio_url,
        p_installation_id,
        'PENDING',
        NOW()
    ) RETURNING id INTO v_submission_id;

    -- Also record user activity log
    IF p_installation_id IS NOT NULL THEN
        INSERT INTO public.user_activity_logs (installation_id, event_type, description)
        VALUES (p_installation_id, 'SUBMIT_RECITATION', 'إرسال تلاوة جديدة للمراجعة (سورة ' || p_surah_name || ')');
    END IF;

    RETURN v_submission_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.submit_recitation_public TO anon, authenticated, service_role;
