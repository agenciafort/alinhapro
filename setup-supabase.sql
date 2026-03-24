-- ================================================
-- AlinhaPro — Setup COMPLETO (novo projeto / do zero)
-- ================================================
-- Se você JÁ tinha o banco antigo, use migracao-seguranca.sql em vez deste.
-- ================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.salas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  documento TEXT DEFAULT '',
  status TEXT DEFAULT 'ativa' CHECK (status IN ('ativa', 'concluida')),
  senha_admin_hash TEXT NOT NULL,
  preview_url TEXT DEFAULT '',
  criada_em TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.admin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sala_id UUID NOT NULL REFERENCES public.salas(id) ON DELETE CASCADE,
  token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  expires_at TIMESTAMPTZ NOT NULL,
  criada_em TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_admin_sessions_sala ON public.admin_sessions(sala_id);
CREATE INDEX idx_admin_sessions_token ON public.admin_sessions(token);

CREATE TABLE public.mensagens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sala_id UUID REFERENCES public.salas(id) ON DELETE CASCADE,
  autor TEXT NOT NULL,
  conteudo TEXT NOT NULL,
  enviada_em TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_mensagens_sala ON public.mensagens(sala_id, enviada_em);

CREATE TABLE public.decisoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sala_id UUID NOT NULL REFERENCES public.salas(id) ON DELETE CASCADE,
  mensagem_id UUID REFERENCES public.mensagens(id) ON DELETE SET NULL,
  texto TEXT NOT NULL,
  autor TEXT NOT NULL,
  status TEXT DEFAULT 'aprovada' CHECK (status IN ('aprovada', 'pendente', 'rejeitada')),
  criada_em TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_decisoes_sala ON public.decisoes(sala_id, criada_em);

ALTER PUBLICATION supabase_realtime ADD TABLE salas;
ALTER PUBLICATION supabase_realtime ADD TABLE mensagens;
ALTER PUBLICATION supabase_realtime ADD TABLE decisoes;

ALTER TABLE salas ENABLE ROW LEVEL SECURITY;
ALTER TABLE mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.admin_sessions FROM anon, authenticated;

CREATE POLICY salas_select_anon ON public.salas FOR SELECT TO anon USING (true);
CREATE POLICY salas_select_auth ON public.salas FOR SELECT TO authenticated USING (true);

CREATE POLICY "Acesso público mensagens" ON public.mensagens FOR ALL USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mensagens TO anon, authenticated;

ALTER TABLE public.decisoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Acesso público decisoes" ON public.decisoes FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.decisoes TO anon, authenticated;

REVOKE ALL ON public.salas FROM anon;
GRANT SELECT (id, nome, documento, status, preview_url, criada_em) ON public.salas TO anon;

REVOKE ALL ON public.salas FROM authenticated;
GRANT SELECT (id, nome, documento, status, preview_url, criada_em) ON public.salas TO authenticated;

-- Funções (mesmo corpo da migração)
CREATE OR REPLACE FUNCTION public.rpc_criar_sala(p_nome text, p_senha text, p_preview_url text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
  INSERT INTO public.salas (nome, documento, status, senha_admin_hash, preview_url)
  VALUES (trim(p_nome), v_doc, 'ativa', crypt(p_senha, gen_salt('bf')), coalesce(trim(p_preview_url), ''))
  RETURNING id, criada_em INTO v_id, v_criada;
  RETURN jsonb_build_object(
    'id', v_id,
    'nome', trim(p_nome),
    'documento', v_doc,
    'status', 'ativa',
    'preview_url', coalesce(trim(p_preview_url), ''),
    'criada_em', v_criada
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_admin_login(p_sala_id uuid, p_senha text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
SET search_path = public, extensions
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
SET search_path = public, extensions
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

GRANT EXECUTE ON FUNCTION public.rpc_criar_sala(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_login(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_atualizar_documento(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_alterar_status_sala(uuid, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.rpc_atualizar_preview_url(p_sala_id uuid, p_token uuid, p_url text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_sessions s
    WHERE s.sala_id = p_sala_id AND s.token = p_token AND s.expires_at > now()
  ) THEN
    RETURN false;
  END IF;
  UPDATE public.salas SET preview_url = coalesce(trim(p_url), '') WHERE id = p_sala_id;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_atualizar_preview_url(uuid, uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.rpc_deletar_sala(p_sala_id uuid, p_senha text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash text;
  v_nome text;
BEGIN
  SELECT senha_admin_hash, nome INTO v_hash, v_nome FROM public.salas WHERE id = p_sala_id;
  IF v_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sala não encontrada');
  END IF;
  IF crypt(p_senha, v_hash) IS DISTINCT FROM v_hash THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Senha incorreta');
  END IF;
  DELETE FROM public.decisoes WHERE sala_id = p_sala_id;
  DELETE FROM public.mensagens WHERE sala_id = p_sala_id;
  DELETE FROM public.admin_sessions WHERE sala_id = p_sala_id;
  DELETE FROM public.salas WHERE id = p_sala_id;
  RETURN jsonb_build_object('ok', true, 'nome', v_nome);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_deletar_sala(uuid, text) TO anon, authenticated;
