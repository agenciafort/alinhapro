-- AlinhaPro — Atualizar preview_url com senha admin (painel admin, sem token de sessão na sala)
-- Rode no SQL Editor do Supabase se ainda não existir.

CREATE OR REPLACE FUNCTION public.rpc_atualizar_preview_url_senha(p_sala_id uuid, p_senha text, p_url text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash text;
BEGIN
  SELECT senha_admin_hash INTO v_hash FROM public.salas WHERE id = p_sala_id;
  IF v_hash IS NULL THEN
    RETURN false;
  END IF;
  IF crypt(p_senha, v_hash) IS DISTINCT FROM v_hash THEN
    RETURN false;
  END IF;
  UPDATE public.salas SET preview_url = coalesce(trim(p_url), '') WHERE id = p_sala_id;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_atualizar_preview_url_senha(uuid, text, text) TO anon, authenticated;
