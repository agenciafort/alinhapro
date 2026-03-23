async function criarSala(nome, senhaAdmin) {
  try {
    const docInicial = `# ${nome}\n\nBem-vindo à sala de consultoria.\n\n## Tópicos\n\n- Aguardando início da discussão...\n`;

    const { data, error } = await sb
      .from('salas')
      .insert({
        nome,
        documento: docInicial,
        status: 'ativa',
        senha_admin: senhaAdmin
      })
      .select()
      .single();

    if (error) {
      console.error('Erro Supabase:', error);
      showToast('Erro ao criar sala: ' + error.message);
      return null;
    }

    return data;
  } catch (e) {
    console.error('Erro inesperado:', e);
    showToast('Erro inesperado: ' + e.message);
    return null;
  }
}

async function listarSalas() {
  const { data, error } = await sb
    .from('salas')
    .select('*')
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
    .select('*')
    .eq('id', id)
    .single();

  if (error) return null;
  return data;
}

async function atualizarDocumento(salaId, conteudo) {
  const { error } = await sb
    .from('salas')
    .update({ documento: conteudo })
    .eq('id', salaId);

  if (error) {
    showToast('Erro ao salvar documento');
    return false;
  }
  return true;
}

async function alterarStatusSala(salaId, status) {
  const { error } = await sb
    .from('salas')
    .update({ status })
    .eq('id', salaId);

  if (error) {
    showToast('Erro ao alterar status');
    return false;
  }
  return true;
}

function ouvirMudancasDocumento(salaId, callback) {
  return sb
    .channel(`doc-${salaId}`)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'salas', filter: `id=eq.${salaId}` },
      (payload) => {
        callback(payload.new.documento);
      }
    )
    .subscribe();
}
