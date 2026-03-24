/**
 * Netlify Function: criar-projeto
 *
 * 1. Cria repositório no GitHub a partir do template cliente-template
 * 2. Cria site na Netlify (sem linking ao GitHub — evita problemas de permissão do GitHub App)
 * 3. Faz o primeiro deploy baixando os arquivos do template via GitHub API e subindo via Netlify Deploy API
 *
 * Variáveis de ambiente:
 *   GITHUB_TOKEN, NETLIFY_TOKEN, GITHUB_OWNER
 */

const crypto = require('crypto');

async function sha1(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido' }) };

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const NETLIFY_TOKEN = process.env.NETLIFY_TOKEN;
  const GITHUB_OWNER = process.env.GITHUB_OWNER || 'agenciafort';

  if (!GITHUB_TOKEN || !NETLIFY_TOKEN) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Tokens não configurados no servidor' }) };
  }

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido' }) }; }

  const nomeCliente = (body.nome || '').trim();
  if (!nomeCliente) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Nome do cliente é obrigatório' }) };

  const slug = nomeCliente.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 50);
  const repoName = `cliente-${slug}`;

  try {
    // 1. Criar repositório a partir do template
    const repoRes = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/cliente-template/generate`, {
      method: 'POST',
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        owner: GITHUB_OWNER,
        name: repoName,
        description: `Projeto do cliente: ${nomeCliente} — AlinhaPro`,
        private: false,
        include_all_branches: false,
      }),
    });

    if (!repoRes.ok) {
      const err = await repoRes.json();
      if (!(repoRes.status === 422 && err.message && err.message.includes('already exists'))) {
        return { statusCode: repoRes.status, headers, body: JSON.stringify({ error: `GitHub: ${err.message || 'Erro ao criar repositório'}` }) };
      }
    }

    const repoFullName = `${GITHUB_OWNER}/${repoName}`;

    await new Promise(r => setTimeout(r, 5000));

    // 2. Ler arquivos do template via GitHub API (contents)
    const templateFiles = await fetchRepoFiles(GITHUB_TOKEN, repoFullName);

    // 3. Criar site na Netlify (sem linking ao GitHub)
    const siteRes = await fetch('https://api.netlify.com/api/v1/sites', {
      method: 'POST',
      headers: { Authorization: `Bearer ${NETLIFY_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: repoName }),
    });

    let siteData;
    if (siteRes.ok) {
      siteData = await siteRes.json();
    } else {
      const errData = await siteRes.json().catch(() => ({}));
      if (siteRes.status === 422 && /already exists/i.test(errData.message || '')) {
        const listRes = await fetch(`https://api.netlify.com/api/v1/sites?filter=all&name=${encodeURIComponent(repoName)}`, {
          headers: { Authorization: `Bearer ${NETLIFY_TOKEN}` },
        });
        const list = await listRes.json();
        siteData = Array.isArray(list) ? list.find(s => s.name === repoName) : null;
        if (!siteData) {
          return { statusCode: 500, headers, body: JSON.stringify({ error: `Netlify: site já existe mas não encontrado` }) };
        }
      } else {
        return { statusCode: 500, headers, body: JSON.stringify({ error: `Netlify: ${errData.message || 'Erro ao criar site'}` }) };
      }
    }

    const siteId = siteData.id;
    const siteUrl = siteData.ssl_url || siteData.url || `https://${siteData.subdomain || repoName}.netlify.app`;

    // 4. Deploy por upload
    if (templateFiles.length > 0) {
      const fileHashes = {};
      for (const f of templateFiles) {
        fileHashes[`/${f.path}`] = await sha1(f.content);
      }

      const deployRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${NETLIFY_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: fileHashes }),
      });

      if (deployRes.ok) {
        const deployData = await deployRes.json();
        const deployId = deployData.id;
        const required = deployData.required || [];

        for (const f of templateFiles) {
          const hash = await sha1(f.content);
          if (required.includes(hash)) {
            await fetch(`https://api.netlify.com/api/v1/deploys/${deployId}/files/${f.path}`, {
              method: 'PUT',
              headers: { Authorization: `Bearer ${NETLIFY_TOKEN}`, 'Content-Type': 'application/octet-stream' },
              body: f.content,
            });
          }
        }
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        repo: repoFullName,
        repoUrl: `https://github.com/${repoFullName}`,
        siteUrl,
        siteName: siteData.name || repoName,
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
