-- ================================================
-- AlinhaPro — Migração Fase 4: Push Notifications + Telegram
-- Rode no Supabase SQL Editor DEPOIS das migrações anteriores.
-- ================================================

-- ================================================
-- 1. TABELA DE SUBSCRIÇÕES PUSH
-- ================================================

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT DEFAULT '',
  criado_em TIMESTAMPTZ DEFAULT now(),
  UNIQUE (usuario_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subs_usuario ON public.push_subscriptions(usuario_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_subscriptions FROM anon, authenticated;

-- ================================================
-- 2. RPC: REGISTRAR SUBSCRIÇÃO PUSH
-- ================================================

CREATE OR REPLACE FUNCTION public.rpc_registrar_push(
  p_token uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT us.usuario_id INTO v_user_id
  FROM public.user_sessions us
  JOIN public.usuarios u ON u.id = us.usuario_id
  WHERE us.token = p_token AND us.expires_at > now() AND u.ativo = true;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sessão inválida');
  END IF;

  INSERT INTO public.push_subscriptions (usuario_id, endpoint, p256dh, auth, user_agent)
  VALUES (v_user_id, p_endpoint, p_p256dh, p_auth, COALESCE(p_user_agent, ''))
  ON CONFLICT (usuario_id, endpoint)
  DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_registrar_push(uuid, text, text, text, text) TO anon, authenticated;

-- ================================================
-- 3. RPC: REMOVER SUBSCRIÇÃO PUSH
-- ================================================

CREATE OR REPLACE FUNCTION public.rpc_remover_push(p_token uuid, p_endpoint text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT us.usuario_id INTO v_user_id
  FROM public.user_sessions us
  JOIN public.usuarios u ON u.id = us.usuario_id
  WHERE us.token = p_token AND us.expires_at > now() AND u.ativo = true;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sessão inválida');
  END IF;

  DELETE FROM public.push_subscriptions WHERE usuario_id = v_user_id AND endpoint = p_endpoint;
  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_remover_push(uuid, text) TO anon, authenticated;

-- ================================================
-- 4. RPC: LISTAR SUBSCRIÇÕES (para a function enviar push)
-- ================================================

CREATE OR REPLACE FUNCTION public.rpc_listar_push_subs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN jsonb_build_object(
    'ok', true,
    'subs', (SELECT COALESCE(jsonb_agg(row_to_json(ps)), '[]'::jsonb)
             FROM public.push_subscriptions ps)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_listar_push_subs() TO anon, authenticated;

-- ================================================
-- 5. CONFIGURAÇÕES: Telegram bot
-- ================================================

INSERT INTO public.configuracoes (chave, valor)
VALUES ('telegram_chat_id', '')
ON CONFLICT (chave) DO NOTHING;

INSERT INTO public.configuracoes (chave, valor)
VALUES ('telegram_bot_token', '')
ON CONFLICT (chave) DO NOTHING;

-- ================================================
-- FIM DA MIGRAÇÃO FASE 4
-- ================================================
