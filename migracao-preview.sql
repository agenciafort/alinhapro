-- ============================================================
-- AlinhaPro — Adicionar preview_url às salas
-- ============================================================
-- Rode no SQL Editor do Supabase (uma vez).
-- ============================================================

-- 1) Coluna para a URL de preview (site do projeto hospedado)
ALTER TABLE public.salas ADD COLUMN IF NOT EXISTS preview_url TEXT DEFAULT '';

-- 2) Liberar leitura da nova coluna para anon/authenticated
GRANT SELECT (preview_url) ON public.salas TO anon, authenticated;

-- 3) RPC para o consultor atualizar a preview_url (exige token de sessão)
CREATE OR REPLACE FUNCTION public.rpc_atualizar_preview_url(p_sala_id uuid, p_token uuid, p_url text)
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
  UPDATE public.salas SET preview_url = coalesce(p_url, '') WHERE id = p_sala_id;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_atualizar_preview_url(uuid, uuid, text) TO anon, authenticated;

-- 4) Atualizar rpc_criar_sala para aceitar preview_url (opcional)
CREATE OR REPLACE FUNCTION public.rpc_criar_sala(p_nome text, p_senha text, p_preview_url text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_doc text;
  v_criada timestamptz;
  v_url text;
BEGIN
  IF p_nome IS NULL OR trim(p_nome) = '' THEN
    RAISE EXCEPTION 'nome obrigatório';
  END IF;
  IF p_senha IS NULL OR length(p_senha) < 4 THEN
    RAISE EXCEPTION 'senha deve ter pelo menos 4 caracteres';
  END IF;
  v_url := coalesce(trim(p_preview_url), '');
  v_doc := '# ' || trim(p_nome) || E'\n\nBem-vindo à sala de consultoria.\n\n## Tópicos\n\n- Aguardando início da discussão...\n';
  INSERT INTO public.salas (nome, documento, status, senha_admin_hash, preview_url)
  VALUES (trim(p_nome), v_doc, 'ativa', crypt(p_senha, gen_salt('bf')), v_url)
  RETURNING id, criada_em INTO v_id, v_criada;
  RETURN jsonb_build_object(
    'id', v_id,
    'nome', trim(p_nome),
    'documento', v_doc,
    'status', 'ativa',
    'preview_url', v_url,
    'criada_em', v_criada
  );
END;
$$;
