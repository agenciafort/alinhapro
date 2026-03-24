const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fsrydwoacouogujvmdsf.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || 'sb_publishable_Hwg8d69cRDqy6XBEfXljIQ_HZXN9qzs';
const WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN || '';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Método não permitido' };
  }

  // Validar token do webhook se configurado
  if (WEBHOOK_TOKEN) {
    const authHeader = event.headers['asaas-access-token'] || event.headers['Asaas-Access-Token'] || '';
    if (authHeader !== WEBHOOK_TOKEN) {
      return { statusCode: 401, body: 'Não autorizado' };
    }
  }

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: 'JSON inválido' }; }

  const eventType = body.event;
  const payment = body.payment;

  if (!payment || !payment.id) {
    return { statusCode: 200, body: 'Ignorado - sem payment' };
  }

  // Eventos que confirmam pagamento
  const confirmedEvents = ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'];

  if (confirmedEvents.includes(eventType)) {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_confirmar_pagamento`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify({ p_asaas_payment_id: payment.id }),
    });
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
