/**
 * AlinhaPro — Netlify Function: Enviar Notificação
 * Envia Web Push para todos os admins + Telegram (se configurado).
 *
 * POST body: { title, body, url, tag }
 * Chamada internamente pelo widget ou pelo Supabase webhook.
 *
 * Env vars necessárias:
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

const { getCorsHeaders } = require('./auth-helper');

exports.handler = async (event) => {
  const cors = getCorsHeaders(event);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { title, body, url, tag } = JSON.parse(event.body || '{}');
    if (!title && !body) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'title ou body obrigatório' }) };
    }

    const results = { push: 0, pushErrors: 0, telegram: false };

    // ─── 1. Web Push ───
    const vapidPublic = process.env.VAPID_PUBLIC_KEY;
    const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
    const vapidEmail = process.env.VAPID_EMAIL;

    if (vapidPublic && vapidPrivate && vapidEmail) {
      let webpush;
      try {
        webpush = require('web-push');
      } catch (e) {
        console.warn('web-push not installed, skipping push notifications');
        webpush = null;
      }

      if (webpush) {
        webpush.setVapidDetails('mailto:' + vapidEmail, vapidPublic, vapidPrivate);

        // Buscar subscrições do banco
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

        const subsRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_listar_push_subs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`
          },
          body: '{}'
        });

        if (subsRes.ok) {
          const subsData = await subsRes.json();
          const subs = (subsData && subsData.subs) || [];

          const payload = JSON.stringify({
            title: title || 'AlinhaPro',
            body: body || '',
            url: url || '/leads.html',
            tag: tag || 'alinhapro-' + Date.now()
          });

          for (const sub of subs) {
            try {
              await webpush.sendNotification({
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth }
              }, payload);
              results.push++;
            } catch (err) {
              results.pushErrors++;
              // Se endpoint expirou, remover do banco
              if (err.statusCode === 410 || err.statusCode === 404) {
                await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, {
                  method: 'DELETE',
                  headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`
                  }
                }).catch(() => {});
              }
            }
          }
        }
      }
    }

    // ─── 2. Telegram ───
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

    // Buscar config do Telegram
    const tgTokenRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_config_publica`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      },
      body: JSON.stringify({ p_chave: 'telegram_bot_token' })
    });

    const tgChatRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rpc_config_publica`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      },
      body: JSON.stringify({ p_chave: 'telegram_chat_id' })
    });

    let tgToken = '';
    let tgChatId = '';
    if (tgTokenRes.ok) tgToken = (await tgTokenRes.json()) || '';
    if (tgChatRes.ok) tgChatId = (await tgChatRes.json()) || '';

    if (tgToken && tgChatId) {
      const text = `🔔 *${title || 'AlinhaPro'}*\n\n${body || ''}${url ? '\n\n[Abrir](' + url + ')' : ''}`;

      try {
        const tgRes = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: tgChatId,
            text: text,
            parse_mode: 'Markdown',
            disable_web_page_preview: true
          })
        });
        results.telegram = tgRes.ok;
      } catch (err) {
        console.error('Telegram error:', err);
      }
    }

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ ok: true, ...results })
    };

  } catch (err) {
    console.error('enviar-notificacao error:', err);
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: err.message })
    };
  }
};
