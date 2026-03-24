const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fsrydwoacouogujvmdsf.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || 'sb_publishable_Hwg8d69cRDqy6XBEfXljIQ_HZXN9qzs';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://alinhapro.netlify.app';

function getCorsHeaders(event) {
  const origin = (event.headers && (event.headers.origin || event.headers.Origin)) || '';
  const allowed = origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
    'Vary': 'Origin',
  };
}

async function validateAdminSession(token) {
  if (!token || !SUPABASE_URL) return null;

  const url = `${SUPABASE_URL}/rest/v1/rpc/rpc_validar_sessao`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify({ p_token: token }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  if (!data || !data.id) return null;
  return data;
}

function extractToken(event) {
  const auth = event.headers && (event.headers.authorization || event.headers.Authorization);
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  try {
    const body = JSON.parse(event.body || '{}');
    return body.userToken || null;
  } catch {
    return null;
  }
}

module.exports = { getCorsHeaders, validateAdminSession, extractToken };
