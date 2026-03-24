-- ============================================================
-- AlinhaPro — Tabela de decisões (rode no SQL Editor do Supabase)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.decisoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sala_id UUID NOT NULL REFERENCES public.salas(id) ON DELETE CASCADE,
  mensagem_id UUID REFERENCES public.mensagens(id) ON DELETE SET NULL,
  texto TEXT NOT NULL,
  autor TEXT NOT NULL,
  status TEXT DEFAULT 'aprovada' CHECK (status IN ('aprovada', 'pendente', 'rejeitada')),
  criada_em TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_decisoes_sala ON public.decisoes(sala_id, criada_em);

ALTER TABLE public.decisoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Acesso público decisoes" ON public.decisoes FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.decisoes TO anon, authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE decisoes;
