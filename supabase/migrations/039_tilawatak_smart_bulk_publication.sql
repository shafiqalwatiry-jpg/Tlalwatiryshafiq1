-- ============================================================================
-- Migration 039: Smart Bulk Recitations Publication Function
-- Platform: Tilawatak Lil-Alem (تلاوتك للعالم)
-- Description: Provides an atomic, high-performance, server-side bulk update
--              for filtered recitations in the admin dashboard.
-- Security: Protected by public.is_admin() check.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_bulk_toggle_recitations(
    p_action TEXT, -- 'PUBLISH' or 'UNPUBLISH'
    p_reciter_id UUID DEFAULT NULL,
    p_current_status TEXT DEFAULT NULL,
    p_search TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_updated_count INTEGER := 0;
    v_now TIMESTAMPTZ := NOW();
    v_target_status TEXT;
    v_target_is_published BOOLEAN;
BEGIN
    -- 1. Security Check
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access denied: Admin privileges required for bulk publication updates';
    END IF;

    -- 2. Validate Action
    IF p_action = 'PUBLISH' THEN
        v_target_status := 'APPROVED';
        v_target_is_published := TRUE;
    ELSIF p_action = 'UNPUBLISH' THEN
        v_target_status := 'PENDING';
        v_target_is_published := FALSE;
    ELSE
        RAISE EXCEPTION 'Invalid action: Must be PUBLISH or UNPUBLISH';
    END IF;

    -- 3. Atomic Filtered Server-Side Update
    WITH target_rows AS (
        SELECT r.id
        FROM public.recitations r
        WHERE (p_reciter_id IS NULL OR r.reciter_id = p_reciter_id)
          AND (p_current_status IS NULL OR r.status = p_current_status)
          AND (
              p_search IS NULL OR TRIM(p_search) = '' OR
              r.surah_name ILIKE ('%' || p_search || '%') OR
              r.riwayah ILIKE ('%' || p_search || '%')
          )
          AND (
              (p_action = 'PUBLISH' AND (r.status <> 'APPROVED' OR r.is_published = FALSE OR r.is_published IS NULL))
              OR
              (p_action = 'UNPUBLISH' AND (r.status = 'APPROVED' OR r.is_published = TRUE))
          )
    ),
    updated AS (
        UPDATE public.recitations r
        SET 
            status = v_target_status,
            is_published = v_target_is_published,
            published_at = CASE WHEN v_target_is_published THEN v_now ELSE r.published_at END,
            updated_at = v_now
        FROM target_rows t
        WHERE r.id = t.id
        RETURNING r.id
    )
    SELECT COUNT(*) INTO v_updated_count FROM updated;

    RETURN jsonb_build_object(
        'success', TRUE,
        'action', p_action,
        'updated_count', v_updated_count,
        'target_status', v_target_status,
        'timestamp', v_now
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_bulk_toggle_recitations(TEXT, UUID, TEXT, TEXT) TO authenticated, service_role, anon;
