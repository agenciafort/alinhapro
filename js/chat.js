async function enviarMensagem(salaId, autor, conteudo) {
  const { error } = await sb
    .from('mensagens')
    .insert({
      sala_id: salaId,
      autor,
      conteudo
    });

  if (error) {
    showToast('Erro ao enviar mensagem');
    return false;
  }
  return true;
}

async function carregarMensagens(salaId) {
  const { data, error } = await sb
    .from('mensagens')
    .select('*')
    .eq('sala_id', salaId)
    .order('enviada_em', { ascending: true });

  if (error) return [];
  return data || [];
}

function renderMensagem(msg, meuNome) {
  const isMine = msg.autor === meuNome;
  const div = document.createElement('div');
  div.className = `msg ${isMine ? 'msg--sent' : 'msg--received'}`;
  div.innerHTML = `
    <div class="msg__author">${escapeHtml(msg.autor)}</div>
    <div>${escapeHtml(msg.conteudo)}</div>
    <div class="msg__time">${formatTime(msg.enviada_em)}</div>
  `;
  return div;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function ouvirMensagens(salaId, callback) {
  return sb
    .channel(`chat-${salaId}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'mensagens', filter: `sala_id=eq.${salaId}` },
      (payload) => {
        callback(payload.new);
      }
    )
    .subscribe();
}

function scrollChatParaBaixo() {
  const container = document.getElementById('chatMessages');
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
}
