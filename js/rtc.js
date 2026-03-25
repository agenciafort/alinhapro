/**
 * AlinhaPro — Módulo WebRTC
 * Compartilhamento de tela, áudio bidirecional e câmera.
 * Sinalização via Supabase Realtime Broadcast.
 *
 * Depende de: sb (supabase client global), salaIdGlobal, isAdmin, showToast
 */

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

const rtcState = {
  pc: null,
  signalingChannel: null,
  localStream: null,
  screenStream: null,
  remoteStream: null,
  isScreenSharing: false,
  isAudioOn: false,
  isVideoOn: false,
  isConnected: false,
  reconnectTimer: null,
  reconnectAttempts: 0,
  maxReconnectAttempts: 10,
  role: null,
  onStatusChange: null,
  onRemoteStream: null,
};

function rtcLog(msg) {
  console.log('[RTC]', msg);
}

function rtcSupported() {
  return !!(window.RTCPeerConnection && navigator.mediaDevices);
}

function rtcScreenShareSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
}

/* ─── Sinalização via Supabase Broadcast ─── */
function rtcInitSignaling(salaId) {
  if (rtcState.signalingChannel) return;

  rtcState.signalingChannel = sb
    .channel('rtc-' + salaId, { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'rtc-signal' }, (payload) => {
      const data = payload.payload;
      if (!data || !data.type) return;
      handleSignal(data);
    })
    .subscribe();
}

function rtcSendSignal(data) {
  if (!rtcState.signalingChannel) return;
  rtcState.signalingChannel.send({
    type: 'broadcast',
    event: 'rtc-signal',
    payload: data
  });
}

/* ─── Garantir PeerConnection (reutiliza se existir) ─── */
function rtcEnsurePC() {
  if (rtcState.pc && rtcState.pc.signalingState !== 'closed') {
    return rtcState.pc;
  }

  const pc = new RTCPeerConnection(RTC_CONFIG);
  rtcState.pc = pc;

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      rtcSendSignal({ type: 'ice-candidate', candidate: e.candidate });
    }
  };

  pc.oniceconnectionstatechange = () => {
    rtcLog('ICE state: ' + pc.iceConnectionState);
    const state = pc.iceConnectionState;

    if (state === 'connected' || state === 'completed') {
      rtcState.isConnected = true;
      rtcState.reconnectAttempts = 0;
      clearReconnectTimer();
      rtcNotifyStatus('connected');
    } else if (state === 'disconnected') {
      rtcNotifyStatus('reconnecting');
      scheduleReconnect();
    } else if (state === 'failed') {
      rtcNotifyStatus('failed');
      attemptICERestart();
    } else if (state === 'closed') {
      rtcState.isConnected = false;
      rtcNotifyStatus('closed');
    }
  };

  pc.ontrack = (e) => {
    rtcLog('Remote track received: ' + e.track.kind);
    if (!rtcState.remoteStream) {
      rtcState.remoteStream = new MediaStream();
    }
    rtcState.remoteStream.addTrack(e.track);
    if (rtcState.onRemoteStream) {
      rtcState.onRemoteStream(rtcState.remoteStream);
    }
  };

  pc.onnegotiationneeded = async () => {
    if (rtcState.role !== 'presenter') return;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      rtcSendSignal({ type: 'offer', sdp: pc.localDescription });
    } catch (err) {
      rtcLog('Negotiation error: ' + err.message);
    }
  };

  return pc;
}

/* ─── Reconexão automática ─── */
function clearReconnectTimer() {
  if (rtcState.reconnectTimer) {
    clearTimeout(rtcState.reconnectTimer);
    rtcState.reconnectTimer = null;
  }
}

function scheduleReconnect() {
  clearReconnectTimer();
  if (rtcState.reconnectAttempts >= rtcState.maxReconnectAttempts) {
    rtcLog('Max reconnect attempts reached');
    rtcNotifyStatus('failed');
    return;
  }
  const delay = Math.min(3000 * Math.pow(1.5, rtcState.reconnectAttempts), 15000);
  rtcState.reconnectTimer = setTimeout(() => {
    rtcState.reconnectAttempts++;
    attemptICERestart();
  }, delay);
}

function attemptICERestart() {
  if (!rtcState.pc || rtcState.pc.signalingState === 'closed') return;
  rtcLog('ICE restart attempt #' + rtcState.reconnectAttempts);
  rtcState.pc.restartIce();
  if (rtcState.role === 'presenter') {
    rtcState.pc.createOffer({ iceRestart: true })
      .then(offer => rtcState.pc.setLocalDescription(offer))
      .then(() => {
        rtcSendSignal({ type: 'offer', sdp: rtcState.pc.localDescription });
      })
      .catch(err => rtcLog('ICE restart error: ' + err.message));
  }
}

function rtcNotifyStatus(status) {
  if (rtcState.onStatusChange) rtcState.onStatusChange(status);
}

/* ─── Processar sinais recebidos ─── */
async function handleSignal(data) {
  try {
    if (data.type === 'offer') {
      rtcLog('Received offer');
      const pc = rtcEnsurePC();
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      rtcSendSignal({ type: 'answer', sdp: pc.localDescription });
    }

    else if (data.type === 'answer') {
      rtcLog('Received answer');
      if (rtcState.pc) {
        await rtcState.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      }
    }

    else if (data.type === 'ice-candidate') {
      if (rtcState.pc && data.candidate) {
        await rtcState.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    }

    else if (data.type === 'media-status') {
      rtcNotifyStatus('media-status-' + JSON.stringify(data.status));
    }

    else if (data.type === 'end-call') {
      rtcLog('Remote ended call');
      rtcStopAll();
      rtcNotifyStatus('remote-ended');
    }
  } catch (err) {
    rtcLog('Signal error: ' + err.message);
  }
}

/* ─── Compartilhar tela ─── */
async function rtcStartScreenShare() {
  if (!rtcScreenShareSupported()) {
    showToast('Compartilhamento de tela não suportado neste navegador');
    return false;
  }

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        cursor: 'always',
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30, max: 30 }
      },
      audio: false
    });

    rtcState.screenStream = stream;
    rtcState.isScreenSharing = true;
    rtcState.role = 'presenter';

    stream.getVideoTracks()[0].onended = () => {
      rtcStopScreenShare();
    };

    const pc = rtcEnsurePC();
    stream.getTracks().forEach(track => {
      pc.addTrack(track, stream);
    });

    rtcSendSignal({ type: 'media-status', status: { screen: true, audio: rtcState.isAudioOn, video: rtcState.isVideoOn } });
    rtcNotifyStatus('screen-sharing');
    return true;

  } catch (err) {
    if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
      showToast('Compartilhamento cancelado');
    } else {
      showToast('Erro ao compartilhar tela: ' + err.message);
      console.error('[RTC] Screen share error:', err);
    }
    return false;
  }
}

function rtcStopScreenShare() {
  if (rtcState.screenStream) {
    rtcState.screenStream.getTracks().forEach(t => {
      if (rtcState.pc) {
        const senders = rtcState.pc.getSenders();
        const sender = senders.find(s => s.track === t);
        if (sender) rtcState.pc.removeTrack(sender);
      }
      t.stop();
    });
    rtcState.screenStream = null;
  }
  rtcState.isScreenSharing = false;

  if (!rtcState.isAudioOn && !rtcState.isVideoOn) {
    rtcEndCall();
  }

  rtcSendSignal({ type: 'media-status', status: { screen: false, audio: rtcState.isAudioOn, video: rtcState.isVideoOn } });
  rtcNotifyStatus('screen-stopped');
}

/* ─── Áudio bidirecional ─── */
async function rtcToggleAudio() {
  if (rtcState.isAudioOn) {
    rtcStopAudio();
    return false;
  }
  return await rtcStartAudio();
}

async function rtcStartAudio() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    if (!rtcState.localStream) {
      rtcState.localStream = new MediaStream();
    }
    stream.getAudioTracks().forEach(t => rtcState.localStream.addTrack(t));

    rtcState.isAudioOn = true;
    rtcState.role = rtcState.role || 'presenter';

    const pc = rtcEnsurePC();
    stream.getAudioTracks().forEach(track => {
      pc.addTrack(track, rtcState.localStream);
    });

    rtcSendSignal({ type: 'media-status', status: { screen: rtcState.isScreenSharing, audio: true, video: rtcState.isVideoOn } });
    rtcNotifyStatus('audio-on');
    return true;

  } catch (err) {
    if (err.name === 'NotAllowedError') {
      showToast('Permita o microfone nas configurações do navegador');
    } else {
      showToast('Erro ao acessar microfone: ' + err.message);
    }
    return false;
  }
}

function rtcStopAudio() {
  if (rtcState.localStream) {
    rtcState.localStream.getAudioTracks().forEach(t => {
      if (rtcState.pc) {
        const senders = rtcState.pc.getSenders();
        const sender = senders.find(s => s.track === t);
        if (sender) rtcState.pc.removeTrack(sender);
      }
      t.stop();
      rtcState.localStream.removeTrack(t);
    });
  }
  rtcState.isAudioOn = false;

  if (!rtcState.isScreenSharing && !rtcState.isVideoOn) {
    rtcEndCall();
  }

  rtcSendSignal({ type: 'media-status', status: { screen: rtcState.isScreenSharing, audio: false, video: rtcState.isVideoOn } });
  rtcNotifyStatus('audio-off');
}

/* ─── Câmera / Vídeo ─── */
async function rtcToggleVideo() {
  if (rtcState.isVideoOn) {
    rtcStopVideo();
    return false;
  }
  return await rtcStartVideo();
}

async function rtcStartVideo() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
      }
    });

    if (!rtcState.localStream) {
      rtcState.localStream = new MediaStream();
    }
    stream.getVideoTracks().forEach(t => rtcState.localStream.addTrack(t));

    rtcState.isVideoOn = true;
    rtcState.role = rtcState.role || 'presenter';

    const pc = rtcEnsurePC();
    stream.getVideoTracks().forEach(track => {
      pc.addTrack(track, rtcState.localStream);
    });

    rtcSendSignal({ type: 'media-status', status: { screen: rtcState.isScreenSharing, audio: rtcState.isAudioOn, video: true } });
    rtcNotifyStatus('video-on');
    return true;

  } catch (err) {
    if (err.name === 'NotAllowedError') {
      showToast('Permita a câmera nas configurações do navegador');
    } else {
      showToast('Erro ao acessar câmera: ' + err.message);
    }
    return false;
  }
}

function rtcStopVideo() {
  if (rtcState.localStream) {
    rtcState.localStream.getVideoTracks().forEach(t => {
      if (rtcState.pc) {
        const senders = rtcState.pc.getSenders();
        const sender = senders.find(s => s.track === t);
        if (sender) rtcState.pc.removeTrack(sender);
      }
      t.stop();
      rtcState.localStream.removeTrack(t);
    });
  }
  rtcState.isVideoOn = false;

  if (!rtcState.isScreenSharing && !rtcState.isAudioOn) {
    rtcEndCall();
  }

  rtcSendSignal({ type: 'media-status', status: { screen: rtcState.isScreenSharing, audio: rtcState.isAudioOn, video: false } });
  rtcNotifyStatus('video-off');
}

/* ─── Encerrar tudo ─── */
function rtcEndCall() {
  rtcSendSignal({ type: 'end-call' });
  rtcStopAll();
}

function rtcStopAll() {
  clearReconnectTimer();

  if (rtcState.screenStream) {
    rtcState.screenStream.getTracks().forEach(t => t.stop());
    rtcState.screenStream = null;
  }

  if (rtcState.localStream) {
    rtcState.localStream.getTracks().forEach(t => t.stop());
    rtcState.localStream = null;
  }

  if (rtcState.pc) {
    rtcState.pc.close();
    rtcState.pc = null;
  }

  rtcState.remoteStream = null;
  rtcState.isScreenSharing = false;
  rtcState.isAudioOn = false;
  rtcState.isVideoOn = false;
  rtcState.isConnected = false;
  rtcState.reconnectAttempts = 0;
  rtcState.role = null;

  rtcNotifyStatus('stopped');
}

/* ─── GRAVAÇÃO DE CHAMADA ─── */

const recState = {
  recorder: null,
  chunks: [],
  isRecording: false,
  startTime: null,
  onRecordingStatus: null
};

function recSupported() {
  return typeof MediaRecorder !== 'undefined';
}

function recStart() {
  if (!recSupported()) {
    showToast('Gravação não suportada neste navegador');
    return false;
  }

  var streams = [];

  if (rtcState.screenStream) {
    rtcState.screenStream.getTracks().forEach(function (t) { streams.push(t); });
  }
  if (rtcState.localStream) {
    rtcState.localStream.getTracks().forEach(function (t) { streams.push(t); });
  }
  if (rtcState.remoteStream) {
    rtcState.remoteStream.getTracks().forEach(function (t) { streams.push(t); });
  }

  if (streams.length === 0) {
    showToast('Nenhuma mídia ativa para gravar');
    return false;
  }

  var combined = new MediaStream(streams);

  var mimeType = 'video/webm;codecs=vp9,opus';
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = 'video/webm;codecs=vp8,opus';
  }
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = 'video/webm';
  }

  try {
    recState.recorder = new MediaRecorder(combined, { mimeType: mimeType });
  } catch (e) {
    showToast('Erro ao iniciar gravação: ' + e.message);
    return false;
  }

  recState.chunks = [];
  recState.isRecording = true;
  recState.startTime = Date.now();

  recState.recorder.ondataavailable = function (e) {
    if (e.data && e.data.size > 0) {
      recState.chunks.push(e.data);
    }
  };

  recState.recorder.onstop = function () {
    recState.isRecording = false;
    if (recState.chunks.length === 0) return;

    var blob = new Blob(recState.chunks, { type: mimeType });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    a.href = url;
    a.download = 'alinhapro-gravacao-' + timestamp + '.webm';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);

    recState.chunks = [];
    showToast('Gravação salva!');

    if (recState.onRecordingStatus) recState.onRecordingStatus(false);
  };

  recState.recorder.onerror = function (e) {
    rtcLog('Recording error: ' + (e.error ? e.error.message : 'unknown'));
    recState.isRecording = false;
    if (recState.onRecordingStatus) recState.onRecordingStatus(false);
  };

  recState.recorder.start(1000);
  if (recState.onRecordingStatus) recState.onRecordingStatus(true);
  return true;
}

function recStop() {
  if (recState.recorder && recState.recorder.state !== 'inactive') {
    recState.recorder.stop();
  }
  recState.isRecording = false;
}

function recGetDuration() {
  if (!recState.isRecording || !recState.startTime) return 0;
  return Math.floor((Date.now() - recState.startTime) / 1000);
}

/* ─── Cleanup ao sair da página ─── */
function rtcCleanup() {
  recStop();
  if (rtcState.signalingChannel) {
    sb.removeChannel(rtcState.signalingChannel);
    rtcState.signalingChannel = null;
  }
  rtcStopAll();
}
