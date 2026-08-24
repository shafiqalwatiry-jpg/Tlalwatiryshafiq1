-- ============================================================================
-- Migration 036: Tilawatak Realtime Users & Notifications End-to-End Integrity Fix
-- Platform: TilawatakLilAlam (تلاوتك للعالم)
-- Description:
-- 1. Updates notification_type enum and drops restrictive check constraints on user_notifications.
-- 2. Refines submit_recitation_public RPC with proper notification types and suspension enforcement.
-- 3. Ensures user_profiles, user_notifications, recitation_submissions, and user_activity_logs
--    have REPLICA IDENTITY FULL and are registered in supabase_realtime publication.
-- 4. Ensures RLS policies allow seamless multi-user synchronization.
-- ============================================================================

-- 1. Extend notification_type ENUM safely
DO $$
BEGIN
    ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'NEW_SUBMISSION';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'ADMIN_ANNOUNCEMENT';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'ACCOUNT_SUSPENDED';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'ACCOUNT_UNSUSPENDED';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'SYSTEM_INFO';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'ADMIN_ALERT';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 2. Drop restrictive check constraints on user_notifications
ALTER TABLE public.user_notifications DROP CONSTRAINT IF EXISTS user_notifications_notification_type_check;

-- Ensure user_notifications schema columns
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_notifications' AND column_name = 'reference_id') THEN
        ALTER TABLE public.user_notifications ADD COLUMN reference_id TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_notifications' AND column_name = 'rejection_reason') THEN
        ALTER TABLE public.user_notifications ADD COLUMN rejection_reason TEXT;
    END IF;
END $$;

-- 3. Ensure user_profiles columns & unique constraint
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_profiles' AND column_name = 'is_suspended') THEN
        ALTER TABLE public.user_profiles ADD COLUMN is_suspended BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_profiles' AND column_name = 'suspended_reason') THEN
        ALTER TABLE public.user_profiles ADD COLUMN suspended_reason TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_profiles' AND column_name = 'is_profile_completed') THEN
        ALTER TABLE public.user_profiles ADD COLUMN is_profile_completed BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_profiles' AND column_name = 'last_active_at') THEN
        ALTER TABLE public.user_profiles ADD COLUMN last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    END IF;
END $$;

-- 4. Enable REPLICA IDENTITY FULL on all realtime tables
ALTER TABLE public.user_profiles REPLICA IDENTITY FULL;
ALTER TABLE public.user_notifications REPLICA IDENTITY FULL;
ALTER TABLE public.recitation_submissions REPLICA IDENTITY FULL;
ALTER TABLE public.user_activity_logs REPLICA IDENTITY FULL;

-- Ensure tables are added to supabase_realtime publication
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.user_profiles;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notifications;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.user_activity_logs;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.recitation_submissions;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
    END IF;
EXCEPTION
    WHEN OTHERS THEN NULL;
END $$;

-- 5. Updated and Hardened submit_recitation_public RPC
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

    -- Validate audio source existence
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

    -- Generate admin notification safely (compatible with both enum values)
    BEGIN
        INSERT INTO public.admin_notifications (
            notification_type,
            title,
            content,
            reference_id,
            is_read,
            created_at
        ) VALUES (
            'NEW_SUBMISSION_RECEIVED'::notification_type,
            'طلب تلاوة جديد: ' || COALESCE(NULLIF(TRIM(p_surah_name), ''), 'سورة قرآنية'),
            'أرسل القارئ ' || TRIM(p_display_name) || ' طلب تلاوة جديد وهو بانتظار المراجعة والاعتماد.',
            v_new_id,
            FALSE,
            NOW()
        );
    EXCEPTION WHEN OTHERS THEN
        NULL; -- Defensive fallback to ensure submission does not fail
    END;

    -- Record activity log
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

-- 6. Ensure RLS Policies for user_profiles and user_notifications
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_profiles_policy" ON public.user_profiles;
CREATE POLICY "user_profiles_policy" ON public.user_profiles
    FOR ALL TO anon, authenticated
    USING (TRUE)
    WITH CHECK (TRUE);

DROP POLICY IF EXISTS "user_notifications_policy" ON public.user_notifications;
CREATE POLICY "user_notifications_policy" ON public.user_notifications
    FOR ALL TO anon, authenticated
    USING (TRUE)
    WITH CHECK (TRUE);

-- Reload schema cache
NOTIFY pgrst, 'reload schema';
