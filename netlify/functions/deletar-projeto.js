/**
 * Netlify Function: deletar-projeto
 * 
 * Recebe o slug do repositório (ex: "cliente-robson") e:
 *  1. Deleta o repositório no GitHub
 *  2. Deleta o site no Netlify (busca pelo nome)
 * 
 * Segurança: só deleta repos que começam com "cliente-"
 */

const { getCorsHeaders, validateAdminSession, extractToken } = require('./auth-helper');

exports.handler = async (event) => {
  const headers = getCorsHeaders(event);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Método não permitido' }) };
  }

  const token = extractToken(event);
  const user = await validateAdminSession(token);
  if (!user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Não autorizado. Faça login primeiro.' }) };
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const NETLIFY_TOKEN = process.env.NETLIFY_TOKEN;
  const GITHUB_OWNER = process.env.GITHUB_OWNER || 'agenciafort';

  if (!GITHUB_TOKEN || !NETLIFY_TOKEN) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Tokens não configurados' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const repoSlug = (body.repoSlug || '').trim();

  if (!repoSlug || !repoSlug.startsWith('cliente-')) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Slug inválido ou não é um projeto de cliente' }) };
  }

  const resultados = { repoDeleted: false, siteDeleted: false, errors: [] };

  try {
    // 1. Deletar repositório no GitHub
    const repoRes = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${repoSlug}`, {
      method: 'DELETE',
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (repoRes.status === 204 || repoRes.status === 404) {
      resultados.repoDeleted = true;
    } else {
      const err = await repoRes.json().catch(() => ({}));
      resultados.errors.push(`GitHub (${repoRes.status}): ${err.message || 'Erro ao deletar repo'}`);
    }
  } catch (e) {
    resultados.errors.push(`GitHub: ${e.message}`);
  }

  try {
    // 2. Buscar site no Netlify pelo nome
    const sitesRes = await fetch(`https://api.netlify.com/api/v1/sites?filter=all&name=${repoSlug}`, {
      headers: { Authorization: `Bearer ${NETLIFY_TOKEN}` },
    });

    if (sitesRes.ok) {
      const sites = await sitesRes.json();
      const site = sites.find(s => s.name === repoSlug);

      if (site) {
        const delRes = await fetch(`https://api.netlify.com/api/v1/sites/${site.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${NETLIFY_TOKEN}` },
        });

        if (delRes.status === 204 || delRes.status === 200 || delRes.status === 404) {
          resultados.siteDeleted = true;
        } else {
          const err = await delRes.json().catch(() => ({}));
          resultados.errors.push(`Netlify delete (${delRes.status}): ${err.message || 'Erro'}`);
        }
      } else {
        resultados.siteDeleted = true;
      }
    } else {
      resultados.errors.push('Netlify: erro ao buscar sites');
    }
  } catch (e) {
    resultados.errors.push(`Netlify: ${e.message}`);
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      ok: resultados.repoDeleted && resultados.siteDeleted,
      ...resultados,
    }),
  };
};
