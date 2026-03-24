const { getCorsHeaders, validateAdminSession, extractToken } = require('./auth-helper');

const ASAAS_URL = process.env.ASAAS_URL || 'https://api-sandbox.asaas.com/v3';
const ASAAS_KEY = process.env.ASAAS_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fsrydwoacouogujvmdsf.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || 'sb_publishable_Hwg8d69cRDqy6XBEfXljIQ_HZXN9qzs';

exports.handler = async (event) => {
  const headers = getCorsHeaders(event);

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido' }) };

  const token = extractToken(event);
  const user = await validateAdminSession(token);
  if (!user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Não autorizado' }) };
  }

  if (!ASAAS_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'ASAAS_API_KEY não configurada' }) };
  }

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido' }) }; }

  const { salaId, propostaId, valor, clienteNome, clienteCpfCnpj, clienteEmail, metodo } = body;

  if (!salaId || !propostaId || !valor || !clienteNome || !clienteCpfCnpj) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Campos obrigatórios: salaId, propostaId, valor, clienteNome, clienteCpfCnpj' }) };
  }

  const billingType = (metodo || 'PIX').toUpperCase();
  if (!['PIX', 'BOLETO', 'CREDIT_CARD'].includes(billingType)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Método de pagamento inválido. Use PIX, BOLETO ou CREDIT_CARD' }) };
  }

  try {
    // 1. Criar ou buscar cliente no Asaas
    const customerRes = await fetch(`${ASAAS_URL}/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'access_token': ASAAS_KEY },
      body: JSON.stringify({
        name: clienteNome,
        cpfCnpj: clienteCpfCnpj.replace(/\D/g, ''),
        email: clienteEmail || undefined,
      }),
    });

    const customerData = await customerRes.json();
    if (!customerRes.ok && !customerData.id) {
      // Tentar buscar existente por CPF
      const searchRes = await fetch(`${ASAAS_URL}/customers?cpfCnpj=${clienteCpfCnpj.replace(/\D/g, '')}`, {
        headers: { 'access_token': ASAAS_KEY },
      });
      const searchData = await searchRes.json();
      if (searchData.data && searchData.data.length > 0) {
        customerData.id = searchData.data[0].id;
      } else {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Erro ao criar cliente: ' + (customerData.errors?.[0]?.description || JSON.stringify(customerData)) }) };
      }
    }

    const customerId = customerData.id;

    // 2. Criar cobrança
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 3);
    const dueDateStr = dueDate.toISOString().split('T')[0];

    const paymentBody = {
      customer: customerId,
      billingType,
      value: parseFloat(valor),
      dueDate: dueDateStr,
      description: `AlinhaPro - Sala ${salaId.substring(0, 8)}`,
      externalReference: `${salaId}|${propostaId}`,
    };

    const payRes = await fetch(`${ASAAS_URL}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'access_token': ASAAS_KEY },
      body: JSON.stringify(paymentBody),
    });

    const payData = await payRes.json();
    if (!payRes.ok) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Erro ao criar cobrança: ' + (payData.errors?.[0]?.description || JSON.stringify(payData)) }) };
    }

    // 3. Buscar QR Code PIX se for PIX
    let pixQrcode = null;
    let pixCopiaCola = null;
    if (billingType === 'PIX') {
      const pixRes = await fetch(`${ASAAS_URL}/payments/${payData.id}/pixQrCode`, {
        headers: { 'access_token': ASAAS_KEY },
      });
      if (pixRes.ok) {
        const pixData = await pixRes.json();
        pixQrcode = pixData.encodedImage || null;
        pixCopiaCola = pixData.payload || null;
      }
    }

    // 4. Registrar no Supabase
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_registrar_pagamento`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify({
        p_sala_id: salaId,
        p_proposta_id: propostaId,
        p_asaas_payment_id: payData.id,
        p_asaas_customer_id: customerId,
        p_valor: parseFloat(valor),
        p_metodo: billingType,
        p_pix_qrcode: pixQrcode,
        p_pix_copia_cola: pixCopiaCola,
        p_boleto_url: payData.bankSlipUrl || null,
        p_link_pagamento: payData.invoiceUrl || null,
      }),
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        paymentId: payData.id,
        invoiceUrl: payData.invoiceUrl,
        bankSlipUrl: payData.bankSlipUrl || null,
        pixQrcode,
        pixCopiaCola,
        billingType,
        valor: parseFloat(valor),
      }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Erro interno' }) };
  }
};
