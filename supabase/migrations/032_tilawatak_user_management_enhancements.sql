-- ============================================================================
-- Migration 032 (Revised): TilawatakLilAlam User Management & Security Enhancements
-- Description: Adds user_activity_logs table with strict RLS, strengthens 
-- submit_recitation_public RPC with suspension check and audio validation without 
-- using CASCADE or breaking existing signatures, and ensures search_path security.
-- ============================================================================

-- 1. Create user_activity_logs table if not exists
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

-- 3. Enable RLS on user_activity_logs and enforce strict admin-only read policy
ALTER TABLE public.user_activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public insert user activity" ON public.user_activity_logs;
DROP POLICY IF EXISTS "Allow select user activity" ON public.user_activity_logs;
DROP POLICY IF EXISTS "Admin only activity logs access" ON public.user_activity_logs;

-- Regular users cannot read or insert raw activity logs directly. 
-- Only administrators or service_role can query or insert activity logs.
CREATE POLICY "Admin only activity logs access" ON public.user_activity_logs
    FOR ALL TO anon, authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- 4. Secure helper RPC to log user activity (SECURITY DEFINER with fixed search_path)
CREATE OR REPLACE FUNCTION public.log_user_activity_secure(
    p_installation_id TEXT,
    p_event_type TEXT,
    p_description TEXT,
    p_admin_name TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO public.user_activity_logs (
        installation_id,
        event_type,
        description,
        admin_name,
        metadata
    ) VALUES (
        p_installation_id,
        p_event_type,
        p_description,
        COALESCE(p_admin_name, 'النظام'),
        p_metadata
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.log_user_activity_secure TO anon, authenticated, service_role;

-- 5. Enhance submit_recitation_public without using DROP FUNCTION ... CASCADE
-- Preserves the exact signature from migration 029 while adding suspension check and audio validation.
CREATE OR REPLACE FUNCTION public.submit_recitation_public(
    p_display_name TEXT,
    p_pseudonym TEXT DEFAULT NULL,
    p_use_pseudonym BOOLEAN DEFAULT FALSE,
    p_gender TEXT DEFAULT 'MALE',
    p_country TEXT DEFAULT 'العالم الإسلامي',
    p_surah_number INTEGER DEFAULT 1,
    p_surah_name TEXT DEFAULT '',
    p_ayah_start INTEGER DEFAULT 1,
    p_ayah_end INTEGER DEFAULT 1,
    p_riwayah TEXT DEFAULT 'حفص عن عاصم',
    p_description TEXT DEFAULT '',
    p_audio_storage_path TEXT DEFAULT '',
    p_external_audio_url TEXT DEFAULT NULL,
    p_profile_image_path TEXT DEFAULT NULL,
    p_installation_id TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_is_suspended BOOLEAN := FALSE;
    v_suspended_reason TEXT := NULL;
    v_new_id UUID;
    v_clean_gender TEXT;
BEGIN
    -- Validate required display name
    IF p_display_name IS NULL OR TRIM(p_display_name) = '' THEN
        RAISE EXCEPTION 'Display name is required';
    END IF;

    -- Validate audio source existence (either Supabase Storage path or direct valid external URL)
    IF (p_audio_storage_path IS NULL OR TRIM(p_audio_storage_path) = '') 
       AND (p_external_audio_url IS NULL OR TRIM(p_external_audio_url) = '') THEN
        RAISE EXCEPTION 'A valid audio storage path or external audio URL is required';
    END IF;

    -- Check if user is suspended from submission
    IF p_installation_id IS NOT NULL AND TRIM(p_installation_id) <> '' THEN
        SELECT is_suspended, suspended_reason 
        INTO v_is_suspended, v_suspended_reason
        FROM public.user_profiles
        WHERE installation_id = p_installation_id;

        IF v_is_suspended THEN
            RAISE EXCEPTION 'حسابك مقيد من رفع ونشر التلاوات من قبل إدارة المنصة.% لا يمكنك رفع تلاوات جديدة.',
                COALESCE(' (السبب: ' || v_suspended_reason || ')', '');
        END IF;
    END IF;

    v_clean_gender := UPPER(TRIM(COALESCE(p_gender, 'MALE')));
    IF v_clean_gender NOT IN ('MALE', 'FEMALE') THEN
        v_clean_gender := 'MALE';
    END IF;

    INSERT INTO public.recitation_submissions (
        display_name,
        pseudonym,
        use_pseudonym,
        gender,
        country,
        surah_number,
        surah_name,
        ayah_start,
        ayah_end,
        riwayah,
        description,
        audio_storage_path,
        external_audio_url,
        profile_image_path,
        installation_id,
        status,
        created_at
    ) VALUES (
        TRIM(p_display_name),
        NULLIF(TRIM(COALESCE(p_pseudonym, '')), ''),
        p_use_pseudonym,
        v_clean_gender,
        COALESCE(NULLIF(TRIM(p_country), ''), 'العالم الإسلامي'),
        GREATEST(1, LEAST(114, COALESCE(p_surah_number, 1))),
        COALESCE(NULLIF(TRIM(p_surah_name), ''), 'سورة الفاتحة'),
        GREATEST(1, COALESCE(p_ayah_start, 1)),
        GREATEST(1, COALESCE(p_ayah_end, 1)),
        COALESCE(NULLIF(TRIM(p_riwayah), ''), 'حفص عن عاصم'),
        COALESCE(TRIM(p_description), ''),
        COALESCE(TRIM(p_audio_storage_path), ''),
        NULLIF(TRIM(COALESCE(p_external_audio_url, '')), ''),
        NULLIF(TRIM(COALESCE(p_profile_image_path, '')), ''),
        NULLIF(TRIM(COALESCE(p_installation_id, '')), ''),
        'PENDING',
        NOW()
    )
    RETURNING id INTO v_new_id;

    -- Generate admin in-app notification for incoming submission
    INSERT INTO public.admin_notifications (
        notification_type,
        title,
        content,
        reference_id,
        is_read,
        created_at
    ) VALUES (
        'NEW_SUBMISSION',
        'طلب تلاوة جديد: ' || COALESCE(NULLIF(TRIM(p_surah_name), ''), 'سورة قرطانية'),
        'أرسل القارئ ' || TRIM(p_display_name) || ' طلب تلاوة جديد وهو بانتظار المراجعة والاعتماد.',
        v_new_id::TEXT,
        FALSE,
        NOW()
    );

    -- Record activity log securely via helper
    IF p_installation_id IS NOT NULL AND TRIM(p_installation_id) <> '' THEN
        PERFORM public.log_user_activity_secure(
            p_installation_id,
            'SUBMIT_RECITATION',
            'إرسال تلاوة جديدة للمراجعة (سورة ' || COALESCE(p_surah_name, '') || ')',
            'النظام'
        );
    END IF;

    RETURN v_new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.submit_recitation_public TO anon, authenticated, service_role;
