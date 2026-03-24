-- ================================================
-- AlinhaPro — Migração: Sistema de Pagamentos
-- Rode DEPOIS de migracao-auth.sql
-- ================================================

-- Proposta de preço (consultor define, cliente aceita/recusa)
CREATE TABLE IF NOT EXISTS public.propostas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sala_id UUID NOT NULL REFERENCES public.salas(id) ON DELETE CASCADE,
  valor NUMERIC(10,2) NOT NULL CHECK (valor > 0),
  descricao TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aceita', 'recusada', 'cancelada')),
  criada_em TIMESTAMPTZ DEFAULT now(),
  respondida_em TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_propostas_sala ON public.propostas(sala_id);

-- Pagamentos (integração com Asaas)
CREATE TABLE IF NOT EXISTS public.pagamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sala_id UUID NOT NULL REFERENCES public.salas(id) ON DELETE CASCADE,
  proposta_id UUID REFERENCES public.propostas(id) ON DELETE SET NULL,
  asaas_payment_id TEXT,
  asaas_customer_id TEXT,
  valor NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'confirmado', 'liberado', 'reembolsado', 'disputa', 'resolvido', 'expirado')),
  metodo TEXT,
  pix_qrcode TEXT,
  pix_copia_cola TEXT,
  boleto_url TEXT,
  link_pagamento TEXT,
  pago_em TIMESTAMPTZ,
  liberado_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pagamentos_sala ON public.pagamentos(sala_id);
CREATE INDEX IF NOT EXISTS idx_pagamentos_asaas ON public.pagamentos(asaas_payment_id);

-- Disputas
CREATE TABLE IF NOT EXISTS public.disputas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sala_id UUID NOT NULL REFERENCES public.salas(id) ON DELETE CASCADE,
  pagamento_id UUID NOT NULL REFERENCES public.pagamentos(id) ON DELETE CASCADE,
  motivo TEXT NOT NULL,
  proposta_cliente NUMERIC(10,2),
  proposta_consultor NUMERIC(10,2),
  status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'acordo', 'expirada')),
  valor_cliente NUMERIC(10,2),
  valor_consultor NUMERIC(10,2),
  criada_em TIMESTAMPTZ DEFAULT now(),
  resolvida_em TIMESTAMPTZ,
  expira_em TIMESTAMPTZ DEFAULT (now() + interval '7 days')
);

CREATE INDEX IF NOT EXISTS idx_disputas_sala ON public.disputas(sala_id);

-- Adicionar modo da sala (gratuito ou pago)
ALTER TABLE public.salas ADD COLUMN IF NOT EXISTS modo TEXT DEFAULT 'gratuito' CHECK (modo IN ('gratuito', 'pago'));

-- URL do repositório GitHub (para acesso rápido no painel)
ALTER TABLE public.salas ADD COLUMN IF NOT EXISTS repo_url TEXT DEFAULT '';

-- GRANT SELECT nas novas colunas para anon e authenticated
GRANT SELECT (modo) ON public.salas TO anon, authenticated;
GRANT SELECT (repo_url) ON public.salas TO anon, authenticated;
GRANT UPDATE (repo_url) ON public.salas TO anon, authenticated;
GRANT UPDATE (modo) ON public.salas TO anon, authenticated;

-- RLS
ALTER TABLE public.propostas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disputas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "propostas_select" ON public.propostas FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "pagamentos_select" ON public.pagamentos FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "disputas_select" ON public.disputas FOR SELECT TO anon, authenticated USING (true);

REVOKE ALL ON public.propostas FROM anon;
REVOKE ALL ON public.pagamentos FROM anon;
REVOKE ALL ON public.disputas FROM anon;
GRANT SELECT ON public.propostas TO anon, authenticated;
GRANT SELECT ON public.pagamentos TO anon, authenticated;
GRANT SELECT ON public.disputas TO anon, authenticated;

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE propostas;
ALTER PUBLICATION supabase_realtime ADD TABLE pagamentos;
ALTER PUBLICATION supabase_realtime ADD TABLE disputas;

-- ================================================
-- RPC: Criar proposta de preço (só admin/consultor)
-- ================================================
CREATE OR REPLACE FUNCTION public.rpc_criar_proposta(p_token uuid, p_sala_id uuid, p_valor numeric, p_descricao text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user record;
  v_proposta_id uuid;
BEGIN
  SELECT u.id, u.role INTO v_user
    FROM public.user_sessions s
    JOIN public.usuarios u ON u.id = s.usuario_id
   WHERE s.token = p_token AND s.expires_at > now() AND u.ativo = true;

  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sessão inválida');
  END IF;

  IF p_valor <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Valor deve ser maior que zero');
  END IF;

  -- Cancelar propostas pendentes anteriores
  UPDATE public.propostas SET status = 'cancelada'
   WHERE sala_id = p_sala_id AND status = 'pendente';

  INSERT INTO public.propostas (sala_id, valor, descricao)
  VALUES (p_sala_id, p_valor, coalesce(trim(p_descricao), ''))
  RETURNING id INTO v_proposta_id;

  -- Marcar sala como paga
  UPDATE public.salas SET modo = 'pago' WHERE id = p_sala_id;

  RETURN jsonb_build_object('ok', true, 'proposta_id', v_proposta_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_criar_proposta(uuid, uuid, numeric, text) TO anon, authenticated;

-- ================================================
-- RPC: Responder proposta (cliente aceita ou recusa)
-- ================================================
CREATE OR REPLACE FUNCTION public.rpc_responder_proposta(p_sala_id uuid, p_proposta_id uuid, p_aceitar boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_proposta record;
BEGIN
  SELECT * INTO v_proposta FROM public.propostas
   WHERE id = p_proposta_id AND sala_id = p_sala_id AND status = 'pendente';

  IF v_proposta IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Proposta não encontrada ou já respondida');
  END IF;

  IF p_aceitar THEN
    UPDATE public.propostas SET status = 'aceita', respondida_em = now()
     WHERE id = p_proposta_id;
  ELSE
    UPDATE public.propostas SET status = 'recusada', respondida_em = now()
     WHERE id = p_proposta_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', CASE WHEN p_aceitar THEN 'aceita' ELSE 'recusada' END);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_responder_proposta(uuid, uuid, boolean) TO anon, authenticated;

-- ================================================
-- RPC: Registrar pagamento (chamado pelo webhook)
-- ================================================
CREATE OR REPLACE FUNCTION public.rpc_registrar_pagamento(
  p_sala_id uuid, p_proposta_id uuid, p_asaas_payment_id text,
  p_asaas_customer_id text, p_valor numeric, p_metodo text,
  p_pix_qrcode text DEFAULT NULL, p_pix_copia_cola text DEFAULT NULL,
  p_boleto_url text DEFAULT NULL, p_link_pagamento text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_pag_id uuid;
BEGIN
  INSERT INTO public.pagamentos (sala_id, proposta_id, asaas_payment_id, asaas_customer_id, valor, metodo, pix_qrcode, pix_copia_cola, boleto_url, link_pagamento)
  VALUES (p_sala_id, p_proposta_id, p_asaas_payment_id, p_asaas_customer_id, p_valor, p_metodo, p_pix_qrcode, p_pix_copia_cola, p_boleto_url, p_link_pagamento)
  RETURNING id INTO v_pag_id;

  RETURN jsonb_build_object('ok', true, 'pagamento_id', v_pag_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_registrar_pagamento(uuid, uuid, text, text, numeric, text, text, text, text, text) TO anon, authenticated;

-- ================================================
-- RPC: Confirmar pagamento (webhook marca como pago)
-- ================================================
CREATE OR REPLACE FUNCTION public.rpc_confirmar_pagamento(p_asaas_payment_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  UPDATE public.pagamentos SET status = 'confirmado', pago_em = now()
   WHERE asaas_payment_id = p_asaas_payment_id AND status = 'pendente';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pagamento não encontrado');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_confirmar_pagamento(text) TO anon, authenticated;

-- ================================================
-- RPC: Liberar pagamento (quando cliente aprova entrega)
-- ================================================
CREATE OR REPLACE FUNCTION public.rpc_liberar_pagamento(p_sala_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  UPDATE public.pagamentos SET status = 'liberado', liberado_em = now()
   WHERE sala_id = p_sala_id AND status = 'confirmado';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nenhum pagamento confirmado encontrado');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_liberar_pagamento(uuid) TO anon, authenticated;

-- ================================================
-- RPC: Abrir disputa (cliente)
-- ================================================
CREATE OR REPLACE FUNCTION public.rpc_abrir_disputa(p_sala_id uuid, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_pag record;
  v_disputa_id uuid;
BEGIN
  SELECT * INTO v_pag FROM public.pagamentos
   WHERE sala_id = p_sala_id AND status = 'confirmado'
   ORDER BY criado_em DESC LIMIT 1;

  IF v_pag IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nenhum pagamento ativo para disputar');
  END IF;

  IF EXISTS (SELECT 1 FROM public.disputas WHERE pagamento_id = v_pag.id AND status = 'aberta') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Já existe uma disputa aberta');
  END IF;

  UPDATE public.pagamentos SET status = 'disputa' WHERE id = v_pag.id;

  INSERT INTO public.disputas (sala_id, pagamento_id, motivo)
  VALUES (p_sala_id, v_pag.id, trim(p_motivo))
  RETURNING id INTO v_disputa_id;

  RETURN jsonb_build_object('ok', true, 'disputa_id', v_disputa_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_abrir_disputa(uuid, text) TO anon, authenticated;

-- ================================================
-- RPC: Propor valor na disputa
-- ================================================
CREATE OR REPLACE FUNCTION public.rpc_propor_valor_disputa(p_disputa_id uuid, p_valor numeric, p_lado text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_disputa record;
  v_pag record;
BEGIN
  SELECT * INTO v_disputa FROM public.disputas WHERE id = p_disputa_id AND status = 'aberta';

  IF v_disputa IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Disputa não encontrada ou já resolvida');
  END IF;

  SELECT * INTO v_pag FROM public.pagamentos WHERE id = v_disputa.pagamento_id;

  IF p_valor < 0 OR p_valor > v_pag.valor THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Valor deve ser entre 0 e ' || v_pag.valor);
  END IF;

  IF p_lado = 'cliente' THEN
    UPDATE public.disputas SET proposta_cliente = p_valor WHERE id = p_disputa_id;
  ELSIF p_lado = 'consultor' THEN
    UPDATE public.disputas SET proposta_consultor = p_valor WHERE id = p_disputa_id;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'Lado inválido');
  END IF;

  -- Recarregar para verificar acordo
  SELECT * INTO v_disputa FROM public.disputas WHERE id = p_disputa_id;

  IF v_disputa.proposta_cliente IS NOT NULL AND v_disputa.proposta_consultor IS NOT NULL
     AND v_disputa.proposta_cliente = v_disputa.proposta_consultor THEN
    UPDATE public.disputas SET
      status = 'acordo',
      valor_cliente = v_disputa.proposta_cliente,
      valor_consultor = v_pag.valor - v_disputa.proposta_cliente,
      resolvida_em = now()
    WHERE id = p_disputa_id;

    UPDATE public.pagamentos SET status = 'resolvido' WHERE id = v_disputa.pagamento_id;

    RETURN jsonb_build_object('ok', true, 'acordo', true,
      'valor_cliente', v_disputa.proposta_cliente,
      'valor_consultor', v_pag.valor - v_disputa.proposta_cliente);
  END IF;

  RETURN jsonb_build_object('ok', true, 'acordo', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_propor_valor_disputa(uuid, numeric, text) TO anon, authenticated;
