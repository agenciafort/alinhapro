-- ================================================
-- AlinhaPro — Migração Fase 2: CRM Avançado
-- Rode no Supabase SQL Editor DEPOIS de migracao-widget-leads.sql
-- ================================================

-- ================================================
-- 1. TABELA DE PIPELINES CUSTOMIZÁVEIS
-- ================================================

CREATE TABLE IF NOT EXISTS public.pipelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  ordem INT NOT NULL DEFAULT 0,
  criado_em TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pipelines FROM anon, authenticated;

INSERT INTO public.pipelines (nome, slug, ordem) VALUES
  ('Geral', 'geral', 0),
  ('Sites', 'sites', 1),
  ('Consultoria', 'consultoria', 2)
ON CONFLICT (slug) DO NOTHING;

-- ================================================
-- 2. RPCs PARA PIPELINES
-- ================================================

CREATE OR REPLACE FUNCTION public.rpc_listar_pipelines(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_sessions us
    JOIN public.usuarios u ON u.id = us.usuario_id
    WHERE us.token = p_token AND us.expires_at > now() AND u.ativo = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sessão inválida');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'pipelines', (SELECT COALESCE(jsonb_agg(row_to_json(p) ORDER BY p.ordem), '[]'::jsonb)
                  FROM public.pipelines p)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_listar_pipelines(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.rpc_criar_pipeline(p_token uuid, p_nome text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_slug text;
  v_ordem int;
  v_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_sessions us
    JOIN public.usuarios u ON u.id = us.usuario_id
    WHERE us.token = p_token AND us.expires_at > now() AND u.ativo = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sessão inválida');
  END IF;

  IF p_nome IS NULL OR trim(p_nome) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nome obrigatório');
  END IF;

  v_slug := lower(regexp_replace(trim(p_nome), '[^a-z0-9]+', '-', 'gi'));
  v_slug := regexp_replace(v_slug, '^-|-$', '', 'g');

  IF EXISTS (SELECT 1 FROM public.pipelines WHERE slug = v_slug) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pipeline já existe');
  END IF;

  SELECT COALESCE(max(ordem), -1) + 1 INTO v_ordem FROM public.pipelines;

  INSERT INTO public.pipelines (nome, slug, ordem)
  VALUES (trim(p_nome), v_slug, v_ordem)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'slug', v_slug);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_criar_pipeline(uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.rpc_deletar_pipeline(p_token uuid, p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_sessions us
    JOIN public.usuarios u ON u.id = us.usuario_id
    WHERE us.token = p_token AND us.expires_at > now() AND u.ativo = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sessão inválida');
  END IF;

  IF p_slug = 'geral' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Não é possível deletar o pipeline Geral');
  END IF;

  UPDATE public.salas SET lead_pipeline = 'geral' WHERE lead_pipeline = p_slug;
  DELETE FROM public.pipelines WHERE slug = p_slug;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_deletar_pipeline(uuid, text) TO anon, authenticated;

-- ================================================
-- 3. RPC: ATUALIZAR preview_url AO VIVO (consultor)
-- ================================================
-- Já existe rpc_atualizar_preview_url com token de admin_sessions.
-- Precisamos de uma versão que use o token de user_sessions (novo auth)
-- para o consultor trocar URL dentro da sala.

CREATE OR REPLACE FUNCTION public.rpc_trocar_preview_url_live(
  p_token uuid,
  p_sala_id uuid,
  p_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- Aceita tanto user_sessions (admin logado) quanto admin_sessions (consultor com senha da sala)
  IF NOT EXISTS (
    SELECT 1 FROM public.user_sessions us
    JOIN public.usuarios u ON u.id = us.usuario_id
    WHERE us.token = p_token AND us.expires_at > now() AND u.ativo = true
  ) AND NOT EXISTS (
    SELECT 1 FROM public.admin_sessions s
    WHERE s.sala_id = p_sala_id AND s.token = p_token AND s.expires_at > now()
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sessão inválida');
  END IF;

  UPDATE public.salas SET preview_url = coalesce(trim(p_url), '') WHERE id = p_sala_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_trocar_preview_url_live(uuid, uuid, text) TO anon, authenticated;

-- ================================================
-- 4. HEARTBEAT: consultor_online já existe como coluna
-- Vamos criar RPC para atualizar o heartbeat
-- ================================================

CREATE OR REPLACE FUNCTION public.rpc_heartbeat_consultor(p_token uuid, p_sala_id uuid, p_online boolean DEFAULT true)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_sessions us
    JOIN public.usuarios u ON u.id = us.usuario_id
    WHERE us.token = p_token AND us.expires_at > now() AND u.ativo = true
  ) AND NOT EXISTS (
    SELECT 1 FROM public.admin_sessions s
    WHERE s.sala_id = p_sala_id AND s.token = p_token AND s.expires_at > now()
  ) THEN
    RETURN false;
  END IF;

  UPDATE public.salas SET consultor_online = p_online WHERE id = p_sala_id;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_heartbeat_consultor(uuid, uuid, boolean) TO anon, authenticated;

-- ================================================
-- FIM DA MIGRAÇÃO FASE 2
-- ================================================
