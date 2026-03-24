const COLUNAS_SALA_SEGURAS = 'id,nome,documento,status,preview_url,criada_em';

function chaveTokenAdmin(salaId) {
  return 'alinhapro_admin_token_' + salaId;
}

function getAdminToken(salaId) {
  return sessionStorage.getItem(chaveTokenAdmin(salaId));
}

function setAdminToken(salaId, token) {
  if (token) sessionStorage.setItem(chaveTokenAdmin(salaId), token);
}

function limparSessaoConsultor(salaId) {
  sessionStorage.removeItem(chaveTokenAdmin(salaId));
}

async function adminLogin(salaId, senhaPlain) {
  const { data, error } = await sb.rpc('rpc_admin_login', {
    p_sala_id: salaId,
    p_senha: senhaPlain
  });
  if (error) {
    console.error('adminLogin:', error);
    return null;
  }
  if (!data) return null;
  const token = typeof data === 'string' ? data : String(data);
  setAdminToken(salaId, token);
  return token;
}

async function criarSala(nome, senhaAdmin, previewUrl) {
  try {
    const params = { p_nome: nome, p_senha: senhaAdmin };
    if (previewUrl) params.p_preview_url = previewUrl;
    const { data, error } = await sb.rpc('rpc_criar_sala', params);

    if (error) {
      console.error('Erro Supabase:', error);
      showToast('Erro ao criar sala: ' + error.message);
      return null;
    }

    if (data == null) return null;
    if (typeof data === 'object') return data;
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  } catch (e) {
    console.error('Erro inesperado:', e);
    showToast('Erro inesperado: ' + e.message);
    return null;
  }
}

async function listarSalas() {
  const { data, error } = await sb
    .from('salas')
    .select(COLUNAS_SALA_SEGURAS)
    .order('criada_em', { ascending: false });

  if (error) {
    showToast('Erro ao listar salas: ' + error.message);
    return [];
  }

  return data || [];
}

async function buscarSala(id) {
  const { data, error } = await sb
    .from('salas')
    .select(COLUNAS_SALA_SEGURAS)
    .eq('id', id)
    .single();

  if (error) return null;
  return data;
}

async function atualizarDocumento(salaId, conteudo) {
  const token = getAdminToken(salaId);
  if (!token) {
    showToast('Sessão de consultor não encontrada. Entre com a senha novamente.');
    return false;
  }

  const { data, error } = await sb.rpc('rpc_atualizar_documento', {
    p_sala_id: salaId,
    p_token: token,
    p_documento: conteudo
  });

  if (error) {
    showToast('Erro ao salvar: ' + error.message);
    return false;
  }

  if (data !== true) {
    limparSessaoConsultor(salaId);
    showToast('Sessão inválida ou expirada. Entre como consultor de novo.');
    return false;
  }

  return true;
}

async function alterarStatusSala(salaId, status, senhaAdmin) {
  const { data, error } = await sb.rpc('rpc_alterar_status_sala', {
    p_sala_id: salaId,
    p_senha: senhaAdmin,
    p_status: status
  });

  if (error) {
    showToast('Erro: ' + error.message);
    return false;
  }

  if (data !== true) {
    showToast('Senha incorreta ou sala inválida.');
    return false;
  }

  return true;
}

async function atualizarPreviewUrl(salaId, url) {
  const token = getAdminToken(salaId);
  if (!token) {
    showToast('Sessão de consultor não encontrada.');
    return false;
  }
  const { data, error } = await sb.rpc('rpc_atualizar_preview_url', {
    p_sala_id: salaId,
    p_token: token,
    p_url: url || ''
  });
  if (error) {
    showToast('Erro ao salvar URL: ' + error.message);
    return false;
  }
  if (data !== true) {
    showToast('Sessão inválida. Entre como consultor de novo.');
    return false;
  }
  return true;
}

/** Atualiza preview_url usando senha admin (útil no painel admin.html, sem sessão na sala). */
async function atualizarPreviewUrlComSenha(salaId, senhaAdmin, url) {
  const { data, error } = await sb.rpc('rpc_atualizar_preview_url_senha', {
    p_sala_id: salaId,
    p_senha: senhaAdmin,
    p_url: url || ''
  });
  if (error) {
    showToast('Erro ao salvar URL: ' + error.message);
    return false;
  }
  if (data !== true) {
    showToast('Senha incorreta ou sala inválida.');
    return false;
  }
  return true;
}

function ouvirMudancasSala(salaId, callback) {
  return sb
    .channel(`doc-${salaId}`)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'salas', filter: `id=eq.${salaId}` },
      (payload) => {
        callback(payload.new);
      }
    )
    .subscribe();
}
