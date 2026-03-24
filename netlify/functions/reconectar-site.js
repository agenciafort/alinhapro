/**
 * Netlify Function: reconectar-site
 *
 * Para repositório cliente-* que JÁ existe no GitHub:
 * - Se já existir site Netlify com o mesmo nome: faz redeploy baixando arquivos do GitHub e subindo via Netlify Deploy API.
 * - Senão: cria site e faz deploy por upload.
 *
 * Não depende do GitHub App da Netlify — usa deploy por upload direto.
 *
 * Body JSON: { "repoSlug": "cliente-robson-gestao-de-processos" }
 */

const crypto = require('crypto');
const { getCorsHeaders, validateAdminSession, extractToken } = require('./auth-helper');

function sha1(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

exports.handler = async (event) => {
  const headers = getCorsHeaders(event);

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido' }) };

  const token = extractToken(event);
  const user = await validateAdminSession(token);
  if (!user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Não autorizado. Faça login primeiro.' }) };
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const NETLIFY_TOKEN = process.env.NETLIFY_TOKEN;
  const GITHUB_OWNER = process.env.GITHUB_OWNER || 'agenciafort';

  if (!GITHUB_TOKEN || !NETLIFY_TOKEN) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Tokens não configurados no servidor' }) };
  }

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido' }) }; }

  const repoSlug = (body.repoSlug || '').trim();
  if (!repoSlug || !repoSlug.startsWith('cliente-')) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'repoSlug obrigatório e deve começar com cliente-' }) };
  }

  const repoFullName = `${GITHUB_OWNER}/${repoSlug}`;

  try {
    // 1. Verificar se repo existe no GitHub
    const repoInfoRes = await fetch(`https://api.github.com/repos/${repoFullName}`, {
      headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' },
    });

    if (repoInfoRes.status === 404) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: `Repositório não encontrado: ${repoFullName}` }) };
    }
    if (!repoInfoRes.ok) {
      const err = await repoInfoRes.json().catch(() => ({}));
      return { statusCode: repoInfoRes.status, headers, body: JSON.stringify({ error: `GitHub: ${err.message || 'Erro'}` }) };
    }

    // 2. Baixar arquivos do repo via GitHub API
    const templateFiles = await fetchRepoFiles(GITHUB_TOKEN, repoFullName);
    if (templateFiles.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Repositório vazio ou sem arquivos acessíveis' }) };
    }

    // 3. Buscar ou criar site na Netlify
    let siteId = null;
    let siteName = repoSlug;
    let siteUrl = '';
    let alreadyExisted = false;

    const sitesRes = await fetch(`https://api.netlify.com/api/v1/sites?filter=all&name=${encodeURIComponent(repoSlug)}`, {
      headers: { Authorization: `Bearer ${NETLIFY_TOKEN}` },
    });

    if (sitesRes.ok) {
      const sites = await sitesRes.json();
      const existing = Array.isArray(sites) ? sites.find(s => s.name === repoSlug) : null;
      if (existing) {
        siteId = existing.id;
        siteUrl = existing.ssl_url || existing.url || `https://${existing.subdomain || repoSlug}.netlify.app`;
        siteName = existing.name;
        alreadyExisted = true;
      }
    }

    if (!siteId) {
      const createRes = await fetch('https://api.netlify.com/api/v1/sites', {
        method: 'POST',
        headers: { Authorization: `Bearer ${NETLIFY_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: repoSlug }),
      });
      if (!createRes.ok) {
        const errData = await createRes.json().catch(() => ({}));
        return { statusCode: 500, headers, body: JSON.stringify({ error: `Netlify: ${errData.message || 'Erro ao criar site'}` }) };
      }
      const siteData = await createRes.json();
      siteId = siteData.id;
      siteUrl = siteData.ssl_url || siteData.url || `https://${siteData.subdomain || repoSlug}.netlify.app`;
      siteName = siteData.name;
    }

    // 4. Deploy por upload
    const fileHashes = {};
    for (const f of templateFiles) {
      fileHashes[`/${f.path}`] = sha1(f.content);
    }

    const deployRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${NETLIFY_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: fileHashes }),
    });

    if (!deployRes.ok) {
      const errDeploy = await deployRes.json().catch(() => ({}));
      return { statusCode: 500, headers, body: JSON.stringify({ error: `Netlify deploy: ${errDeploy.message || 'Erro'}` }) };
    }

    const deployData = await deployRes.json();
    const deployId = deployData.id;
    const required = deployData.required || [];

    for (const f of templateFiles) {
      const hash = sha1(f.content);
      if (required.includes(hash)) {
        await fetch(`https://api.netlify.com/api/v1/deploys/${deployId}/files/${f.path}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${NETLIFY_TOKEN}`, 'Content-Type': 'application/octet-stream' },
          body: f.content,
        });
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        alreadyExisted,
        repo: repoFullName,
        siteUrl,
        siteName,
      }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Erro interno' }) };
  }
};

async function fetchRepoFiles(token, repoFullName, path = '') {
  const url = `https://api.github.com/repos/${repoFullName}/contents/${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' },
  });

  if (!res.ok) return [];
  const items = await res.json();
  if (!Array.isArray(items)) return [];

  const files = [];
  for (const item of items) {
    if (item.type === 'file') {
      const fileRes = await fetch(item.download_url);
      if (fileRes.ok) {
        const buf = Buffer.from(await fileRes.arrayBuffer());
        files.push({ path: item.path, content: buf });
      }
    } else if (item.type === 'dir' && !item.name.startsWith('.')) {
      const subFiles = await fetchRepoFiles(token, repoFullName, item.path);
      files.push(...subFiles);
    }
  }
  return files;
}
