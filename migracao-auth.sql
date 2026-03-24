-- ================================================
-- AlinhaPro — Migração: Sistema de Autenticação
-- Adiciona tabela de usuários (superadmin / admin)
-- e sessões de usuário
-- ================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Tabela de usuários do sistema
CREATE TABLE IF NOT EXISTS public.usuarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  senha_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('superadmin', 'admin')),
  ativo BOOLEAN DEFAULT true,
  criado_em TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usuarios_email ON public.usuarios(email);

-- Sessões de login (substitui admin_sessions para o novo modelo)
CREATE TABLE IF NOT EXISTS public.user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  expires_at TIMESTAMPTZ NOT NULL,
  criada_em TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON public.user_sessions(token);
CREATE INDEX IF NOT EXISTS idx_user_sessions_usuario ON public.user_sessions(usuario_id);

-- Vincular salas ao admin que criou
ALTER TABLE public.salas ADD COLUMN IF NOT EXISTS criado_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL;

-- RLS
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.usuarios FROM anon, authenticated;
REVOKE ALL ON public.user_sessions FROM anon, authenticated;

-- anon não pode SELECT direto nas tabelas — acessa via RPCs SECURITY DEFINER

-- ================================================
-- RPC: Login de usuário
-- ================================================
CREATE OR REPLACE FUNCTION public.rpc_user_login(p_email text, p_senha text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user record;
  v_token uuid := gen_random_uuid();
BEGIN
  SELECT id, nome, email, role, senha_hash, ativo
    INTO v_user
    FROM public.usuarios
   WHERE lower(email) = lower(trim(p_email));

  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Email ou senha incorretos');
  END IF;

  IF NOT v_user.ativo THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Conta desativada');
  END IF;

  IF crypt(p_senha, v_user.senha_hash) IS DISTINCT FROM v_user.senha_hash THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Email ou senha incorretos');
  END IF;

  INSERT INTO public.user_sessions (usuario_id, token, expires_at)
  VALUES (v_user.id, v_token, now() + interval '24 hours');

  RETURN jsonb_build_object(
    'ok', true,
    'token', v_token,
    'usuario', jsonb_build_object(
      'id', v_user.id,
      'nome', v_user.nome,
      'email', v_user.email,
      'role', v_user.role
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_user_login(text, text) TO anon, authenticated;

-- ================================================
-- RPC: Validar sessão (retorna dados do usuário ou null)
-- ================================================
CREATE OR REPLACE FUNCTION public.rpc_validar_sessao(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user record;
BEGIN
  SELECT u.id, u.nome, u.email, u.role
    INTO v_user
    FROM public.user_sessions s
    JOIN public.usuarios u ON u.id = s.usuario_id
   WHERE s.token = p_token
     AND s.expires_at > now()
     AND u.ativo = true;

  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id', v_user.id,
    'nome', v_user.nome,
    'email', v_user.email,
    'role', v_user.role
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_validar_sessao(uuid) TO anon, authenticated;

-- ================================================
-- RPC: Logout (invalidar sessão)
-- ================================================
CREATE OR REPLACE FUNCTION public.rpc_user_logout(p_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  DELETE FROM public.user_sessions WHERE token = p_token;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_user_logout(uuid) TO anon, authenticated;

-- ================================================
-- RPC: Criar admin (só superadmin pode)
-- ================================================
CREATE OR REPLACE FUNCTION public.rpc_criar_admin(p_token uuid, p_email text, p_nome text, p_senha text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller record;
  v_new_id uuid;
BEGIN
  SELECT u.id, u.role
    INTO v_caller
    FROM public.user_sessions s
    JOIN public.usuarios u ON u.id = s.usuario_id
   WHERE s.token = p_token AND s.expires_at > now() AND u.ativo = true;

  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sessão inválida ou expirada');
  END IF;

  IF v_caller.role <> 'superadmin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Apenas o super admin pode criar administradores');
  END IF;

  IF p_email IS NULL OR trim(p_email) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Email é obrigatório');
  END IF;

  IF p_nome IS NULL OR trim(p_nome) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nome é obrigatório');
  END IF;

  IF p_senha IS NULL OR length(p_senha) < 6 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Senha deve ter pelo menos 6 caracteres');
  END IF;

  IF EXISTS (SELECT 1 FROM public.usuarios WHERE lower(email) = lower(trim(p_email))) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Já existe um usuário com este email');
  END IF;

  INSERT INTO public.usuarios (email, nome, senha_hash, role)
  VALUES (lower(trim(p_email)), trim(p_nome), crypt(p_senha, gen_salt('bf')), 'admin')
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'ok', true,
    'usuario', jsonb_build_object(
      'id', v_new_id,
      'email', lower(trim(p_email)),
      'nome', trim(p_nome),
      'role', 'admin'
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_criar_admin(uuid, text, text, text) TO anon, authenticated;

-- ================================================
-- RPC: Listar admins (só superadmin pode)
-- ================================================
CREATE OR REPLACE FUNCTION public.rpc_listar_admins(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller record;
  v_list jsonb;
BEGIN
  SELECT u.id, u.role
    INTO v_caller
    FROM public.user_sessions s
    JOIN public.usuarios u ON u.id = s.usuario_id
   WHERE s.token = p_token AND s.expires_at > now() AND u.ativo = true;

  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sessão inválida');
  END IF;

  IF v_caller.role <> 'superadmin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão');
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', u.id,
      'email', u.email,
      'nome', u.nome,
      'role', u.role,
      'ativo', u.ativo,
      'criado_em', u.criado_em
    ) ORDER BY u.criado_em DESC
  ), '[]'::jsonb)
  INTO v_list
  FROM public.usuarios u
  WHERE u.id <> v_caller.id;

  RETURN jsonb_build_object('ok', true, 'admins', v_list);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_listar_admins(uuid) TO anon, authenticated;

-- ================================================
-- RPC: Ativar/Desativar admin (só superadmin pode)
-- ================================================
CREATE OR REPLACE FUNCTION public.rpc_toggle_admin(p_token uuid, p_admin_id uuid, p_ativo boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller record;
  v_target record;
BEGIN
  SELECT u.id, u.role
    INTO v_caller
    FROM public.user_sessions s
    JOIN public.usuarios u ON u.id = s.usuario_id
   WHERE s.token = p_token AND s.expires_at > now() AND u.ativo = true;

  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sessão inválida');
  END IF;

  IF v_caller.role <> 'superadmin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão');
  END IF;

  SELECT id, role INTO v_target FROM public.usuarios WHERE id = p_admin_id;

  IF v_target IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Usuário não encontrado');
  END IF;

  IF v_target.role = 'superadmin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Não é possível alterar outro super admin');
  END IF;

  UPDATE public.usuarios SET ativo = p_ativo WHERE id = p_admin_id;

  IF NOT p_ativo THEN
    DELETE FROM public.user_sessions WHERE usuario_id = p_admin_id;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_toggle_admin(uuid, uuid, boolean) TO anon, authenticated;

-- ================================================
-- RPC: Resetar senha de admin (só superadmin pode)
-- ================================================
CREATE OR REPLACE FUNCTION public.rpc_resetar_senha_admin(p_token uuid, p_admin_id uuid, p_nova_senha text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller record;
  v_target record;
BEGIN
  SELECT u.id, u.role
    INTO v_caller
    FROM public.user_sessions s
    JOIN public.usuarios u ON u.id = s.usuario_id
   WHERE s.token = p_token AND s.expires_at > now() AND u.ativo = true;

  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sessão inválida');
  END IF;

  IF v_caller.role <> 'superadmin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão');
  END IF;

  IF p_nova_senha IS NULL OR length(p_nova_senha) < 6 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Senha deve ter pelo menos 6 caracteres');
  END IF;

  SELECT id, role INTO v_target FROM public.usuarios WHERE id = p_admin_id;

  IF v_target IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Usuário não encontrado');
  END IF;

  IF v_target.role = 'superadmin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Não é possível alterar outro super admin');
  END IF;

  UPDATE public.usuarios SET senha_hash = crypt(p_nova_senha, gen_salt('bf')) WHERE id = p_admin_id;
  DELETE FROM public.user_sessions WHERE usuario_id = p_admin_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_resetar_senha_admin(uuid, uuid, text) TO anon, authenticated;

-- ================================================
-- RPC: Deletar admin (só superadmin pode)
-- ================================================
CREATE OR REPLACE FUNCTION public.rpc_deletar_admin(p_token uuid, p_admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller record;
  v_target record;
BEGIN
  SELECT u.id, u.role
    INTO v_caller
    FROM public.user_sessions s
    JOIN public.usuarios u ON u.id = s.usuario_id
   WHERE s.token = p_token AND s.expires_at > now() AND u.ativo = true;

  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sessão inválida');
  END IF;

  IF v_caller.role <> 'superadmin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão');
  END IF;

  SELECT id, role INTO v_target FROM public.usuarios WHERE id = p_admin_id;

  IF v_target IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Usuário não encontrado');
  END IF;

  IF v_target.role = 'superadmin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Não é possível deletar outro super admin');
  END IF;

  DELETE FROM public.user_sessions WHERE usuario_id = p_admin_id;
  UPDATE public.salas SET criado_por = NULL WHERE criado_por = p_admin_id;
  DELETE FROM public.usuarios WHERE id = p_admin_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_deletar_admin(uuid, uuid) TO anon, authenticated;

-- ================================================
-- Atualizar rpc_criar_sala para vincular ao admin logado
-- ================================================
CREATE OR REPLACE FUNCTION public.rpc_criar_sala(p_nome text, p_senha text, p_preview_url text DEFAULT '', p_user_token uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id uuid;
  v_doc text;
  v_criada timestamptz;
  v_user_id uuid;
BEGIN
  IF p_nome IS NULL OR trim(p_nome) = '' THEN
    RAISE EXCEPTION 'nome obrigatório';
  END IF;
  IF p_senha IS NULL OR length(p_senha) < 4 THEN
    RAISE EXCEPTION 'senha deve ter pelo menos 4 caracteres';
  END IF;

  IF p_user_token IS NOT NULL THEN
    SELECT u.id INTO v_user_id
      FROM public.user_sessions s
      JOIN public.usuarios u ON u.id = s.usuario_id
     WHERE s.token = p_user_token AND s.expires_at > now() AND u.ativo = true;
  END IF;

  v_doc := '# ' || trim(p_nome) || E'\n\nBem-vindo à sala de consultoria.\n\n## Tópicos\n\n- Aguardando início da discussão...\n';

  INSERT INTO public.salas (nome, documento, status, senha_admin_hash, preview_url, criado_por)
  VALUES (trim(p_nome), v_doc, 'ativa', crypt(p_senha, gen_salt('bf')), coalesce(trim(p_preview_url), ''), v_user_id)
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

-- ================================================
-- RPC: Listar salas do admin logado (admin vê só as suas, superadmin vê todas)
-- ================================================
CREATE OR REPLACE FUNCTION public.rpc_listar_salas_admin(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user record;
  v_list jsonb;
BEGIN
  SELECT u.id, u.role
    INTO v_user
    FROM public.user_sessions s
    JOIN public.usuarios u ON u.id = s.usuario_id
   WHERE s.token = p_token AND s.expires_at > now() AND u.ativo = true;

  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sessão inválida');
  END IF;

  IF v_user.role = 'superadmin' THEN
    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'id', sa.id,
        'nome', sa.nome,
        'status', sa.status,
        'preview_url', sa.preview_url,
        'repo_url', coalesce(sa.repo_url, ''),
        'criada_em', sa.criada_em,
        'criado_por', sa.criado_por
      ) ORDER BY sa.criada_em DESC
    ), '[]'::jsonb)
    INTO v_list
    FROM public.salas sa;
  ELSE
    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'id', sa.id,
        'nome', sa.nome,
        'status', sa.status,
        'preview_url', sa.preview_url,
        'repo_url', coalesce(sa.repo_url, ''),
        'criada_em', sa.criada_em,
        'criado_por', sa.criado_por
      ) ORDER BY sa.criada_em DESC
    ), '[]'::jsonb)
    INTO v_list
    FROM public.salas sa
    WHERE sa.criado_por = v_user.id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'salas', v_list);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_listar_salas_admin(uuid) TO anon, authenticated;

-- ================================================
-- Criar primeiro super admin (EDITE email/nome/senha abaixo)
-- Execute esta parte manualmente no SQL Editor do Supabase
-- ================================================
-- INSERT INTO public.usuarios (email, nome, senha_hash, role)
-- VALUES (
--   'seu-email@exemplo.com',
--   'Seu Nome',
--   crypt('SuaSenhaForte123', gen_salt('bf')),
--   'superadmin'
-- );
