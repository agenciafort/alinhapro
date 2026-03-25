/**
 * AlinhaPro — Módulo de Notificações Push
 * Gerencia registro/remoção do Service Worker e subscrição push.
 *
 * Depende de: sb (supabase client), getAuthToken() de auth.js
 */

const PUSH_VAPID_KEY = (function () {
  var el = document.querySelector('meta[name="vapid-key"]');
  return el ? el.content : '';
})();

let pushRegistration = null;
let pushSubscription = null;

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && !!PUSH_VAPID_KEY;
}

async function pushInit() {
  if (!pushSupported()) return;
  try {
    pushRegistration = await navigator.serviceWorker.register('/sw-push.js');
    pushSubscription = await pushRegistration.pushManager.getSubscription();
  } catch (err) {
    console.warn('[Push] Init error:', err);
  }
}

function pushIsSubscribed() {
  return !!pushSubscription;
}

async function pushSubscribe() {
  if (!pushSupported() || !pushRegistration) return false;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      showToast('Permissão de notificação negada. Ative nas configurações do navegador.');
      return false;
    }

    pushSubscription = await pushRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(PUSH_VAPID_KEY)
    });

    const keys = pushSubscription.toJSON().keys;
    const token = getAuthToken();
    if (!token) return false;

    const { data, error } = await sb.rpc('rpc_registrar_push', {
      p_token: token,
      p_endpoint: pushSubscription.endpoint,
      p_p256dh: keys.p256dh,
      p_auth: keys.auth,
      p_user_agent: navigator.userAgent || ''
    });

    if (error) {
      console.error('[Push] Register error:', error);
      return false;
    }

    return true;

  } catch (err) {
    console.error('[Push] Subscribe error:', err);
    showToast('Erro ao ativar notificações: ' + err.message);
    return false;
  }
}

async function pushUnsubscribe() {
  if (!pushSubscription) return true;

  try {
    const endpoint = pushSubscription.endpoint;
    await pushSubscription.unsubscribe();
    pushSubscription = null;

    const token = getAuthToken();
    if (token) {
      await sb.rpc('rpc_remover_push', { p_token: token, p_endpoint: endpoint });
    }

    return true;
  } catch (err) {
    console.error('[Push] Unsubscribe error:', err);
    return false;
  }
}

function urlBase64ToUint8Array(base64String) {
  var padding = '='.repeat((4 - base64String.length % 4) % 4);
  var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  var rawData = window.atob(base64);
  var outputArray = new Uint8Array(rawData.length);
  for (var i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
