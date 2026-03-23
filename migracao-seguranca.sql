-- ============================================================
-- AlinhaPro — MIGRAÇÃO DE SEGURANÇA (rode no SQL Editor do Supabase)
-- ============================================================
-- Use este arquivo SE você já tinha criado as tabelas com senha_admin em texto.
-- Ordem: cole tudo e clique Run uma vez.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Sessões do consultor (token opaco, expira em 8h)
CREATE TABLE IF NOT EXISTS public.admin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sala_id UUID NOT NULL REFERENCES public.salas(id) ON DELETE CASCADE,
  token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  expires_at TIMESTAMPTZ NOT NULL,
  criada_em TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_sala ON public.admin_sessions(sala_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON public.admin_sessions(token);

ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;

-- Sem políticas públicas: só funções SECURITY DEFINER acessam
REVOKE ALL ON public.admin_sessions FROM anon, authenticated;

-- 2) Coluna de hash e migração a partir da senha em texto (só se ainda existir senha_admin)
ALTER TABLE public.salas ADD COLUMN IF NOT EXISTS senha_admin_hash TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'salas' AND column_name = 'senha_admin'
  ) THEN
    UPDATE public.salas
    SET senha_admin_hash = crypt(senha_admin, gen_salt('bf'))
    WHERE senha_admin IS NOT NULL
      AND trim(senha_admin) <> ''
      AND (senha_admin_hash IS NULL OR senha_admin_hash = '');

    IF EXISTS (SELECT 1 FROM public.salas WHERE senha_admin_hash IS NULL) THEN
      RAISE EXCEPTION 'Existem salas sem senha_admin_hash. Verifique a coluna senha_admin.';
    END IF;

    ALTER TABLE public.salas DROP COLUMN senha_admin;
  END IF;
END $$;

-- 3) Funções (SECURITY DEFINER = rodam com permissão do dono, bypass RLS nas tabelas internas)

CREATE OR REPLACE FUNCTION public.rpc_criar_sala(p_nome text, p_senha text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_doc text;
  v_criada timestamptz;
BEGIN
  IF p_nome IS NULL OR trim(p_nome) = '' THEN
    RAISE EXCEPTION 'nome obrigatório';
  END IF;
  IF p_senha IS NULL OR length(p_senha) < 4 THEN
    RAISE EXCEPTION 'senha deve ter pelo menos 4 caracteres';
  END IF;
  v_doc := '# ' || trim(p_nome) || E'\n\nBem-vindo à sala de consultoria.\n\n## Tópicos\n\n- Aguardando início da discussão...\n';
  INSERT INTO public.salas (nome, documento, status, senha_admin_hash)
  VALUES (trim(p_nome), v_doc, 'ativa', crypt(p_senha, gen_salt('bf')))
  RETURNING id, criada_em INTO v_id, v_criada;
  RETURN jsonb_build_object(
    'id', v_id,
    'nome', trim(p_nome),
    'documento', v_doc,
    'status', 'ativa',
    'criada_em', v_criada
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_login(p_sala_id uuid, p_senha text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
  v_token uuid := gen_random_uuid();
BEGIN
  SELECT senha_admin_hash INTO v_hash FROM public.salas WHERE id = p_sala_id;
  IF v_hash IS NULL THEN
    RETURN NULL;
  END IF;
  IF crypt(p_senha, v_hash) IS DISTINCT FROM v_hash THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.admin_sessions (sala_id, token, expires_at)
  VALUES (p_sala_id, v_token, now() + interval '8 hours');
  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_atualizar_documento(p_sala_id uuid, p_token uuid, p_documento text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_sessions s
    WHERE s.sala_id = p_sala_id AND s.token = p_token AND s.expires_at > now()
  ) THEN
    RETURN false;
  END IF;
  UPDATE public.salas SET documento = p_documento WHERE id = p_sala_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_alterar_status_sala(p_sala_id uuid, p_senha text, p_status text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
BEGIN
  IF p_status NOT IN ('ativa', 'concluida') THEN
    RETURN false;
  END IF;
  SELECT senha_admin_hash INTO v_hash FROM public.salas WHERE id = p_sala_id;
  IF v_hash IS NULL OR crypt(p_senha, v_hash) IS DISTINCT FROM v_hash THEN
    RETURN false;
  END IF;
  UPDATE public.salas SET status = p_status WHERE id = p_sala_id;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_criar_sala(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.rpc_admin_login(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.rpc_atualizar_documento(uuid, uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.rpc_alterar_status_sala(uuid, text, text) TO anon;

GRANT EXECUTE ON FUNCTION public.rpc_criar_sala(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_login(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_atualizar_documento(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_alterar_status_sala(uuid, text, text) TO authenticated;

-- 4) RLS em salas: só leitura pública das colunas seguras (via GRANT abaixo)
DROP POLICY IF EXISTS "Acesso público salas" ON public.salas;

CREATE POLICY salas_select_anon ON public.salas
  FOR SELECT TO anon USING (true);

-- authenticated também pode ler (se no futuro usar login)
CREATE POLICY salas_select_auth ON public.salas
  FOR SELECT TO authenticated USING (true);

-- 5) Remover INSERT/UPDATE diretos do anon na tabela salas
REVOKE ALL ON public.salas FROM anon;
GRANT SELECT (id, nome, documento, status, criada_em) ON public.salas TO anon;

REVOKE ALL ON public.salas FROM authenticated;
GRANT SELECT (id, nome, documento, status, criada_em) ON public.salas TO authenticated;

-- 6) Coluna senha_admin já removida no passo 2 (quando existia)

-- 7) Garantir permissões no chat (caso tenha faltado)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mensagens TO anon, authenticated;

-- ============================================================
-- Pronto. Faça deploy do front-end e teste criar sala / editar documento.
-- ============================================================
