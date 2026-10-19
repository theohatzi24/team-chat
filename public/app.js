// Mitarbeiter App: Frontend
const $ = s => document.querySelector(s);
let token = localStorage.getItem('token');
let me = null;
let tab = 'team';
let es = null;
let lastSeenNews = Number(localStorage.getItem('lastSeenNews') || 0);
const cache = { team: [], news: [] };

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token && !path.includes('/login')) { logout(true); }
  if (!res.ok) throw new Error(data.error || 'Fehler ' + res.status);
  return data;
}

// ---------- Anmeldung ----------
let setupMode = false;
async function showLogin() {
  $('#main').classList.add('hidden');
  $('#login').classList.remove('hidden');
  const { setupNeeded } = await api('/api/status');
  setupMode = setupNeeded;
  $('#loginTitle').textContent = setupNeeded ? 'Einrichtung' : 'Anmelden';
  $('#loginHint').textContent = setupNeeded ? 'Leg dein Chef Konto an. Danach kannst du Mitarbeiter hinzufügen.' : 'Name und PIN bekommst du vom Chef.';
  $('#loginBtn').textContent = setupNeeded ? 'Konto anlegen' : 'Anmelden';
  $('#loginPin').autocomplete = setupNeeded ? 'new-password' : 'current-password';
}

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#loginError').textContent = '';
  try {
    const data = await api(setupMode ? '/api/setup' : '/api/login', { method: 'POST', body: { name: $('#loginName').value, pin: $('#loginPin').value } });
    token = data.token;
    localStorage.setItem('token', token);
    me = data.user;
    $('#loginPin').value = '';
    start();
  } catch (err) { $('#loginError').textContent = err.message; }
});

function logout(silent) {
  if (!silent && token) fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
  token = null; me = null;
  localStorage.removeItem('token');
  if (es) es.close();
  showLogin();
}
$('#logoutBtn').addEventListener('click', () => { if (confirm('Abmelden?')) logout(); });

// ---------- Hauptansicht ----------
async function start() {
  $('#login').classList.add('hidden');
  $('#main').classList.remove('hidden');
  $('#adminTab').classList.toggle('hidden', me.role !== 'admin');
  const [team, news] = await Promise.all([
    api('/api/messages?channel=team'), api('/api/messages?channel=news'),
  ]);
  cache.team = team.messages; cache.news = news.messages;
  connectStream();
  switchTab(tab);
  askNotify();
}

function connectStream() {
  if (es) es.close();
  es = new EventSource('/api/stream?token=' + encodeURIComponent(token));
  es.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (cache[m.channel].some(x => x.id === m.id)) return;
    cache[m.channel].push(m);
    if (m.channel === tab) render(); else updateBadge();
    if (m.userId !== me.id) notify(m);
  });
  es.addEventListener('delete', e => {
    const { id } = JSON.parse(e.data);
    for (const c of Object.keys(cache)) cache[c] = cache[c].filter(x => x.id !== id);
    render();
  });
}

function switchTab(t) {
  tab = t;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  const isAdmin = t === 'admin';
  $('#messages').classList.toggle('hidden', isAdmin);
  $('#adminPanel').classList.toggle('hidden', !isAdmin);
  $('#messages').classList.toggle('news', t === 'news');
  const canPost = t === 'team' || (t === 'news' && me.role === 'admin');
  $('#composer').classList.toggle('hidden', isAdmin || !canPost);
  $('#readonlyHint').classList.toggle('hidden', isAdmin || canPost);
  $('#text').placeholder = t === 'news' ? 'Ankündigung an alle…' : 'Nachricht schreiben…';
  if (isAdmin) loadUsers(); else render();
}
document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

const fmtTime = ts => new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const fmtDay = ts => new Date(ts).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' });
const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function render() {
  if (tab === 'admin') return;
  const list = cache[tab];
  const box = $('#messages');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  if (!list.length) {
    box.innerHTML = `<p class="empty">${tab === 'news' ? 'Noch keine Ankündigungen.' : 'Noch keine Nachrichten. Schreib die erste!'}</p>`;
  } else {
    let html = '', lastDay = '';
    for (const m of list) {
      const day = fmtDay(m.ts);
      if (day !== lastDay) { html += `<div class="day">${day}</div>`; lastDay = day; }
      const mine = m.userId === me.id;
      const canDel = mine || me.role === 'admin';
      html += `<div class="msg ${mine && tab === 'team' ? 'mine' : ''}">
        ${!mine || tab === 'news' ? `<div class="who">${esc(m.name)}</div>` : ''}
        <div class="txt">${esc(m.text)}</div>
        <div class="meta">${fmtTime(m.ts)}${canDel ? `<button class="del" data-id="${m.id}">löschen</button>` : ''}</div>
      </div>`;
    }
    box.innerHTML = html;
  }
  if (atBottom || box.dataset.tab !== tab) box.scrollTop = box.scrollHeight;
  box.dataset.tab = tab;
  if (tab === 'news') { lastSeenNews = Date.now(); localStorage.setItem('lastSeenNews', lastSeenNews); }
  updateBadge();
}

$('#messages').addEventListener('click', async e => {
  const id = e.target.dataset.id;
  if (!id || !confirm('Nachricht löschen?')) return;
  try { await api('/api/messages/' + id, { method: 'DELETE' }); } catch (err) { alert(err.message); }
});

function updateBadge() {
  const n = cache.news.filter(m => m.ts > lastSeenNews && m.userId !== me.id).length;
  $('#newsBadge').textContent = n;
  $('#newsBadge').classList.toggle('hidden', !n || tab === 'news');
}

// ---------- Senden ----------
const textEl = $('#text');
textEl.addEventListener('input', () => { textEl.style.height = 'auto'; textEl.style.height = textEl.scrollHeight + 'px'; });
textEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); $('#composer').requestSubmit(); }
});
$('#composer').addEventListener('submit', async e => {
  e.preventDefault();
  const text = textEl.value.trim();
  if (!text) return;
  textEl.value = ''; textEl.style.height = 'auto';
  try {
    const { message } = await api('/api/messages', { method: 'POST', body: { channel: tab, text } });
    if (!cache[tab].some(x => x.id === message.id)) cache[tab].push(message);
    const box = $('#messages'); render(); box.scrollTop = box.scrollHeight;
  } catch (err) { alert(err.message); textEl.value = text; }
});

// ---------- Mitarbeiter verwalten ----------
async function loadUsers() {
  const { users } = await api('/api/users');
  $('#userList').innerHTML = users.map(u => `<li>
    <span>${esc(u.name)}${u.role === 'admin' ? ' ⭐' : ''}</span>
    <button data-pin="${u.id}">PIN neu</button>
    ${u.id !== me.id ? `<button data-remove="${u.id}">Entfernen</button>` : ''}
  </li>`).join('');
}
$('#userList').addEventListener('click', async e => {
  const { pin, remove } = e.target.dataset;
  try {
    if (pin) {
      const p = prompt('Neue PIN (4 bis 8 Ziffern):');
      if (p) { await api(`/api/users/${pin}/pin`, { method: 'POST', body: { pin: p } }); alert('PIN geändert.'); }
    }
    if (remove && confirm('Mitarbeiter entfernen?')) { await api('/api/users/' + remove, { method: 'DELETE' }); loadUsers(); }
  } catch (err) { alert(err.message); }
});
$('#addUserForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#adminError').textContent = '';
  try {
    await api('/api/users', { method: 'POST', body: { name: $('#newName').value, pin: $('#newPin').value, role: $('#newAdmin').checked ? 'admin' : 'staff' } });
    e.target.reset();
    loadUsers();
  } catch (err) { $('#adminError').textContent = err.message; }
});

// ---------- Benachrichtigungen (solange die App im Hintergrund offen ist) ----------
function askNotify() {
  if ('Notification' in window && Notification.permission === 'default') {
    document.addEventListener('click', () => Notification.requestPermission(), { once: true });
  }
}
async function notify(m) {
  if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  const title = m.channel === 'news' ? '📢 Ankündigung von ' + m.name : m.name;
  const reg = await navigator.serviceWorker?.getRegistration();
  if (reg) reg.showNotification(title, { body: m.text, icon: 'icon-192.png', tag: m.channel });
  else new Notification(title, { body: m.text });
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && token && es && es.readyState === 2) start();
});

// ---------- Start ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
(async () => {
  if (token) {
    try { me = (await api('/api/me')).user; return start(); } catch { /* weiter zum Login */ }
  }
  showLogin();
})();
