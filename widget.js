/**
 * AlinhaPro — Widget de Chat Embarcável
 *
 * Uso: <script src="https://SEU-SITE.netlify.app/widget.js" data-key="SUA_SUPABASE_KEY" async></script>
 *
 * O script cria um FAB flutuante e, ao clicar, abre um chat de atendimento.
 * Supabase JS é carregado sob demanda (lazy) no primeiro clique.
 * Todo CSS vive em Shadow DOM — não conflita com o site hospedeiro.
 */
;(function () {
  'use strict';

  /* ─── Configuração ─── */
  var SCRIPT_TAG = document.currentScript;
  var SUPABASE_URL = SCRIPT_TAG ? (SCRIPT_TAG.getAttribute('data-url') || 'https://fsrydwoacouogujvmdsf.supabase.co') : 'https://fsrydwoacouogujvmdsf.supabase.co';
  var SUPABASE_KEY = SCRIPT_TAG ? (SCRIPT_TAG.getAttribute('data-key') || '') : '';
  var BRAND = SCRIPT_TAG ? (SCRIPT_TAG.getAttribute('data-brand') || 'AlinhaPro') : 'AlinhaPro';
  var COLOR = SCRIPT_TAG ? (SCRIPT_TAG.getAttribute('data-color') || '#2563eb') : '#2563eb';
  var POSITION = SCRIPT_TAG ? (SCRIPT_TAG.getAttribute('data-position') || 'right') : 'right';
  var GREETING = SCRIPT_TAG ? (SCRIPT_TAG.getAttribute('data-greeting') || 'Olá! Fale com um especialista agora.') : 'Olá! Fale com um especialista agora.';
  var LS_PREFIX = 'alinhapro_widget_';
  var SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';

  /* ─── Estado ─── */
  var sb = null; // supabase client (lazy)
  var channel = null;
  var salaId = null;
  var leadNome = '';
  var leadContato = '';
  var isOpen = false;
  var formSubmitted = false;
  var shadowRoot = null;
  var unreadCount = 0;

  /* ─── Helpers ─── */
  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function lsGet(k) {
    try { return localStorage.getItem(LS_PREFIX + k); } catch (e) { return null; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(LS_PREFIX + k, v); } catch (e) { /* silent */ }
  }

  /* ─── CSS do Widget (isolado em Shadow DOM) ─── */
  function getCSS() {
    var pos = POSITION === 'left' ? 'left: 20px;' : 'right: 20px;';
    var posChat = POSITION === 'left' ? 'left: 20px;' : 'right: 20px;';
    var colorDark = COLOR;
    return '\
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap");\
*{margin:0;padding:0;box-sizing:border-box}\
:host{all:initial;font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;line-height:1.5;color:#1f2937}\
\
.ap-fab{position:fixed;bottom:20px;' + pos + 'z-index:999999;display:flex;align-items:center;gap:6px;\
cursor:pointer;border:none;background:transparent;padding:0;outline:none;-webkit-tap-highlight-color:transparent}\
.ap-fab__inner{width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,' + colorDark + ',#1e40af);\
display:flex;align-items:center;justify-content:center;position:relative;overflow:visible;\
box-shadow:0 4px 14px rgba(37,99,235,.35);transition:transform .2s}\
.ap-fab:hover .ap-fab__inner{transform:scale(1.08)}\
.ap-fab__glow{position:absolute;top:50%;left:50%;width:56px;height:56px;border-radius:50%;\
background:radial-gradient(circle,' + colorDark + ' 0%,transparent 70%);opacity:.6;\
transform:translate(-50%,-50%) scale(1);animation:apGlow 2.5s ease-in-out infinite;pointer-events:none}\
@keyframes apGlow{\
0%,100%{transform:translate(-50%,-50%) scale(1);opacity:.6}\
50%{transform:translate(-50%,-50%) scale(1.45);opacity:.2}\
}\
.ap-fab__icon{position:relative;z-index:1}\
.ap-fab__badge{background:' + colorDark + ';color:#fff;font-size:11px;font-weight:600;padding:2px 8px;\
border-radius:12px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.15)}\
.ap-fab__unread{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;border-radius:10px;\
background:#dc2626;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;\
justify-content:center;padding:0 5px;box-shadow:0 2px 6px rgba(220,38,38,.4);animation:apPop .3s}\
@keyframes apPop{0%{transform:scale(0)}100%{transform:scale(1)}}\
\
.ap-window{position:fixed;bottom:84px;' + posChat + 'z-index:999999;\
width:370px;max-width:calc(100vw - 24px);height:520px;max-height:calc(100vh - 100px);\
border-radius:16px;background:#fff;box-shadow:0 20px 60px rgba(0,0,0,.18),0 0 0 1px rgba(0,0,0,.05);\
display:flex;flex-direction:column;overflow:hidden;opacity:0;transform:translateY(16px) scale(.96);\
transition:opacity .25s,transform .25s;pointer-events:none}\
.ap-window--open{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}\
\
.ap-header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;\
background:linear-gradient(135deg,' + colorDark + ',#1e40af);color:#fff;flex-shrink:0}\
.ap-header__brand{font-size:15px;font-weight:700;letter-spacing:-.02em}\
.ap-header__close{width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,.18);\
border:none;cursor:pointer;color:#fff;display:flex;align-items:center;justify-content:center;\
transition:background .15s}\
.ap-header__close:hover{background:rgba(255,255,255,.3)}\
\
.ap-body{flex:1;display:flex;flex-direction:column;overflow:hidden}\
\
.ap-form{padding:24px 20px;display:flex;flex-direction:column;gap:14px;flex:1;justify-content:center}\
.ap-form__greeting{font-size:18px;font-weight:600;color:#1f2937;line-height:1.3}\
.ap-form__label{font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.04em}\
.ap-form__input{width:100%;padding:10px 12px;border:1.5px solid #d1d5db;border-radius:8px;\
font-size:14px;font-family:inherit;outline:none;transition:border-color .15s}\
.ap-form__input:focus{border-color:' + colorDark + '}\
.ap-form__input--error{border-color:#dc2626}\
.ap-form__error{font-size:11px;color:#dc2626;margin-top:-8px}\
.ap-form__btn{padding:12px;border:none;border-radius:8px;\
background:linear-gradient(135deg,' + colorDark + ',#1e40af);color:#fff;\
font-size:15px;font-weight:600;cursor:pointer;transition:opacity .15s;font-family:inherit}\
.ap-form__btn:hover{opacity:.9}\
.ap-form__btn:disabled{opacity:.5;cursor:not-allowed}\
\
.ap-msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px;\
scroll-behavior:smooth}\
.ap-msgs::-webkit-scrollbar{width:4px}\
.ap-msgs::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:4px}\
\
.ap-msg{max-width:82%;padding:10px 14px;border-radius:14px;font-size:13px;line-height:1.45;word-break:break-word}\
.ap-msg--sent{align-self:flex-end;background:' + colorDark + ';color:#fff;border-bottom-right-radius:4px}\
.ap-msg--received{align-self:flex-start;background:#f3f4f6;color:#1f2937;border-bottom-left-radius:4px}\
.ap-msg--system{align-self:center;background:transparent;color:#9ca3af;font-size:12px;font-style:italic;text-align:center;padding:4px 8px}\
.ap-msg__author{font-size:11px;font-weight:600;opacity:.7;margin-bottom:2px}\
.ap-msg__time{font-size:10px;opacity:.6;margin-top:3px;text-align:right}\
.ap-msg__ticks{font-size:10px;letter-spacing:-2px;margin-left:4px}\
.ap-msg__ticks--read{color:#93c5fd}\
\
.ap-compose{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #e5e7eb;flex-shrink:0;align-items:flex-end}\
.ap-compose__input{flex:1;padding:10px 12px;border:1.5px solid #d1d5db;border-radius:20px;\
font-size:14px;font-family:inherit;outline:none;resize:none;max-height:80px;min-height:40px;\
line-height:1.4;transition:border-color .15s}\
.ap-compose__input:focus{border-color:' + colorDark + '}\
.ap-compose__btn{width:40px;height:40px;border-radius:50%;border:none;\
background:linear-gradient(135deg,' + colorDark + ',#1e40af);color:#fff;\
cursor:pointer;display:flex;align-items:center;justify-content:center;\
flex-shrink:0;transition:opacity .15s}\
.ap-compose__btn:hover{opacity:.9}\
.ap-compose__btn:disabled{opacity:.35;cursor:not-allowed}\
\
.ap-typing{padding:4px 16px 8px;font-size:11px;color:#9ca3af;font-style:italic;flex-shrink:0;min-height:0}\
\
@media(max-width:480px){\
  .ap-window{top:0;left:0;right:0;bottom:0;width:100%;height:100%;max-width:100%;max-height:100%;\
  border-radius:0}\
  .ap-fab__badge{display:none}\
}\
@media(max-width:380px){\
  .ap-fab__badge{display:none}\
}\
';
  }

  /* ─── HTML do FAB ─── */
  function createFAB() {
    var btn = document.createElement('button');
    btn.className = 'ap-fab';
    btn.setAttribute('aria-label', 'Abrir chat');
    btn.innerHTML = '\
<span class="ap-fab__inner">\
  <span class="ap-fab__glow"></span>\
  <svg class="ap-fab__icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>\
  </svg>\
</span>\
<span class="ap-fab__badge">Chat</span>';
    return btn;
  }

  /* ─── HTML da janela de chat ─── */
  function createWindow() {
    var w = document.createElement('div');
    w.className = 'ap-window';
    w.innerHTML = '\
<div class="ap-header">\
  <span class="ap-header__brand">' + esc(BRAND) + '</span>\
  <button class="ap-header__close" aria-label="Fechar chat">\
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg>\
  </button>\
</div>\
<div class="ap-body">\
  <div class="ap-form" id="apForm">\
    <div class="ap-form__greeting">' + esc(GREETING) + '</div>\
    <div>\
      <label class="ap-form__label" for="apNome">Seu nome</label>\
      <input class="ap-form__input" id="apNome" type="text" placeholder="Como quer ser chamado?" autocomplete="name">\
    </div>\
    <div>\
      <label class="ap-form__label" for="apContato">WhatsApp ou e-mail *</label>\
      <input class="ap-form__input" id="apContato" type="text" placeholder="(15) 99999-0000 ou email@..." autocomplete="email" required>\
      <div class="ap-form__error" id="apContatoError" style="display:none"></div>\
    </div>\
    <button class="ap-form__btn" id="apFormBtn" type="button">Iniciar conversa</button>\
  </div>\
  <div class="ap-msgs" id="apMsgs" style="display:none"></div>\
  <div class="ap-typing" id="apTyping"></div>\
  <div class="ap-compose" id="apCompose" style="display:none">\
    <textarea class="ap-compose__input" id="apInput" rows="1" placeholder="Digite sua mensagem..."></textarea>\
    <button class="ap-compose__btn" id="apSendBtn" aria-label="Enviar" disabled>\
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>\
    </button>\
  </div>\
</div>';
    return w;
  }

  /* ─── Validação ─── */
  function validarContato(v) {
    v = v.trim();
    if (!v) return 'Informe seu WhatsApp ou e-mail';
    var emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    var phoneRx = /[\d]{10,}/;
    var digits = v.replace(/\D/g, '');
    if (emailRx.test(v)) return '';
    if (phoneRx.test(digits)) return '';
    return 'Formato inválido. Use (XX) XXXXX-XXXX ou email@...';
  }

  /* ─── Carregar Supabase sob demanda ─── */
  function carregarSupabase(cb) {
    if (window.supabase && window.supabase.createClient) {
      return cb();
    }
    var s = document.createElement('script');
    s.src = SUPABASE_CDN;
    s.onload = cb;
    s.onerror = function () {
      console.error('[AlinhaPro Widget] Falha ao carregar Supabase');
    };
    document.head.appendChild(s);
  }

  function initSupabase() {
    if (sb) return;
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }

  /* ─── Criar sala de lead ─── */
  function criarSalaLead(nome, contato, cb) {
    initSupabase();
    sb.rpc('rpc_criar_sala_lead', {
      p_nome: nome || '',
      p_contato: contato,
      p_pagina: window.location.href,
      p_referrer: document.referrer || '',
      p_user_agent: navigator.userAgent || ''
    }).then(function (res) {
      if (res.error) {
        console.error('[AlinhaPro Widget] rpc_criar_sala_lead:', res.error);
        return cb(null);
      }
      var d = res.data;
      if (d && d.ok) {
        cb(d);
      } else {
        console.error('[AlinhaPro Widget] rpc_criar_sala_lead:', d);
        cb(null);
      }
    });
  }

  /* ─── Enviar mensagem ─── */
  function enviarMsg(texto, cb) {
    if (!sb || !salaId) return;
    sb.from('mensagens').insert({
      sala_id: salaId,
      autor: leadNome || 'Visitante',
      conteudo: texto
    }).select('*').single().then(function (res) {
      if (res.error) {
        console.error('[AlinhaPro Widget] enviar:', res.error);
      }
      if (cb) cb(res.data);
    });
  }

  /* ─── Carregar mensagens existentes ─── */
  function carregarMsgs(cb) {
    if (!sb || !salaId) return cb([]);
    sb.from('mensagens')
      .select('*')
      .eq('sala_id', salaId)
      .order('enviada_em', { ascending: true })
      .then(function (res) {
        cb(res.data || []);
      });
  }

  /* ─── Buscar mensagem offline do servidor ─── */
  function buscarMsgOffline(cb) {
    if (!sb) return cb('');
    sb.rpc('rpc_config_publica', { p_chave: 'mensagem_offline' })
      .then(function (res) {
        cb(res.data || '');
      });
  }

  /* ─── Render mensagem no DOM ─── */
  function renderMsg(msg, container) {
    var isMe = msg.autor === (leadNome || 'Visitante');
    var div = document.createElement('div');
    div.className = 'ap-msg ' + (isMe ? 'ap-msg--sent' : 'ap-msg--received');
    div.dataset.msgId = msg.id || '';

    var html = '';
    if (!isMe) {
      html += '<div class="ap-msg__author">' + esc(msg.autor) + '</div>';
    }
    html += '<div>' + esc(msg.conteudo) + '</div>';
    html += '<div class="ap-msg__time">' + fmtTime(msg.enviada_em) + '</div>';
    div.innerHTML = html;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function renderSystemMsg(texto, container) {
    var div = document.createElement('div');
    div.className = 'ap-msg ap-msg--system';
    div.textContent = texto;
    container.appendChild(div);
  }

  /* ─── Ouvir novas mensagens (Realtime) ─── */
  function ouvirMsgs() {
    if (!sb || !salaId || channel) return;
    channel = sb
      .channel('widget-chat-' + salaId)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'mensagens', filter: 'sala_id=eq.' + salaId },
        function (payload) {
          var msg = payload.new;
          if (!msg) return;
          var container = shadowRoot.getElementById('apMsgs');
          if (!container) return;
          var isMe = msg.autor === (leadNome || 'Visitante');
          if (isMe) return; // já renderizou otimisticamente
          renderMsg(msg, container);
          if (!isOpen) {
            unreadCount++;
            atualizarBadgeUnread();
          }
          playNotificationSound();
        }
      )
      .subscribe();
  }

  /* ─── Som de notificação (sutil) ─── */
  function playNotificationSound() {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) { /* sem som, sem problema */ }
  }

  /* ─── Badge de não lidas ─── */
  function atualizarBadgeUnread() {
    var fab = shadowRoot.querySelector('.ap-fab__inner');
    if (!fab) return;
    var existing = fab.querySelector('.ap-fab__unread');
    if (existing) existing.remove();
    if (unreadCount > 0) {
      var b = document.createElement('span');
      b.className = 'ap-fab__unread';
      b.textContent = unreadCount > 9 ? '9+' : unreadCount;
      fab.appendChild(b);
    }
  }

  /* ─── Textarea autosize ─── */
  function autosize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 80) + 'px';
  }

  /* ─── Inicialização principal ─── */
  function init() {
    // Checar se já tem wrapper (evitar duplicação)
    if (document.getElementById('alinhapro-widget-host')) return;

    var host = document.createElement('div');
    host.id = 'alinhapro-widget-host';
    host.style.cssText = 'position:fixed;z-index:999999;pointer-events:none;top:0;left:0;width:0;height:0';
    document.body.appendChild(host);

    shadowRoot = host.attachShadow({ mode: 'open' });

    var style = document.createElement('style');
    style.textContent = getCSS();
    shadowRoot.appendChild(style);

    var fab = createFAB();
    fab.style.pointerEvents = 'auto';
    shadowRoot.appendChild(fab);

    var win = createWindow();
    win.style.pointerEvents = 'auto';
    shadowRoot.appendChild(win);

    // Recuperar dados do localStorage
    var savedSalaId = lsGet('sala_id');
    var savedNome = lsGet('nome');
    var savedContato = lsGet('contato');

    if (savedSalaId && savedContato) {
      formSubmitted = true;
      salaId = savedSalaId;
      leadNome = savedNome || 'Visitante';
      leadContato = savedContato;
    }

    /* ─── Elementos ─── */
    var form = shadowRoot.getElementById('apForm');
    var msgs = shadowRoot.getElementById('apMsgs');
    var compose = shadowRoot.getElementById('apCompose');
    var inputNome = shadowRoot.getElementById('apNome');
    var inputContato = shadowRoot.getElementById('apContato');
    var contatoError = shadowRoot.getElementById('apContatoError');
    var formBtn = shadowRoot.getElementById('apFormBtn');
    var inputMsg = shadowRoot.getElementById('apInput');
    var sendBtn = shadowRoot.getElementById('apSendBtn');
    var closeBtn = shadowRoot.querySelector('.ap-header__close');

    /* ─── Abrir/fechar ─── */
    function toggleOpen() {
      isOpen = !isOpen;
      if (isOpen) {
        win.classList.add('ap-window--open');
        unreadCount = 0;
        atualizarBadgeUnread();
        if (formSubmitted) {
          showChat();
        }
      } else {
        win.classList.remove('ap-window--open');
      }
    }

    fab.addEventListener('click', function () {
      if (!isOpen && !formSubmitted) {
        carregarSupabase(function () {
          initSupabase();
          toggleOpen();
        });
      } else {
        toggleOpen();
      }
    });

    closeBtn.addEventListener('click', function () {
      if (isOpen) toggleOpen();
    });

    /* ─── Formulário pré-chat ─── */
    function submitForm() {
      var nome = inputNome.value.trim();
      var contato = inputContato.value.trim();
      var err = validarContato(contato);
      if (err) {
        contatoError.textContent = err;
        contatoError.style.display = 'block';
        inputContato.classList.add('ap-form__input--error');
        return;
      }
      contatoError.style.display = 'none';
      inputContato.classList.remove('ap-form__input--error');

      formBtn.disabled = true;
      formBtn.textContent = 'Conectando...';

      leadNome = nome || 'Visitante';
      leadContato = contato;

      criarSalaLead(nome, contato, function (data) {
        formBtn.disabled = false;
        formBtn.textContent = 'Iniciar conversa';
        if (!data) {
          contatoError.textContent = 'Erro ao conectar. Tente novamente.';
          contatoError.style.display = 'block';
          return;
        }
        salaId = data.sala_id;
        formSubmitted = true;

        lsSet('sala_id', salaId);
        lsSet('nome', leadNome);
        lsSet('contato', leadContato);

        showChat();

        enviarMsgBoasVindas();
      });
    }

    formBtn.addEventListener('click', submitForm);
    inputContato.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submitForm(); }
    });
    inputNome.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); inputContato.focus(); }
    });

    /* ─── Mostrar chat (transição do formulário) ─── */
    function showChat() {
      form.style.display = 'none';
      msgs.style.display = 'flex';
      compose.style.display = 'flex';

      if (!sb) {
        carregarSupabase(function () {
          initSupabase();
          loadAndListen();
        });
      } else {
        loadAndListen();
      }
    }

    function loadAndListen() {
      carregarMsgs(function (list) {
        msgs.innerHTML = '';
        if (list.length === 0) {
          renderSystemMsg('Conversa iniciada. Aguardando resposta...', msgs);
        } else {
          list.forEach(function (m) { renderMsg(m, msgs); });
        }
        msgs.scrollTop = msgs.scrollHeight;
      });
      ouvirMsgs();
    }

    /* ─── Enviar boas vindas automática (primeira mensagem do sistema) ─── */
    function enviarMsgBoasVindas() {
      buscarMsgOffline(function (offlineMsg) {
        // Não envia — é o consultor que responde. Mas registra a mensagem offline se ele não estiver online.
        // Por ora, a mensagem de boas-vindas é exibida localmente.
        if (offlineMsg) {
          var container = shadowRoot.getElementById('apMsgs');
          renderSystemMsg(offlineMsg, container);
        }
      });
    }

    /* ─── Composição e envio ─── */
    inputMsg.addEventListener('input', function () {
      autosize(inputMsg);
      sendBtn.disabled = !inputMsg.value.trim();
    });

    inputMsg.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        doSend();
      }
    });

    sendBtn.addEventListener('click', doSend);

    function doSend() {
      var texto = inputMsg.value.trim();
      if (!texto || !salaId) return;

      sendBtn.disabled = true;
      inputMsg.value = '';
      autosize(inputMsg);

      // Render otimista
      var container = shadowRoot.getElementById('apMsgs');
      var optMsg = {
        id: 'temp-' + Date.now(),
        autor: leadNome || 'Visitante',
        conteudo: texto,
        enviada_em: new Date().toISOString()
      };
      renderMsg(optMsg, container);

      enviarMsg(texto, function (data) {
        // Atualiza o id temporário se quiser. Por simplicidade, não atualizamos.
      });
    }

    /* ─── Se já tinha sessão, preenche o formulário ─── */
    if (savedNome) inputNome.value = savedNome;
    if (savedContato) inputContato.value = savedContato;
  }

  /* ─── Boot ─── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
