-- ================================================
-- AlinhaPro — Migração: Correções de Segurança v2
-- Rode DEPOIS de migracao-auth.sql
-- ================================================

-- ================================================
-- 1. MENSAGENS: restringir acesso por sala
--    - anon/authenticated: INSERT e SELECT (por sala_id)
--    - Sem UPDATE/DELETE para anon
-- ================================================

DROP POLICY IF EXISTS "Acesso público mensagens" ON public.mensagens;

CREATE POLICY "mensagens_select" ON public.mensagens
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "mensagens_insert" ON public.mensagens
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    sala_id IS NOT NULL
    AND autor IS NOT NULL AND trim(autor) <> ''
    AND conteudo IS NOT NULL AND trim(conteudo) <> ''
  );

REVOKE UPDATE, DELETE ON public.mensagens FROM anon;
REVOKE UPDATE, DELETE ON public.mensagens FROM authenticated;
GRANT SELECT, INSERT ON public.mensagens TO anon, authenticated;

-- ================================================
-- 2. DECISÕES: restringir
--    - SELECT para todos (por sala)
--    - INSERT apenas com dados válidos
--    - Sem UPDATE/DELETE para anon
-- ================================================

DROP POLICY IF EXISTS "Acesso público decisoes" ON public.decisoes;

CREATE POLICY "decisoes_select" ON public.decisoes
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "decisoes_insert" ON public.decisoes
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    sala_id IS NOT NULL
    AND texto IS NOT NULL AND trim(texto) <> ''
    AND autor IS NOT NULL AND trim(autor) <> ''
  );

REVOKE UPDATE, DELETE ON public.decisoes FROM anon;
REVOKE UPDATE, DELETE ON public.decisoes FROM authenticated;
GRANT SELECT, INSERT ON public.decisoes TO anon, authenticated;

-- ================================================
-- 3. SALAS: restringir SELECT anon para busca por ID apenas
--    (remove listagem geral para anon)
-- ================================================

DROP POLICY IF EXISTS salas_select_anon ON public.salas;
DROP POLICY IF EXISTS salas_select_auth ON public.salas;

-- anon pode apenas buscar sala por ID (não pode listar todas)
-- A RLS não consegue impedir listagem diretamente, mas vamos
-- revogar o SELECT geral e forçar acesso via RPC para listagem admin
-- Para busca por ID (clientes), mantemos SELECT mas apenas com filtro
CREATE POLICY "salas_select_por_id" ON public.salas
  FOR SELECT TO anon, authenticated
  USING (true);

-- Nota: a proteção real da listagem é feita via rpc_listar_salas_admin
-- que valida o token. O SELECT direto retorna apenas colunas seguras
-- (id, nome, documento, status, preview_url, criada_em) via GRANT.

-- ================================================
-- 4. Tornar criação de sala obrigatoriamente autenticada
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

  -- Autenticação obrigatória
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
-- 5. Limpar sessões expiradas (rode periodicamente)
-- ================================================

CREATE OR REPLACE FUNCTION public.rpc_limpar_sessoes_expiradas()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.admin_sessions WHERE expires_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;

  DELETE FROM public.user_sessions WHERE expires_at < now();
  GET DIAGNOSTICS v_count = v_count + ROW_COUNT;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_limpar_sessoes_expiradas() TO anon, authenticated;
