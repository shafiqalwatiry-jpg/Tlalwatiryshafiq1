-- ============================================================================
-- Migration 034: Reciter Full Profile Cloning & Audio URL Template Engine
-- Platform: TilawatakLilAlam (تلاوتك للعالم)
-- Description:
--   1. clone_reciter_profile: Atomically clones a reciter profile and all associated
--      recitations with fresh IDs, linked to the newly created reciter, resetting
--      all engagement counters, likes, and listen statistics to 0.
--   2. apply_reciter_audio_template: Batch updates recitation audio URLs using
--      configurable templates or identifier replacement.
-- ============================================================================

-- 1. Atomic Function: clone_reciter_profile
CREATE OR REPLACE FUNCTION public.clone_reciter_profile(
    p_source_reciter_id UUID,
    p_new_display_name TEXT DEFAULT NULL,
    p_new_country TEXT DEFAULT NULL,
    p_initial_status TEXT DEFAULT 'PENDING'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_src_reciter public.reciters%ROWTYPE;
    v_new_reciter_id UUID;
    v_target_name TEXT;
    v_copied_recitations_count INTEGER := 0;
    v_result JSONB;
BEGIN
    -- A. Fetch and validate source reciter
    SELECT * INTO v_src_reciter
    FROM public.reciters
    WHERE id = p_source_reciter_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Source reciter not found with id: %', p_source_reciter_id;
    END IF;

    -- B. Determine new display name
    IF p_new_display_name IS NOT NULL AND TRIM(p_new_display_name) <> '' THEN
        v_target_name := TRIM(p_new_display_name);
    ELSE
        v_target_name := v_src_reciter.display_name || ' (نسخة)';
    END IF;

    -- C. Insert new independent reciter
    INSERT INTO public.reciters (
        display_name,
        pseudonym,
        use_pseudonym,
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
    )
    VALUES (
        v_target_name,
        v_src_reciter.pseudonym,
        v_src_reciter.use_pseudonym,
        v_src_reciter.gender,
        COALESCE(p_new_country, v_src_reciter.country),
        v_src_reciter.bio,
        v_src_reciter.profile_image_path,
        v_src_reciter.banner_image_path,
        v_src_reciter.logo_image_path,
        v_src_reciter.is_verified,
        v_src_reciter.is_featured,
        FALSE, -- Starts as unpublished/draft so admin can edit and review
        NOW(),
        NOW()
    )
    RETURNING id INTO v_new_reciter_id;

    -- D. Clone all recitations belonging to source reciter
    -- Generates new UUIDs, binds to v_new_reciter_id, resets statistics and staff pick.
    INSERT INTO public.recitations (
        reciter_id,
        surah_name,
        surah_number,
        ayah_start,
        ayah_end,
        riwayah,
        duration_seconds,
        audio_storage_path,
        external_audio_url,
        cover_image_path,
        description,
        status,
        is_staff_pick,
        published_at,
        created_at,
        updated_at
    )
    SELECT
        v_new_reciter_id,
        r.surah_name,
        r.surah_number,
        r.ayah_start,
        r.ayah_end,
        r.riwayah,
        r.duration_seconds,
        r.audio_storage_path,
        r.external_audio_url,
        r.cover_image_path,
        r.description,
        COALESCE(p_initial_status, 'PENDING'),
        FALSE,
        NULL,
        NOW(),
        NOW()
    FROM public.recitations r
    WHERE r.reciter_id = p_source_reciter_id
    ORDER BY r.surah_number ASC, r.ayah_start ASC;

    GET DIAGNOSTICS v_copied_recitations_count = ROW_COUNT;

    -- E. Return structured result
    v_result := jsonb_build_object(
        'success', TRUE,
        'new_reciter_id', v_new_reciter_id,
        'source_reciter_id', p_source_reciter_id,
        'new_display_name', v_target_name,
        'copied_recitations_count', v_copied_recitations_count,
        'created_at', NOW()
    );

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clone_reciter_profile(UUID, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;

-- 2. Batch Function: apply_reciter_audio_template
CREATE OR REPLACE FUNCTION public.apply_reciter_audio_template(
    p_reciter_id UUID,
    p_url_template TEXT,
    p_reciter_slug TEXT DEFAULT NULL,
    p_replace_from TEXT DEFAULT NULL,
    p_replace_to TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_updated_count INTEGER := 0;
    r RECORD;
    v_new_url TEXT;
    v_surah_pad TEXT;
BEGIN
    FOR r IN (SELECT id, surah_number, surah_name, external_audio_url, audio_storage_path 
              FROM public.recitations 
              WHERE reciter_id = p_reciter_id)
    LOOP
        v_surah_pad := LPAD(r.surah_number::TEXT, 3, '0');
        
        IF p_url_template IS NOT NULL AND TRIM(p_url_template) <> '' THEN
            v_new_url := p_url_template;
            v_new_url := REPLACE(v_new_url, '{reciter}', COALESCE(p_reciter_slug, ''));
            v_new_url := REPLACE(v_new_url, '{reciter_slug}', COALESCE(p_reciter_slug, ''));
            v_new_url := REPLACE(v_new_url, '{surah_number_padded}', v_surah_pad);
            v_new_url := REPLACE(v_new_url, '{surah_number}', r.surah_number::TEXT);
            v_new_url := REPLACE(v_new_url, '{surah_name}', r.surah_name);
        ELSIF p_replace_from IS NOT NULL AND p_replace_from <> '' AND p_replace_to IS NOT NULL THEN
            v_new_url := REPLACE(COALESCE(r.external_audio_url, r.audio_storage_path), p_replace_from, p_replace_to);
        ELSE
            CONTINUE;
        END IF;

        UPDATE public.recitations
        SET external_audio_url = v_new_url,
            audio_storage_path = CASE 
                WHEN audio_storage_path LIKE 'http://%' OR audio_storage_path LIKE 'https://%' THEN v_new_url 
                ELSE audio_storage_path 
            END,
            updated_at = NOW()
        WHERE id = r.id;

        v_updated_count := v_updated_count + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'success', TRUE,
        'reciter_id', p_reciter_id,
        'updated_recitations_count', v_updated_count
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_reciter_audio_template(UUID, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
