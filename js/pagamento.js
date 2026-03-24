async function carregarProposta(salaId) {
  const { data, error } = await sb
    .from('propostas')
    .select('*')
    .eq('sala_id', salaId)
    .order('criada_em', { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0];
}

async function carregarPagamento(salaId) {
  const { data, error } = await sb
    .from('pagamentos')
    .select('*')
    .eq('sala_id', salaId)
    .order('criado_em', { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0];
}

async function carregarDisputa(salaId) {
  const { data, error } = await sb
    .from('disputas')
    .select('*')
    .eq('sala_id', salaId)
    .eq('status', 'aberta')
    .order('criada_em', { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0];
}

async function criarProposta(salaId, valor, descricao) {
  const token = getAuthToken();
  const { data, error } = await sb.rpc('rpc_criar_proposta', {
    p_token: token,
    p_sala_id: salaId,
    p_valor: valor,
    p_descricao: descricao || ''
  });
  if (error) { showToast('Erro: ' + error.message); return null; }
  const res = typeof data === 'string' ? JSON.parse(data) : data;
  if (!res || !res.ok) { showToast(res ? res.error : 'Erro ao criar proposta'); return null; }
  return res;
}

async function responderProposta(salaId, propostaId, aceitar) {
  const { data, error } = await sb.rpc('rpc_responder_proposta', {
    p_sala_id: salaId,
    p_proposta_id: propostaId,
    p_aceitar: aceitar
  });
  if (error) { showToast('Erro: ' + error.message); return null; }
  const res = typeof data === 'string' ? JSON.parse(data) : data;
  if (!res || !res.ok) { showToast(res ? res.error : 'Erro'); return null; }
  return res;
}

async function gerarCobranca(salaId, propostaId, valor, clienteNome, clienteCpfCnpj, clienteEmail, metodo) {
  const token = getAuthToken();
  const res = await fetch('/.netlify/functions/criar-cobranca', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ salaId, propostaId, valor, clienteNome, clienteCpfCnpj, clienteEmail, metodo }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    showToast('Erro: ' + (data.error || 'Falha ao gerar cobrança'));
    return null;
  }
  return data;
}

async function liberarPagamento(salaId) {
  const { data, error } = await sb.rpc('rpc_liberar_pagamento', { p_sala_id: salaId });
  if (error) { showToast('Erro: ' + error.message); return false; }
  const res = typeof data === 'string' ? JSON.parse(data) : data;
  if (!res || !res.ok) { showToast(res ? res.error : 'Erro'); return false; }
  return true;
}

async function abrirDisputa(salaId, motivo) {
  const { data, error } = await sb.rpc('rpc_abrir_disputa', {
    p_sala_id: salaId,
    p_motivo: motivo
  });
  if (error) { showToast('Erro: ' + error.message); return null; }
  const res = typeof data === 'string' ? JSON.parse(data) : data;
  if (!res || !res.ok) { showToast(res ? res.error : 'Erro'); return null; }
  return res;
}

async function proporValorDisputa(disputaId, valor, lado) {
  const { data, error } = await sb.rpc('rpc_propor_valor_disputa', {
    p_disputa_id: disputaId,
    p_valor: valor,
    p_lado: lado
  });
  if (error) { showToast('Erro: ' + error.message); return null; }
  const res = typeof data === 'string' ? JSON.parse(data) : data;
  if (!res || !res.ok) { showToast(res ? res.error : 'Erro'); return null; }
  return res;
}

function formatarDinheiro(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
}

function ouvirMudancasPagamento(salaId, callback) {
  sb.channel(`pag-${salaId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'propostas', filter: `sala_id=eq.${salaId}` }, () => callback())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pagamentos', filter: `sala_id=eq.${salaId}` }, () => callback())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'disputas', filter: `sala_id=eq.${salaId}` }, () => callback())
    .subscribe();
}
