const SUPABASE_URL = 'https://fsrydwoacouogujvmdsf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Hwg8d69cRDqy6XBEfXljIQ_HZXN9qzs';

// Não usar o nome "supabase" — o CDN já expõe window.supabase (namespace com createClient)
const { createClient } = window.supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

function showToast(msg) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function formatTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
