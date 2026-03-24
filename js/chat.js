/** Estado de leitura da sala (preenchido por carregarLeituraChat / realtime) */
let chatLeituraRow = null;
let leituraReportTimer = null;

async function enviarMensagem(salaId, autor, conteudo) {
  const { data, error } = await sb
    .from('mensagens')
    .insert({
      sala_id: salaId,
      autor,
      conteudo
    })
    .select('*')
    .single();

  if (error) {
    showToast('Erro ao enviar mensagem');
    return null;
  }
  return data;
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

async function carregarLeituraChat(salaId) {
  const { data, error } = await sb
    .from('sala_chat_leitura')
    .select('cliente_lida_ate, consultor_lida_ate')
    .eq('sala_id', salaId)
    .maybeSingle();

  if (error) {
    console.warn('carregarLeituraChat:', error);
    chatLeituraRow = null;
    return null;
  }
  chatLeituraRow = data || null;
  return chatLeituraRow;
}

async function reportarLeituraChat(salaId, mensagemId, tokenConsultor) {
  if (!salaId || !mensagemId) return;
  const { data, error } = await sb.rpc('rpc_atualizar_leitura_chat', {
    p_sala_id: salaId,
    p_ultima_mensagem_id: mensagemId,
    p_token: tokenConsultor || null
  });
  if (error) {
    console.warn('reportarLeituraChat:', error);
    return;
  }
  if (data && data.ok === false) console.warn('reportarLeituraChat:', data);
}

/**
 * Marca leitura até a mensagem (debounce). tokenConsultor = sessionStorage token se for consultor.
 */
function agendarReportarLeitura(salaId, mensagemId, tokenConsultor, delayMs) {
  if (!mensagemId) return;
  const delay = typeof delayMs === 'number' ? delayMs : 450;
  clearTimeout(leituraReportTimer);
  leituraReportTimer = setTimeout(() => {
    reportarLeituraChat(salaId, mensagemId, tokenConsultor);
  }, delay);
}

function ouvirLeituraChat(salaId, onChange) {
  return sb
    .channel(`leitura-${salaId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'sala_chat_leitura',
        filter: `sala_id=eq.${salaId}`
      },
      (payload) => {
        const row = payload.new || payload.old;
        if (row && row.sala_id === salaId) {
          chatLeituraRow = {
            cliente_lida_ate: row.cliente_lida_ate,
            consultor_lida_ate: row.consultor_lida_ate
          };
          if (typeof onChange === 'function') onChange(chatLeituraRow);
        }
      }
    )
    .subscribe();
}

function _ts(v) {
  if (v == null) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function mensagemLidaPeloOutro(msg, isConsultor) {
  const t = _ts(msg.enviada_em);
  if (t == null) return false;
  if (isConsultor) {
    const c = _ts(chatLeituraRow && chatLeituraRow.cliente_lida_ate);
    return c != null && c >= t;
  }
  const co = _ts(chatLeituraRow && chatLeituraRow.consultor_lida_ate);
  return co != null && co >= t;
}

function htmlTicks(isMine, msg, isConsultor) {
  if (!isMine) return '';
  const lida = mensagemLidaPeloOutro(msg, isConsultor);
  const cls = lida ? 'msg__ticks msg__ticks--read' : 'msg__ticks';
  const label = lida ? 'Lida' : 'Enviada';
  return `<span class="${cls}" title="${label}" aria-label="${label}"><span class="msg__tick">✓</span><span class="msg__tick">✓</span></span>`;
}

function renderMensagem(msg, meuNome, isConsultor) {
  const isMine = msg.autor === meuNome;
  const div = document.createElement('div');
  div.className = `msg ${isMine ? 'msg--sent' : 'msg--received'}`;
  div.dataset.msgId = msg.id;
  div.dataset.enviadaEm = msg.enviada_em || '';
  const ticks = htmlTicks(isMine, msg, isConsultor);
  div.innerHTML = `
    <div class="msg__author">${escapeHtml(msg.autor)}</div>
    <div>${escapeHtml(msg.conteudo)}</div>
    <div class="msg__footer">
      <span class="msg__time">${formatTime(msg.enviada_em)}</span>
      ${ticks}
    </div>
  `;
  return div;
}

function refreshTicksChat(meuNome, isConsultor) {
  const container = document.getElementById('chatMessages');
  if (!container) return;
  container.querySelectorAll('.msg[data-msg-id]').forEach((el) => {
    const isMine = el.classList.contains('msg--sent');
    if (!isMine) return;
    const msg = {
      id: el.dataset.msgId,
      enviada_em: el.dataset.enviadaEm
    };
    const footer = el.querySelector('.msg__footer');
    if (!footer) return;
    const timeEl = footer.querySelector('.msg__time');
    const timeHtml = timeEl ? timeEl.outerHTML : `<span class="msg__time">${formatTime(msg.enviada_em)}</span>`;
    footer.innerHTML = `${timeHtml}${htmlTicks(true, msg, isConsultor)}`;
  });
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

/** Última mensagem no DOM (para marcar leitura automática). */
function ultimaMensagemIdNoChat() {
  const container = document.getElementById('chatMessages');
  if (!container) return null;
  const nodes = container.querySelectorAll('.msg[data-msg-id]');
  if (!nodes.length) return null;
  return nodes[nodes.length - 1].dataset.msgId;
}
