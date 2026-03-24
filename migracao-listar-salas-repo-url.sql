-- Inclui repo_url na listagem + gravação na criação da sala (rode no Supabase SQL Editor)
-- Necessário para o botão GitHub e o nome do diretório no card

-- Substitui rpc_criar_sala para aceitar p_repo_url (grava na mesma transação do INSERT)
DROP FUNCTION IF EXISTS public.rpc_criar_sala(text, text, text, uuid, text);
DROP FUNCTION IF EXISTS public.rpc_criar_sala(text, text, text, uuid);
DROP FUNCTION IF EXISTS public.rpc_criar_sala(text, text, text);
DROP FUNCTION IF EXISTS public.rpc_criar_sala(text, text);

CREATE OR REPLACE FUNCTION public.rpc_criar_sala(
  p_nome text,
  p_senha text,
  p_preview_url text DEFAULT '',
  p_user_token uuid DEFAULT NULL,
  p_repo_url text DEFAULT ''
)
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

  IF p_user_token IS NULL THEN
    RAISE EXCEPTION 'Autenticação obrigatória para criar salas';
  END IF;

  SELECT u.id INTO v_user_id
    FROM public.user_sessions s
    JOIN public.usuarios u ON u.id = s.usuario_id
   WHERE s.token = p_user_token AND s.expires_at > now() AND u.ativo = true;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida ou expirada. Faça login novamente.';
  END IF;

  v_doc := '# ' || trim(p_nome) || E'\n\nBem-vindo à sala de consultoria.\n\n## Tópicos\n\n- Aguardando início da discussão...\n';

  INSERT INTO public.salas (nome, documento, status, senha_admin_hash, preview_url, criado_por, repo_url)
  VALUES (
    trim(p_nome),
    v_doc,
    'ativa',
    crypt(p_senha, gen_salt('bf')),
    coalesce(trim(p_preview_url), ''),
    v_user_id,
    coalesce(nullif(trim(p_repo_url), ''), '')
  )
  RETURNING id, criada_em INTO v_id, v_criada;

  RETURN jsonb_build_object(
    'id', v_id,
    'nome', trim(p_nome),
    'documento', v_doc,
    'status', 'ativa',
    'preview_url', coalesce(trim(p_preview_url), ''),
    'repo_url', coalesce(nullif(trim(p_repo_url), ''), ''),
    'criada_em', v_criada
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_criar_sala(text, text, text, uuid, text) TO anon, authenticated;

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

-- Salvar URL do repositório após criar projeto (UPDATE direto na tabela é bloqueado para anon)
CREATE OR REPLACE FUNCTION public.rpc_definir_repo_url(p_token uuid, p_sala_id uuid, p_repo_url text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user record;
BEGIN
  SELECT u.id, u.role INTO v_user
    FROM public.user_sessions s
    JOIN public.usuarios u ON u.id = s.usuario_id
   WHERE s.token = p_token AND s.expires_at > now() AND u.ativo = true;

  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sessão inválida');
  END IF;

  IF v_user.role = 'superadmin' THEN
    UPDATE public.salas SET repo_url = trim(coalesce(p_repo_url, '')) WHERE id = p_sala_id;
  ELSE
    UPDATE public.salas SET repo_url = trim(coalesce(p_repo_url, ''))
     WHERE id = p_sala_id AND criado_por = v_user.id;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sala não encontrada ou sem permissão');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_definir_repo_url(uuid, uuid, text) TO anon, authenticated;
