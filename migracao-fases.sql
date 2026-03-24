-- AlinhaPro — Sistema de Fases do Projeto
-- Rode no SQL Editor do Supabase

CREATE TABLE IF NOT EXISTS public.fases_projeto (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sala_id UUID NOT NULL REFERENCES public.salas(id) ON DELETE CASCADE,
  fase_atual INTEGER DEFAULT 1 CHECK (fase_atual BETWEEN 1 AND 5),
  fase1_aprovada_em TIMESTAMPTZ,
  fase1_aprovada_por TEXT,
  fase2_aprovada_em TIMESTAMPTZ,
  fase2_aprovada_por TEXT,
  fase3_aprovada_em TIMESTAMPTZ,
  fase3_aprovada_por TEXT,
  fase4_aprovada_em TIMESTAMPTZ,
  fase4_aprovada_por TEXT,
  fase5_aprovada_em TIMESTAMPTZ,
  fase5_aprovada_por TEXT,
  escopo_texto TEXT DEFAULT '',
  relatorio_final TEXT DEFAULT '',
  criada_em TIMESTAMPTZ DEFAULT now(),
  UNIQUE(sala_id)
);

ALTER TABLE public.fases_projeto ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Acesso público fases" ON public.fases_projeto FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fases_projeto TO anon, authenticated;
ALTER PUBLICATION supabase_realtime ADD TABLE fases_projeto;

-- Função: consultor avança fase
CREATE OR REPLACE FUNCTION public.rpc_avancar_fase(p_sala_id uuid, p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_fase INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_sessions s
    WHERE s.sala_id = p_sala_id AND s.token = p_token AND s.expires_at > now()
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sessão inválida');
  END IF;

  SELECT fase_atual INTO v_fase FROM public.fases_projeto WHERE sala_id = p_sala_id;
  IF v_fase IS NULL THEN
    INSERT INTO public.fases_projeto (sala_id, fase_atual) VALUES (p_sala_id, 1);
    v_fase := 1;
  END IF;

  IF v_fase >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Projeto já está na fase final');
  END IF;

  UPDATE public.fases_projeto SET fase_atual = v_fase + 1 WHERE sala_id = p_sala_id;
  RETURN jsonb_build_object('ok', true, 'fase', v_fase + 1);
END;
$$;

-- Função: cliente aprova fase atual
CREATE OR REPLACE FUNCTION public.rpc_aprovar_fase(p_sala_id uuid, p_fase integer, p_nome text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_fase_atual INTEGER;
BEGIN
  SELECT fase_atual INTO v_fase_atual FROM public.fases_projeto WHERE sala_id = p_sala_id;
  IF v_fase_atual IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Fases não iniciadas');
  END IF;
  IF p_fase <> v_fase_atual THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Fase incorreta');
  END IF;

  EXECUTE format(
    'UPDATE public.fases_projeto SET fase%s_aprovada_em = now(), fase%s_aprovada_por = $1 WHERE sala_id = $2',
    p_fase, p_fase
  ) USING p_nome, p_sala_id;

  RETURN jsonb_build_object('ok', true, 'fase', p_fase);
END;
$$;

-- Função: salvar escopo
CREATE OR REPLACE FUNCTION public.rpc_salvar_escopo(p_sala_id uuid, p_token uuid, p_texto text)
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
  UPDATE public.fases_projeto SET escopo_texto = coalesce(p_texto, '') WHERE sala_id = p_sala_id;
  IF NOT FOUND THEN
    INSERT INTO public.fases_projeto (sala_id, escopo_texto) VALUES (p_sala_id, coalesce(p_texto, ''));
  END IF;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_avancar_fase(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_aprovar_fase(uuid, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_salvar_escopo(uuid, uuid, text) TO anon, authenticated;
