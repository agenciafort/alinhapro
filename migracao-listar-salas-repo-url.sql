-- Inclui repo_url na listagem do painel (rode no Supabase SQL Editor)
-- Necessário para o botão GitHub e o nome do diretório no card

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
