// Mitarbeiter App: kleiner Server ohne externe Abhängigkeiten (nur Node.js >= 18)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const CHANNELS = ['team', 'news'];
const MAX_TEXT = 2000;

// ---------- Speicher ----------
let db = { users: [], messages: [], sessions: {} };
if (fs.existsSync(DATA_FILE)) db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(db, null, 1));
    fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
  }, 200);
}

// ---------- Hilfsfunktionen ----------
const id = () => crypto.randomBytes(8).toString('hex');
function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 32).toString('hex');
}
function publicUser(u) {
  return { id: u.id, name: u.name, role: u.role };
}
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
  });
}
function auth(req, url) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('token');
  const userId = token && db.sessions[token];
  return userId ? db.users.find(u => u.id === userId) : null;
}
const validPin = pin => /^\d{4,8}$/.test(String(pin || ''));
const cleanName = name => String(name || '').trim().slice(0, 40);

// Schutz gegen PIN Raten: max. 5 Fehlversuche pro Name in 10 Minuten
const failed = new Map();
function tooManyFails(key) {
  const now = Date.now();
  const list = (failed.get(key) || []).filter(t => now - t < 10 * 60 * 1000);
  failed.set(key, list);
  return list.length >= 5;
}

// ---------- Live Updates (Server Sent Events) ----------
const clients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(msg);
}
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 25000);

// ---------- API ----------
async function api(req, res, url) {
  const p = url.pathname;
  const m = req.method;

  if (p === '/api/status' && m === 'GET') {
    return send(res, 200, { setupNeeded: db.users.length === 0 });
  }

  // Erster Start: Chef Konto anlegen
  if (p === '/api/setup' && m === 'POST') {
    if (db.users.length) return send(res, 403, { error: 'Einrichtung ist schon erledigt.' });
    const { name, pin } = await readBody(req);
    if (!cleanName(name) || !validPin(pin)) return send(res, 400, { error: 'Name und PIN (4 bis 8 Ziffern) angeben.' });
    const salt = id();
    const user = { id: id(), name: cleanName(name), role: 'admin', salt, pinHash: hashPin(pin, salt) };
    db.users.push(user);
    const token = crypto.randomBytes(24).toString('hex');
    db.sessions[token] = user.id;
    save();
    return send(res, 200, { token, user: publicUser(user) });
  }

  if (p === '/api/login' && m === 'POST') {
    const { name, pin } = await readBody(req);
    const key = cleanName(name).toLowerCase();
    if (tooManyFails(key)) return send(res, 429, { error: 'Zu viele Fehlversuche. Bitte 10 Minuten warten.' });
    const user = db.users.find(u => u.name.toLowerCase() === key);
    if (!user || hashPin(pin, user.salt) !== user.pinHash) {
      failed.get(key).push(Date.now());
      return send(res, 401, { error: 'Name oder PIN falsch.' });
    }
    const token = crypto.randomBytes(24).toString('hex');
    db.sessions[token] = user.id;
    save();
    return send(res, 200, { token, user: publicUser(user) });
  }

  const user = auth(req, url);
  if (!user) return send(res, 401, { error: 'Bitte neu anmelden.' });

  if (p === '/api/me' && m === 'GET') return send(res, 200, { user: publicUser(user) });

  if (p === '/api/logout' && m === 'POST') {
    const token = (req.headers.authorization || '').slice(7);
    delete db.sessions[token];
    save();
    return send(res, 200, { ok: true });
  }

  if (p === '/api/stream' && m === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': ok\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (p === '/api/messages' && m === 'GET') {
    const channel = url.searchParams.get('channel');
    if (!CHANNELS.includes(channel)) return send(res, 400, { error: 'Unbekannter Kanal.' });
    const list = db.messages.filter(x => x.channel === channel).slice(-200);
    return send(res, 200, { messages: list });
  }

  if (p === '/api/messages' && m === 'POST') {
    const { channel, text } = await readBody(req);
    if (!CHANNELS.includes(channel)) return send(res, 400, { error: 'Unbekannter Kanal.' });
    if (channel === 'news' && user.role !== 'admin') return send(res, 403, { error: 'Nur der Chef darf Ankündigungen posten.' });
    const t = String(text || '').trim().slice(0, MAX_TEXT);
    if (!t) return send(res, 400, { error: 'Leere Nachricht.' });
    const msg = { id: id(), channel, userId: user.id, name: user.name, text: t, ts: Date.now() };
    db.messages.push(msg);
    save();
    broadcast('message', msg);
    return send(res, 200, { message: msg });
  }

  const delMsg = p.match(/^\/api\/messages\/([a-f0-9]+)$/);
  if (delMsg && m === 'DELETE') {
    const msg = db.messages.find(x => x.id === delMsg[1]);
    if (!msg) return send(res, 404, { error: 'Nicht gefunden.' });
    if (msg.userId !== user.id && user.role !== 'admin') return send(res, 403, { error: 'Keine Berechtigung.' });
    db.messages = db.messages.filter(x => x.id !== msg.id);
    save();
    broadcast('delete', { id: msg.id });
    return send(res, 200, { ok: true });
  }

  // ----- Mitarbeiter verwalten (nur Chef) -----
  if (p.startsWith('/api/users')) {
    if (user.role !== 'admin') return send(res, 403, { error: 'Nur für den Chef.' });

    if (p === '/api/users' && m === 'GET') return send(res, 200, { users: db.users.map(publicUser) });

    if (p === '/api/users' && m === 'POST') {
      const { name, pin, role } = await readBody(req);
      const n = cleanName(name);
      if (!n || !validPin(pin)) return send(res, 400, { error: 'Name und PIN (4 bis 8 Ziffern) angeben.' });
      if (db.users.some(u => u.name.toLowerCase() === n.toLowerCase())) return send(res, 409, { error: 'Diesen Namen gibt es schon.' });
      const salt = id();
      const nu = { id: id(), name: n, role: role === 'admin' ? 'admin' : 'staff', salt, pinHash: hashPin(pin, salt) };
      db.users.push(nu);
      save();
      return send(res, 200, { user: publicUser(nu) });
    }

    const one = p.match(/^\/api\/users\/([a-f0-9]+)$/);
    if (one && m === 'DELETE') {
      if (one[1] === user.id) return send(res, 400, { error: 'Du kannst dich nicht selbst löschen.' });
      db.users = db.users.filter(u => u.id !== one[1]);
      for (const [t, uid] of Object.entries(db.sessions)) if (uid === one[1]) delete db.sessions[t];
      save();
      return send(res, 200, { ok: true });
    }

    const pinReset = p.match(/^\/api\/users\/([a-f0-9]+)\/pin$/);
    if (pinReset && m === 'POST') {
      const { pin } = await readBody(req);
      const target = db.users.find(u => u.id === pinReset[1]);
      if (!target) return send(res, 404, { error: 'Nicht gefunden.' });
      if (!validPin(pin)) return send(res, 400, { error: 'PIN muss 4 bis 8 Ziffern haben.' });
      target.salt = id();
      target.pinHash = hashPin(pin, target.salt);
      for (const [t, uid] of Object.entries(db.sessions)) if (uid === target.id) delete db.sessions[t];
      save();
      return send(res, 200, { ok: true });
    }
  }

  send(res, 404, { error: 'Nicht gefunden.' });
}

// ---------- Statische Dateien ----------
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
};
function serveStatic(req, res, url) {
  let file = path.normalize(path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Nicht gefunden'); }
    const headers = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' };
    if (file.endsWith('sw.js')) headers['Cache-Control'] = 'no-cache';
    res.writeHead(200, headers);
    res.end(data);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: 'Serverfehler.' });
  }
}).listen(PORT, () => console.log(`Mitarbeiter App läuft auf http://localhost:${PORT}`));
