-- ============================================================
-- AlinhaPro — Função para deletar sala (rode no SQL Editor do Supabase)
-- ============================================================

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
