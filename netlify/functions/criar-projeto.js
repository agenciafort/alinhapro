/**
 * Netlify Function: criar-projeto
 * 
 * Recebe o nome do cliente, cria um repositório no GitHub (a partir do template),
 * cria um site no Netlify conectado a esse repositório, e retorna a URL do site.
 * 
 * Variáveis de ambiente necessárias (configurar no Netlify):
 *   GITHUB_TOKEN     — Personal Access Token do GitHub (com permissão repo)
 *   NETLIFY_TOKEN    — Personal Access Token do Netlify
 *   GITHUB_OWNER     — Dono dos repositórios (ex: agenciafort)
 *   NETLIFY_TEAM_SLUG — Slug do time no Netlify (ex: agencia-fort) — opcional
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

  const nomeCliente = (body.nome || '').trim();
  if (!nomeCliente) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Nome do cliente é obrigatório' }) };
  }

  const slug = nomeCliente
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);

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
      if (repoRes.status === 422 && err.message && err.message.includes('already exists')) {
        // Repositório já existe — usar ele
      } else {
        return {
          statusCode: repoRes.status,
          headers,
          body: JSON.stringify({ error: `GitHub: ${err.message || 'Erro ao criar repositório'}` }),
        };
      }
    }

    const repoData = repoRes.ok ? await repoRes.json() : null;
    const repoFullName = repoData ? repoData.full_name : `${GITHUB_OWNER}/${repoName}`;

    // Pequeno delay para o GitHub propagar o repo (template generate é async)
    await new Promise(r => setTimeout(r, 3000));

    // 2. Obter o installation_id do GitHub App do Netlify (necessário para linking)
    //    Alternativa: criar site sem linking e usar deploy manual
    //    Vamos usar a abordagem de criar site com repo linking via Netlify API

    // Buscar repo ID do GitHub
    const repoInfoRes = await fetch(`https://api.github.com/repos/${repoFullName}`, {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    let repoId = null;
    if (repoInfoRes.ok) {
      const info = await repoInfoRes.json();
      repoId = info.id;
    }

    // 3. Criar site no Netlify conectado ao repositório
    const sitePayload = {
      name: repoName,
      repo: {
        provider: 'github',
        repo: repoFullName,
        private: false,
        branch: 'main',
        cmd: '',
        dir: '/',
      },
    };

    if (repoId) {
      sitePayload.repo.id = repoId;
    }

    const siteRes = await fetch('https://api.netlify.com/api/v1/sites', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${NETLIFY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sitePayload),
    });

    let siteUrl = '';
    let siteName = '';

    if (siteRes.ok) {
      const siteData = await siteRes.json();
      siteUrl = siteData.ssl_url || siteData.url || `https://${siteData.subdomain}.netlify.app`;
      siteName = siteData.name || siteData.subdomain;
    } else {
      // Se falhar o linking, criar site sem repo e retornar URL mesmo assim
      const fallbackRes = await fetch('https://api.netlify.com/api/v1/sites', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${NETLIFY_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: repoName }),
      });

      if (fallbackRes.ok) {
        const fallbackData = await fallbackRes.json();
        siteUrl = fallbackData.ssl_url || fallbackData.url || `https://${fallbackData.subdomain}.netlify.app`;
        siteName = fallbackData.name || fallbackData.subdomain;
      } else {
        const errData = await fallbackRes.json().catch(() => ({}));
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({
            error: `Netlify: ${errData.message || 'Erro ao criar site'}`,
            repo: repoFullName,
          }),
        };
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
        siteName,
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
