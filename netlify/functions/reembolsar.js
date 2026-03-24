const { getCorsHeaders, validateAdminSession, extractToken } = require('./auth-helper');

const ASAAS_URL = process.env.ASAAS_URL || 'https://api-sandbox.asaas.com/v3';
const ASAAS_KEY = process.env.ASAAS_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fsrydwoacouogujvmdsf.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || 'sb_publishable_Hwg8d69cRDqy6XBEfXljIQ_HZXN9qzs';

exports.handler = async (event) => {
  const headers = getCorsHeaders(event);

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido' }) };

  if (!ASAAS_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'ASAAS_API_KEY não configurada' }) };
  }

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido' }) }; }

  const { asaasPaymentId, valorReembolso, tipo } = body;

  if (!asaasPaymentId || !tipo) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Campos obrigatórios: asaasPaymentId, tipo' }) };
  }

  try {
    if (tipo === 'total') {
      // Reembolso total
      const res = await fetch(`${ASAAS_URL}/payments/${asaasPaymentId}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'access_token': ASAAS_KEY },
      });
      const data = await res.json();
      if (!res.ok) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Erro no reembolso: ' + (data.errors?.[0]?.description || JSON.stringify(data)) }) };
      }
    } else if (tipo === 'parcial' && valorReembolso) {
      // Reembolso parcial (80% cliente / 20% consultor em caso de expiração)
      const res = await fetch(`${ASAAS_URL}/payments/${asaasPaymentId}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'access_token': ASAAS_KEY },
        body: JSON.stringify({ value: parseFloat(valorReembolso) }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Erro no reembolso parcial: ' + (data.errors?.[0]?.description || JSON.stringify(data)) }) };
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Erro interno' }) };
  }
};
