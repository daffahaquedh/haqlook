-- Security Remediation A: additive AI usage reservation lifecycle.
-- Existing rows become FINALIZED by the column default; no usage history is rewritten or deleted.
ALTER TABLE public.ai_usage
  ADD COLUMN IF NOT EXISTS reservation_status text NOT NULL DEFAULT 'FINALIZED',
  ADD COLUMN IF NOT EXISTS reserved_cost numeric(14,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reservation_expires_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ai_usage'::regclass
      AND conname = 'ai_usage_reservation_status_check'
  ) THEN
    ALTER TABLE public.ai_usage
      ADD CONSTRAINT ai_usage_reservation_status_check
      CHECK (reservation_status IN ('RESERVED', 'FINALIZED', 'RELEASED', 'EXPIRED'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ai_usage'::regclass
      AND conname = 'ai_usage_reserved_cost_nonnegative_check'
  ) THEN
    ALTER TABLE public.ai_usage
      ADD CONSTRAINT ai_usage_reserved_cost_nonnegative_check
      CHECK (reserved_cost >= 0);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS ai_usage_pending_expiry_idx
  ON public.ai_usage (reservation_expires_at)
  WHERE reservation_status = 'RESERVED';

-- New server-only RPCs are added before the Edge Function switches over.
-- This migration intentionally leaves legacy grants in place during the rollout.
CREATE OR REPLACE FUNCTION public.reserve_ai_usage_server(
  p_user_id uuid,
  p_feature text,
  p_model text,
  p_reasoning_effort text,
  p_estimated_cost numeric,
  p_tool_cost numeric,
  p_search_calls integer,
  p_details jsonb,
  p_request_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  monthly_budget numeric;
  monthly_used numeric;
  reservation_id uuid;
  existing_status text;
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'TRUSTED_SERVER_REQUIRED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.admins
    WHERE user_id = p_user_id AND role IN ('ADMIN', 'SELLER')
  ) THEN
    RAISE EXCEPTION 'STAFF_ACCESS_REQUIRED';
  END IF;
  IF p_feature IS NULL OR p_feature NOT IN (
    'ITEM_ANALYSIS', 'LISTING_GENERATION', 'HUNTER_CHAT',
    'HUNTER_DESTINATION_BRIEF', 'HUNTER_REFRESH', 'HUNTER_ITEM_CHECK'
  ) THEN
    RAISE EXCEPTION 'AI_FEATURE_NOT_ALLOWED';
  END IF;
  IF p_model IS DISTINCT FROM 'gpt-6-luna' THEN
    RAISE EXCEPTION 'AI_MODEL_NOT_ALLOWED';
  END IF;
  IF (p_feature IN ('HUNTER_DESTINATION_BRIEF', 'HUNTER_REFRESH')
      AND p_reasoning_effort IS DISTINCT FROM 'medium')
    OR (p_feature NOT IN ('HUNTER_DESTINATION_BRIEF', 'HUNTER_REFRESH')
      AND p_reasoning_effort IS DISTINCT FROM 'low') THEN
    RAISE EXCEPTION 'AI_REASONING_EFFORT_NOT_ALLOWED';
  END IF;
  IF p_request_key IS NULL THEN RAISE EXCEPTION 'REQUEST_KEY_REQUIRED'; END IF;
  IF p_estimated_cost IS NULL OR p_estimated_cost <= 0
     OR p_estimated_cost::text IN ('NaN', 'Infinity', '-Infinity')
     OR p_tool_cost IS NULL OR p_tool_cost < 0
     OR p_search_calls IS NULL OR p_search_calls < 0
     OR jsonb_typeof(coalesce(p_details, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'AI_USAGE_VALUES_INVALID';
  END IF;

  -- One lock serializes reservation expiry, request-key dedupe, and monthly budget checks.
  PERFORM pg_advisory_xact_lock(783492);

  UPDATE public.ai_usage
    SET reservation_status = 'EXPIRED', estimated_cost = 0
    WHERE reservation_status = 'RESERVED'
      AND reservation_expires_at <= now();

  SELECT id, reservation_status
    INTO reservation_id, existing_status
    FROM public.ai_usage
    WHERE user_id = p_user_id AND request_key = p_request_key
    FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'usage_id', reservation_id,
      'created', false,
      'status', existing_status
    );
  END IF;

  SELECT coalesce((value ->> 'amount')::numeric, 100000)
    INTO monthly_budget
    FROM public.app_settings
    WHERE key = 'ai_monthly_budget';
  monthly_budget := coalesce(monthly_budget, 100000);

  SELECT coalesce(sum(
    CASE
      WHEN reservation_status = 'FINALIZED' THEN estimated_cost
      WHEN reservation_status = 'RESERVED' THEN reserved_cost
      ELSE 0
    END
  ), 0)
    INTO monthly_used
    FROM public.ai_usage
    WHERE created_at >= date_trunc('month', now())
      AND (
        reservation_status = 'FINALIZED'
        OR (reservation_status = 'RESERVED' AND reservation_expires_at > now())
      );

  IF monthly_used + p_estimated_cost > monthly_budget THEN
    RAISE EXCEPTION 'AI_BUDGET_EXCEEDED';
  END IF;

  BEGIN
    INSERT INTO public.ai_usage (
      user_id, feature, model, reasoning_effort, estimated_cost, reserved_cost,
      tool_cost, search_calls, details, request_key, reservation_status, reservation_expires_at
    ) VALUES (
      p_user_id, p_feature, p_model, p_reasoning_effort, p_estimated_cost, p_estimated_cost,
      0, 0, coalesce(p_details, '{}'::jsonb), p_request_key, 'RESERVED', now() + interval '5 minutes'
    )
    RETURNING id INTO reservation_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id, reservation_status
      INTO reservation_id, existing_status
      FROM public.ai_usage
      WHERE user_id = p_user_id AND request_key = p_request_key
      FOR UPDATE;
    IF reservation_id IS NULL THEN RAISE; END IF;
    RETURN jsonb_build_object(
      'usage_id', reservation_id,
      'created', false,
      'status', existing_status
    );
  END;

  RETURN jsonb_build_object('usage_id', reservation_id, 'created', true, 'status', 'RESERVED');
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_ai_usage_server(
  p_user_id uuid,
  p_usage_id uuid,
  p_input_tokens integer,
  p_output_tokens integer,
  p_estimated_cost numeric,
  p_tool_cost numeric,
  p_search_calls integer,
  p_details jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'TRUSTED_SERVER_REQUIRED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.admins
    WHERE user_id = p_user_id AND role IN ('ADMIN', 'SELLER')
  ) THEN
    RAISE EXCEPTION 'STAFF_ACCESS_REQUIRED';
  END IF;
  IF p_input_tokens IS NULL OR p_input_tokens < 0
     OR p_output_tokens IS NULL OR p_output_tokens < 0
     OR p_search_calls IS NULL OR p_search_calls < 0
     OR p_tool_cost IS NULL OR p_tool_cost < 0
     OR p_estimated_cost IS NULL OR p_estimated_cost < 0
     OR p_estimated_cost::text IN ('NaN', 'Infinity', '-Infinity')
     OR jsonb_typeof(coalesce(p_details, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'AI_USAGE_VALUES_INVALID';
  END IF;

  UPDATE public.ai_usage
    SET input_tokens = p_input_tokens,
        output_tokens = p_output_tokens,
        tool_cost = p_tool_cost,
        estimated_cost = p_estimated_cost,
        search_calls = p_search_calls,
        details = coalesce(details, '{}'::jsonb) || coalesce(p_details, '{}'::jsonb),
        reservation_status = 'FINALIZED'
    WHERE id = p_usage_id
      AND user_id = p_user_id
      AND reservation_status = 'RESERVED'
      AND reservation_expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'AI_USAGE_RESERVATION_NOT_FINALIZABLE'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_ai_usage_server(
  p_user_id uuid,
  p_usage_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'TRUSTED_SERVER_REQUIRED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.admins
    WHERE user_id = p_user_id AND role IN ('ADMIN', 'SELLER')
  ) THEN
    RAISE EXCEPTION 'STAFF_ACCESS_REQUIRED';
  END IF;

  UPDATE public.ai_usage
    SET reservation_status = 'RELEASED', estimated_cost = 0
    WHERE id = p_usage_id AND user_id = p_user_id
      AND reservation_status = 'RESERVED'
      AND reservation_expires_at > now();
  IF FOUND THEN RETURN; END IF;

  UPDATE public.ai_usage
    SET reservation_status = 'EXPIRED', estimated_cost = 0
    WHERE id = p_usage_id AND user_id = p_user_id
      AND reservation_status = 'RESERVED'
      AND reservation_expires_at <= now();
  IF FOUND THEN RETURN; END IF;

  -- A repeated release is harmless; finalized rows are never altered or deleted.
  IF EXISTS (
    SELECT 1 FROM public.ai_usage
    WHERE id = p_usage_id AND user_id = p_user_id
      AND reservation_status = 'RELEASED'
  ) THEN RETURN; END IF;

  RAISE EXCEPTION 'AI_USAGE_RESERVATION_NOT_RELEASABLE';
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_ai_usage_server(uuid, text, text, text, numeric, numeric, integer, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_ai_usage_server(uuid, uuid, integer, integer, numeric, numeric, integer, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_ai_usage_server(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ai_usage_server(uuid, text, text, text, numeric, numeric, integer, jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_ai_usage_server(uuid, uuid, integer, integer, numeric, numeric, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_ai_usage_server(uuid, uuid) TO service_role;

-- Keep the existing usage card aligned with reservation lifecycle accounting.
CREATE OR REPLACE FUNCTION public.seller_ai_usage_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  budget numeric;
  used numeric;
BEGIN
  IF NOT public.is_staff() THEN RAISE EXCEPTION 'STAFF_ACCESS_REQUIRED'; END IF;
  SELECT coalesce((value ->> 'amount')::numeric, 100000)
    INTO budget FROM public.app_settings WHERE key = 'ai_monthly_budget';
  budget := coalesce(budget, 100000);
  SELECT coalesce(sum(
    CASE
      WHEN reservation_status = 'FINALIZED' THEN estimated_cost
      WHEN reservation_status = 'RESERVED' THEN reserved_cost
      ELSE 0
    END
  ), 0)
    INTO used
    FROM public.ai_usage
    WHERE created_at >= date_trunc('month', now())
      AND (
        reservation_status = 'FINALIZED'
        OR (reservation_status = 'RESERVED' AND reservation_expires_at > now())
      );
  RETURN jsonb_build_object(
    'budget', budget,
    'used', used,
    'remaining', greatest(budget - used, 0),
    'percentage', CASE WHEN budget > 0 THEN round((used / budget) * 100, 2) ELSE 0 END
  );
END;
$$;
