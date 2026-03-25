-- ================================================
-- AlinhaPro — Migração Fase 5: RPC para salvar configurações
-- Rode no Supabase SQL Editor DEPOIS das migrações anteriores.
-- ================================================

-- ================================================
-- 1. RPC: SALVAR CONFIGURAÇÃO (somente admin autenticado)
-- ================================================

CREATE OR REPLACE FUNCTION public.rpc_salvar_config(
  p_token uuid,
  p_chave text,
  p_valor text
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
  WHERE us.token = p_token
    AND us.expires_at > now()
    AND u.ativo = true
    AND u.role IN ('admin', 'superadmin');

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sessão inválida ou sem permissão');
  END IF;

  INSERT INTO public.configuracoes (chave, valor)
  VALUES (p_chave, p_valor)
  ON CONFLICT (chave)
  DO UPDATE SET valor = EXCLUDED.valor;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_salvar_config(uuid, text, text) TO anon, authenticated;

-- ================================================
-- 2. RPC: LISTAR TODAS AS CONFIGURAÇÕES (somente admin)
-- ================================================

CREATE OR REPLACE FUNCTION public.rpc_listar_configs(p_token uuid)
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
  WHERE us.token = p_token
    AND us.expires_at > now()
    AND u.ativo = true
    AND u.role IN ('admin', 'superadmin');

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sessão inválida');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'configs', (
      SELECT COALESCE(jsonb_object_agg(chave, valor), '{}'::jsonb)
      FROM public.configuracoes
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_listar_configs(uuid) TO anon, authenticated;

-- ================================================
-- FIM DA MIGRAÇÃO FASE 5
-- ================================================
