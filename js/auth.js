const AUTH_TOKEN_KEY = 'alinhapro_user_token';
const AUTH_USER_KEY = 'alinhapro_user';

function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

function getAuthUser() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_USER_KEY));
  } catch {
    return null;
  }
}

function setAuthSession(token, usuario) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(usuario));
}

function clearAuthSession() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
}

function isSuperAdmin() {
  const user = getAuthUser();
  return user && user.role === 'superadmin';
}

function isAuthAdmin() {
  const user = getAuthUser();
  return user && (user.role === 'admin' || user.role === 'superadmin');
}

async function authLogin(email, senha) {
  const { data, error } = await sb.rpc('rpc_user_login', {
    p_email: email,
    p_senha: senha
  });
  if (error) {
    console.error('authLogin:', error);
    return { ok: false, error: error.message };
  }
  const res = typeof data === 'string' ? JSON.parse(data) : data;
  if (res && res.ok) {
    setAuthSession(res.token, res.usuario);
  }
  return res;
}

async function authLogout() {
  const token = getAuthToken();
  if (token) {
    await sb.rpc('rpc_user_logout', { p_token: token });
  }
  clearAuthSession();
}

async function authValidateSession() {
  const token = getAuthToken();
  if (!token) return null;

  const { data, error } = await sb.rpc('rpc_validar_sessao', { p_token: token });
  if (error || !data) {
    clearAuthSession();
    return null;
  }

  const usuario = typeof data === 'string' ? JSON.parse(data) : data;
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(usuario));
  return usuario;
}

async function requireAuth(allowedRoles) {
  const usuario = await authValidateSession();
  if (!usuario) {
    window.location.href = 'login.html';
    return null;
  }
  if (allowedRoles && !allowedRoles.includes(usuario.role)) {
    window.location.href = 'admin.html';
    return null;
  }
  return usuario;
}

async function authCriarAdmin(email, nome, senha) {
  const token = getAuthToken();
  const { data, error } = await sb.rpc('rpc_criar_admin', {
    p_token: token,
    p_email: email,
    p_nome: nome,
    p_senha: senha
  });
  if (error) return { ok: false, error: error.message };
  return typeof data === 'string' ? JSON.parse(data) : data;
}

async function authListarAdmins() {
  const token = getAuthToken();
  const { data, error } = await sb.rpc('rpc_listar_admins', { p_token: token });
  if (error) return { ok: false, error: error.message };
  return typeof data === 'string' ? JSON.parse(data) : data;
}

async function authToggleAdmin(adminId, ativo) {
  const token = getAuthToken();
  const { data, error } = await sb.rpc('rpc_toggle_admin', {
    p_token: token,
    p_admin_id: adminId,
    p_ativo: ativo
  });
  if (error) return { ok: false, error: error.message };
  return typeof data === 'string' ? JSON.parse(data) : data;
}

async function authResetarSenha(adminId, novaSenha) {
  const token = getAuthToken();
  const { data, error } = await sb.rpc('rpc_resetar_senha_admin', {
    p_token: token,
    p_admin_id: adminId,
    p_nova_senha: novaSenha
  });
  if (error) return { ok: false, error: error.message };
  return typeof data === 'string' ? JSON.parse(data) : data;
}

async function authDeletarAdmin(adminId) {
  const token = getAuthToken();
  const { data, error } = await sb.rpc('rpc_deletar_admin', {
    p_token: token,
    p_admin_id: adminId
  });
  if (error) return { ok: false, error: error.message };
  return typeof data === 'string' ? JSON.parse(data) : data;
}

async function listarSalasAdmin() {
  const token = getAuthToken();
  const { data, error } = await sb.rpc('rpc_listar_salas_admin', { p_token: token });
  if (error) return [];
  const res = typeof data === 'string' ? JSON.parse(data) : data;
  if (!res || !res.ok) return [];
  return res.salas || [];
}
