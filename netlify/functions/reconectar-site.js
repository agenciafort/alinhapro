/**
 * Netlify Function: reconectar-site
 *
 * Para repositório cliente-* que JÁ existe no GitHub:
 * - Se já existir site Netlify com o mesmo nome: retorna a URL e dispara novo deploy.
 * - Senão: cria site ligado ao repo (igual fluxo criar-projeto, sem criar repo).
 *
 * Body JSON: { "repoSlug": "cliente-robson-gestao-de-processos" }
 */

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido' }) };
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const NETLIFY_TOKEN = process.env.NETLIFY_TOKEN;
  const GITHUB_OWNER = process.env.GITHUB_OWNER || 'agenciafort';

  if (!GITHUB_TOKEN || !NETLIFY_TOKEN) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Tokens não configurados no servidor' }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const repoSlug = (body.repoSlug || '').trim();
  if (!repoSlug || !repoSlug.startsWith('cliente-')) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'repoSlug obrigatório e deve começar com cliente-' }),
    };
  }

  const repoFullName = `${GITHUB_OWNER}/${repoSlug}`;

  try {
    const repoInfoRes = await fetch(`https://api.github.com/repos/${repoFullName}`, {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (repoInfoRes.status === 404) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: `Repositório não encontrado no GitHub: ${repoFullName}` }),
      };
    }

    if (!repoInfoRes.ok) {
      const err = await repoInfoRes.json().catch(() => ({}));
      return {
        statusCode: repoInfoRes.status,
        headers,
        body: JSON.stringify({ error: `GitHub: ${err.message || 'Erro ao ler repositório'}` }),
      };
    }

    const repoInfo = await repoInfoRes.json();
    const repoId = repoInfo.id;
    const defaultBranch = repoInfo.default_branch || 'main';

    const sitesRes = await fetch(
      `https://api.netlify.com/api/v1/sites?filter=all&name=${encodeURIComponent(repoSlug)}`,
      { headers: { Authorization: `Bearer ${NETLIFY_TOKEN}` } }
    );

    if (!sitesRes.ok) {
      const err = await sitesRes.json().catch(() => ({}));
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: `Netlify (listar): ${err.message || sitesRes.status}` }),
      };
    }

    const sites = await sitesRes.json();
    const existing = Array.isArray(sites) ? sites.find((s) => s.name === repoSlug) : null;

    function siteToUrl(siteData) {
      if (!siteData) return '';
      return (
        siteData.ssl_url ||
        siteData.url ||
        (siteData.subdomain ? `https://${siteData.subdomain}.netlify.app` : '')
      );
    }

    if (existing) {
      const siteUrl = siteToUrl(existing);
      try {
        await fetch(`https://api.netlify.com/api/v1/sites/${existing.id}/builds`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${NETLIFY_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: '{}',
        });
      } catch (_) {
        /* deploy trigger opcional */
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          alreadyExisted: true,
          repo: repoFullName,
          siteUrl,
          siteName: existing.name || repoSlug,
        }),
      };
    }

    const sitePayload = {
      name: repoSlug,
      repo: {
        provider: 'github',
        repo: repoFullName,
        private: !!repoInfo.private,
        branch: defaultBranch,
        cmd: '',
        dir: '/',
        id: repoId,
      },
    };

    const siteCreateRes = await fetch('https://api.netlify.com/api/v1/sites', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${NETLIFY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sitePayload),
    });

    if (siteCreateRes.ok) {
      const siteData = await siteCreateRes.json();
      const siteUrl = siteToUrl(siteData);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          alreadyExisted: false,
          repo: repoFullName,
          siteUrl,
          siteName: siteData.name || repoSlug,
        }),
      };
    }

    const errCreate = await siteCreateRes.json().catch(() => ({}));
    if (siteCreateRes.status === 422 && /already exists|subdomain/i.test(errCreate.message || '')) {
      const retryRes = await fetch(
        `https://api.netlify.com/api/v1/sites?filter=all&name=${encodeURIComponent(repoSlug)}`,
        { headers: { Authorization: `Bearer ${NETLIFY_TOKEN}` } }
      );
      if (retryRes.ok) {
        const list = await retryRes.json();
        const found = Array.isArray(list) ? list.find((s) => s.name === repoSlug) : null;
        if (found) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              ok: true,
              alreadyExisted: true,
              repo: repoFullName,
              siteUrl: siteToUrl(found),
              siteName: found.name,
            }),
          };
        }
      }
    }

    return {
      statusCode: siteCreateRes.status,
      headers,
      body: JSON.stringify({
        ok: false,
        error: `Netlify: ${errCreate.message || 'Erro ao criar site'}`,
        repo: repoFullName,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Erro interno' }),
    };
  }
};
