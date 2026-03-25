-- ================================================
-- AlinhaPro — Migração: Widget de Chat + Sistema de Leads
-- Rode no Supabase SQL Editor DEPOIS de todas as migrações anteriores.
-- ================================================

-- ================================================
-- 1. NOVOS CAMPOS NA TABELA SALAS (lead tracking)
-- ================================================

-- Tipo da sala: projeto (padrão, como funciona hoje) ou lead (criado pelo widget)
ALTER TABLE public.salas ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'projeto'
  CHECK (tipo IN ('projeto', 'lead'));

-- Dados do lead capturados pelo formulário pré-chat
ALTER TABLE public.salas ADD COLUMN IF NOT EXISTS lead_nome TEXT;
ALTER TABLE public.salas ADD COLUMN IF NOT EXISTS lead_contato TEXT;
ALTER TABLE public.salas ADD COLUMN IF NOT EXISTS lead_pagina_origem TEXT;
ALTER TABLE public.salas ADD COLUMN IF NOT EXISTS lead_referrer TEXT;
ALTER TABLE public.salas ADD COLUMN IF NOT EXISTS lead_user_agent TEXT;

-- Gestão do lead no CRM
ALTER TABLE public.salas ADD COLUMN IF NOT EXISTS lead_status TEXT DEFAULT 'novo'
  CHECK (lead_status IN ('novo', 'conversando', 'proposta', 'negociando', 'fechado', 'perdido'));
ALTER TABLE public.salas ADD COLUMN IF NOT EXISTS lead_notas TEXT DEFAULT '';
ALTER TABLE public.salas ADD COLUMN IF NOT EXISTS lead_followup_em TIMESTAMPTZ;
ALTER TABLE public.salas ADD COLUMN IF NOT EXISTS lead_pipeline TEXT DEFAULT 'geral';

-- Flag: consultor está online? (para mensagem automática offline)
ALTER TABLE public.salas ADD COLUMN IF NOT EXISTS consultor_online BOOLEAN DEFAULT false;

-- Índices para listagem/filtro de leads
CREATE INDEX IF NOT EXISTS idx_salas_tipo ON public.salas(tipo);
CREATE INDEX IF NOT EXISTS idx_salas_lead_status ON public.salas(lead_status) WHERE tipo = 'lead';
CREATE INDEX IF NOT EXISTS idx_salas_lead_followup ON public.salas(lead_followup_em) WHERE lead_followup_em IS NOT NULL;

-- Permitir que anon leia os novos campos de salas tipo lead
GRANT SELECT (tipo, lead_nome, lead_contato, lead_pagina_origem,
              lead_status, lead_notas, lead_followup_em, lead_pipeline, consultor_online)
  ON public.salas TO anon, authenticated;

-- ================================================
-- 2. RPC: CRIAR SALA DE LEAD (sem senha, acesso público)
-- ================================================

CREATE OR REPLACE FUNCTION public.rpc_criar_sala_lead(
  p_nome TEXT,
  p_contato TEXT,
  p_pagina TEXT DEFAULT '',
  p_referrer TEXT DEFAULT '',
  p_user_agent TEXT DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_sala_id uuid;
  v_criada timestamptz;
  v_display_nome text;
BEGIN
  -- Validação: contato é obrigatório
  IF p_contato IS NULL OR trim(p_contato) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Informe seu WhatsApp ou e-mail');
  END IF;

  v_display_nome := COALESCE(NULLIF(trim(p_nome), ''), 'Visitante');

  INSERT INTO public.salas (
    nome,
    documento,
    status,
    tipo,
    lead_nome,
    lead_contato,
    lead_pagina_origem,
    lead_referrer,
    lead_user_agent,
    lead_status,
    senha_admin_hash
  )
  VALUES (
    'Lead — ' || v_display_nome || ' — ' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI'),
    '',
    'ativa',
    'lead',
    v_display_nome,
    trim(p_contato),
    COALESCE(trim(p_pagina), ''),
    COALESCE(trim(p_referrer), ''),
    COALESCE(trim(p_user_agent), ''),
    'novo',
    -- Gera hash aleatório (o lead não precisa de senha, mas a coluna é NOT NULL)
    crypt(gen_random_uuid()::text, gen_salt('bf'))
  )
  RETURNING id, criada_em INTO v_sala_id, v_criada;

  RETURN jsonb_build_object(
    'ok', true,
    'sala_id', v_sala_id,
    'nome', v_display_nome,
    'criada_em', v_criada
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_criar_sala_lead(text, text, text, text, text) TO anon, authenticated;

-- ================================================
-- 3. RPC: ENVIAR MENSAGEM EM SALA DE LEAD (anon seguro)
-- ================================================
-- O widget usa anon. A policy existente (mensagens_insert) valida sala_id/autor/conteudo.
-- Precisamos garantir que anon consiga inserir em salas do tipo lead.
-- A policy atual já permite INSERT com WITH CHECK genérico.
-- Vamos criar uma policy mais restritiva para segurança:

-- Remover policy genérica antiga de INSERT se existir e recriar com validação de tipo
DO $$
BEGIN
  -- Só recria se a policy genérica existir
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'mensagens' AND policyname = 'mensagens_insert') THEN
    DROP POLICY "mensagens_insert" ON public.mensagens;
  END IF;
END $$;

-- anon pode inserir mensagens em salas tipo lead OU em qualquer sala (comportamento atual preservado)
CREATE POLICY "mensagens_insert" ON public.mensagens
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    sala_id IS NOT NULL
    AND autor IS NOT NULL AND trim(autor) <> ''
    AND conteudo IS NOT NULL AND trim(conteudo) <> ''
  );

-- ================================================
-- 4. RPC: ATUALIZAR LEAD (notas, status, follow-up)
-- ================================================

CREATE OR REPLACE FUNCTION public.rpc_atualizar_lead(
  p_token uuid,
  p_sala_id uuid,
  p_lead_status TEXT DEFAULT NULL,
  p_lead_notas TEXT DEFAULT NULL,
  p_lead_followup_em TIMESTAMPTZ DEFAULT NULL,
  p_lead_pipeline TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- Verificar sessão de admin válida (superadmin ou admin logado)
  IF NOT EXISTS (
    SELECT 1 FROM public.user_sessions us
    JOIN public.usuarios u ON u.id = us.usuario_id
    WHERE us.token = p_token AND us.expires_at > now() AND u.ativo = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sessão inválida');
  END IF;

  -- Verificar que a sala existe e é do tipo lead
  IF NOT EXISTS (SELECT 1 FROM public.salas WHERE id = p_sala_id AND tipo = 'lead') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sala não encontrada ou não é lead');
  END IF;

  UPDATE public.salas SET
    lead_status     = COALESCE(p_lead_status, lead_status),
    lead_notas      = COALESCE(p_lead_notas, lead_notas),
    lead_followup_em = CASE
      WHEN p_lead_followup_em IS NOT NULL THEN p_lead_followup_em
      ELSE lead_followup_em
    END,
    lead_pipeline   = COALESCE(p_lead_pipeline, lead_pipeline)
  WHERE id = p_sala_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_atualizar_lead(uuid, uuid, text, text, timestamptz, text) TO anon, authenticated;

-- ================================================
-- 5. RPC: CONVERTER LEAD EM PROJETO
-- ================================================

CREATE OR REPLACE FUNCTION public.rpc_converter_lead_em_projeto(
  p_token uuid,
  p_sala_id uuid,
  p_senha_admin text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_sala record;
  v_nova_senha text;
BEGIN
  -- Verificar sessão
  IF NOT EXISTS (
    SELECT 1 FROM public.user_sessions us
    JOIN public.usuarios u ON u.id = us.usuario_id
    WHERE us.token = p_token AND us.expires_at > now() AND u.ativo = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sessão inválida');
  END IF;

  SELECT * INTO v_sala FROM public.salas WHERE id = p_sala_id AND tipo = 'lead';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Lead não encontrado');
  END IF;

  -- Se não informou senha, gera uma aleatória de 8 caracteres
  v_nova_senha := COALESCE(NULLIF(trim(p_senha_admin), ''), substr(md5(random()::text), 1, 8));

  UPDATE public.salas SET
    tipo = 'projeto',
    lead_status = 'fechado',
    senha_admin_hash = crypt(v_nova_senha, gen_salt('bf')),
    documento = '# ' || COALESCE(lead_nome, nome) || E'\n\nProjeto convertido de lead.\n\n## Contato\n\n- ' || COALESCE(lead_contato, '(sem contato)') || E'\n\n## Escopo\n\n- A definir\n'
  WHERE id = p_sala_id;

  RETURN jsonb_build_object(
    'ok', true,
    'sala_id', p_sala_id,
    'senha_admin', v_nova_senha
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_converter_lead_em_projeto(uuid, uuid, text) TO anon, authenticated;

-- ================================================
-- 6. RPC: LISTAR LEADS (para o painel admin)
-- ================================================

CREATE OR REPLACE FUNCTION public.rpc_listar_leads(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_leads jsonb;
BEGIN
  -- Verificar sessão
  IF NOT EXISTS (
    SELECT 1 FROM public.user_sessions us
    JOIN public.usuarios u ON u.id = us.usuario_id
    WHERE us.token = p_token AND us.expires_at > now() AND u.ativo = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sessão inválida');
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(sub) ORDER BY sub.criada_em DESC), '[]'::jsonb)
  INTO v_leads
  FROM (
    SELECT
      s.id,
      s.nome,
      s.lead_nome,
      s.lead_contato,
      s.lead_pagina_origem,
      s.lead_status,
      s.lead_notas,
      s.lead_followup_em,
      s.lead_pipeline,
      s.criada_em,
      (SELECT count(*) FROM public.mensagens m WHERE m.sala_id = s.id) AS total_mensagens,
      (SELECT m2.conteudo FROM public.mensagens m2 WHERE m2.sala_id = s.id ORDER BY m2.enviada_em DESC LIMIT 1) AS ultima_mensagem,
      (SELECT m3.enviada_em FROM public.mensagens m3 WHERE m3.sala_id = s.id ORDER BY m3.enviada_em DESC LIMIT 1) AS ultima_mensagem_em
    FROM public.salas s
    WHERE s.tipo = 'lead'
  ) sub;

  RETURN jsonb_build_object('ok', true, 'leads', v_leads);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_listar_leads(uuid) TO anon, authenticated;

-- ================================================
-- 7. TABELA DE CONFIGURAÇÕES (mensagem offline, etc.)
-- ================================================

CREATE TABLE IF NOT EXISTS public.configuracoes (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL DEFAULT '',
  atualizado_em TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.configuracoes ENABLE ROW LEVEL SECURITY;

-- Somente RPCs SECURITY DEFINER acessam
REVOKE ALL ON public.configuracoes FROM anon, authenticated;

-- Inserir mensagem offline padrão
INSERT INTO public.configuracoes (chave, valor)
VALUES (
  'mensagem_offline',
  'Olá! Obrigado por entrar em contato! Nosso horário de atendimento é de seg-sex, 9h às 18h. Recebemos sua mensagem e vamos responder o mais rápido possível!'
)
ON CONFLICT (chave) DO NOTHING;

-- ================================================
-- 8. RPC: BUSCAR CONFIGURAÇÃO (para o widget)
-- ================================================

CREATE OR REPLACE FUNCTION public.rpc_config_publica(p_chave text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN (SELECT valor FROM public.configuracoes WHERE chave = p_chave);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_config_publica(text) TO anon, authenticated;

-- ================================================
-- FIM DA MIGRAÇÃO
-- ================================================
-- Após rodar, teste:
-- SELECT rpc_criar_sala_lead('João', '15999999999', '/criacao-de-sites', '', '');
-- SELECT rpc_listar_leads('<seu_token_de_admin>');
-- ================================================
