-- ================================================
-- AlinhaPro — Leitura de chat (vistos estilo WhatsApp)
-- Rode no SQL Editor do Supabase após as migrações base.
-- ================================================

CREATE TABLE IF NOT EXISTS public.sala_chat_leitura (
  sala_id UUID PRIMARY KEY REFERENCES public.salas(id) ON DELETE CASCADE,
  cliente_lida_ate TIMESTAMPTZ,
  consultor_lida_ate TIMESTAMPTZ,
  atualizado_em TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.sala_chat_leitura ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sala_chat_leitura_select" ON public.sala_chat_leitura;
CREATE POLICY "sala_chat_leitura_select" ON public.sala_chat_leitura
  FOR SELECT TO anon, authenticated
  USING (true);

REVOKE INSERT, UPDATE, DELETE ON public.sala_chat_leitura FROM anon, authenticated;
GRANT SELECT ON public.sala_chat_leitura TO anon, authenticated;

-- Realtime: outro lado atualiza vistos ao ler
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.sala_chat_leitura;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.rpc_atualizar_leitura_chat(
  p_sala_id uuid,
  p_ultima_mensagem_id uuid,
  p_token uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_em timestamptz;
  v_consultor boolean;
BEGIN
  IF p_sala_id IS NULL OR p_ultima_mensagem_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Parâmetros inválidos');
  END IF;

  SELECT m.enviada_em INTO v_em
  FROM public.mensagens m
  WHERE m.id = p_ultima_mensagem_id AND m.sala_id = p_sala_id;

  IF v_em IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Mensagem inválida');
  END IF;

  v_consultor := p_token IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.admin_sessions s
    WHERE s.sala_id = p_sala_id AND s.token = p_token AND s.expires_at > now()
  );

  IF v_consultor THEN
    INSERT INTO public.sala_chat_leitura (sala_id, consultor_lida_ate, atualizado_em)
    VALUES (p_sala_id, v_em, now())
    ON CONFLICT (sala_id) DO UPDATE SET
      consultor_lida_ate = GREATEST(
        COALESCE(public.sala_chat_leitura.consultor_lida_ate, '-infinity'::timestamptz),
        v_em
      ),
      atualizado_em = now();
  ELSE
    INSERT INTO public.sala_chat_leitura (sala_id, cliente_lida_ate, atualizado_em)
    VALUES (p_sala_id, v_em, now())
    ON CONFLICT (sala_id) DO UPDATE SET
      cliente_lida_ate = GREATEST(
        COALESCE(public.sala_chat_leitura.cliente_lida_ate, '-infinity'::timestamptz),
        v_em
      ),
      atualizado_em = now();
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_atualizar_leitura_chat(uuid, uuid, uuid) TO anon, authenticated;
