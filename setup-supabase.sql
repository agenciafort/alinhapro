-- ================================================
-- AlinhaPro — Setup do Banco de Dados (Supabase)
-- ================================================
-- Execute este SQL no Supabase:
-- 1. Acesse o painel do Supabase
-- 2. Vá em "SQL Editor" no menu lateral
-- 3. Cole todo este conteúdo
-- 4. Clique em "Run"
-- ================================================

-- Tabela de salas de consultoria
CREATE TABLE salas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  documento TEXT DEFAULT '',
  status TEXT DEFAULT 'ativa' CHECK (status IN ('ativa', 'concluida')),
  senha_admin TEXT NOT NULL,
  criada_em TIMESTAMPTZ DEFAULT now()
);

-- Tabela de mensagens do chat
CREATE TABLE mensagens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sala_id UUID REFERENCES salas(id) ON DELETE CASCADE,
  autor TEXT NOT NULL,
  conteudo TEXT NOT NULL,
  enviada_em TIMESTAMPTZ DEFAULT now()
);

-- Índice para buscar mensagens por sala rapidamente
CREATE INDEX idx_mensagens_sala ON mensagens(sala_id, enviada_em);

-- Habilitar Realtime nas duas tabelas
ALTER PUBLICATION supabase_realtime ADD TABLE salas;
ALTER PUBLICATION supabase_realtime ADD TABLE mensagens;

-- Políticas de acesso público (sem RLS por enquanto, para simplificar)
-- Quando quiser proteger, ative RLS e crie policies adequadas
ALTER TABLE salas ENABLE ROW LEVEL SECURITY;
ALTER TABLE mensagens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Acesso público salas" ON salas FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Acesso público mensagens" ON mensagens FOR ALL USING (true) WITH CHECK (true);
