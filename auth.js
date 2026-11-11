const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Login, sessions and user management. Every route is denied by default:
// install() runs before all other routes and static files, and only the
// login page and its own assets are reachable without a session.
//
// Users and sessions live as JSON files in MNV_DATA_DIR, which must be
// outside public/ and outside git (a Docker volume in production).
//   users.json    — { users: [{ id, email, hash, ... }] }, scrypt hashes
//   sessions.json — { sessions: { <sha256 of token>: {...} } }
//
// A new data directory gets the built-in admin from ADMIN_INITIAL_PASSWORD
// or, failing that, from config/admin-seed.json (a scrypt hash, gitignored;
// see scripts/auth-tool.js). With neither, nobody can log in.

const ADMIN_EMAIL = 'admin@marcknet.net';
const DATA_DIR = process.env.MNV_DATA_DIR || path.join(os.homedir(), '.marcknetvision');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const SEED_FILE = path.join(__dirname, 'config', 'admin-seed.json');
const PAGES_DIR = path.join(__dirname, 'pages');

// A session ends after this long with no requests; an active one never
// does. Dashboard tabs poll in the background, so an open tab is active.
const SESSION_IDLE_MS = (Number(process.env.SESSION_IDLE_HOURS) || 24) * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = Math.min(5 * 60 * 1000, SESSION_IDLE_MS / 4);   // how often lastSeen is saved

const COOKIE_SECURE = '__Host-mnv_session';
const COOKIE_PLAIN = 'mnv_session';        // plain HTTP (no Secure flag)

const PASSWORD_MIN = 12;
const PASSWORD_MAX = 128;

// OWASP-recommended scrypt cost (about 128 MB per hash).
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, keylen: 32, maxmem: 256 * 1024 * 1024 };

// ── Password hashing ───────────────────────────────────────────────
function formatHash(salt, derived) {
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), derived.toString('base64')].join('$');
}

function hashPasswordSync(password) {
  const salt = crypto.randomBytes(16);
  const { N, r, p, keylen, maxmem } = SCRYPT;
  return formatHash(salt, crypto.scryptSync(password, salt, keylen, { N, r, p, maxmem }));
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const { N, r, p, keylen, maxmem } = SCRYPT;
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, { N, r, p, maxmem }, (err, derived) => {
      if (err) reject(err); else resolve(formatHash(salt, derived));
    });
  });
}

// Cost settings are read from the stored hash, so they can be raised later
// without invalidating existing passwords.
function verifyPassword(password, stored) {
  const [scheme, N, r, p, salt, expected] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !expected) return Promise.resolve(false);
  const want = Buffer.from(expected, 'base64');
  const options = { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem };
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, Buffer.from(salt, 'base64'), want.length, options, (err, derived) => {
      if (err) reject(err); else resolve(crypto.timingSafeEqual(derived, want));
    });
  });
}

// ── Storage ────────────────────────────────────────────────────────
let users = [];
const sessions = new Map();   // sha256(token) → session
let dummyHash = '';           // verified for unknown emails, to even out timing

// Write-then-rename, so a crash can't leave a half-written file.
function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(value, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function saveUsers() { writeJson(USERS_FILE, { users }); }
function saveSessions() { writeJson(SESSIONS_FILE, { sessions: Object.fromEntries(sessions) }); }

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;   // corrupt: stop rather than start over with an empty user list
  }
}

function newUser(email, hash, mustChangePassword) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(), email, hash, mustChangePassword,
    disabled: false, createdAt: now, passwordChangedAt: now, lastLoginAt: null,
  };
}

function initialAdminHash() {
  if (process.env.ADMIN_INITIAL_PASSWORD) return hashPasswordSync(process.env.ADMIN_INITIAL_PASSWORD);
  const seed = readJson(SEED_FILE);
  return seed && seed.passwordHash ? seed.passwordHash : null;
}

function init() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  users = (readJson(USERS_FILE) || {}).users || [];

  if (!users.some(u => u.email === ADMIN_EMAIL)) {
    const hash = initialAdminHash();
    if (hash) {
      users.push(newUser(ADMIN_EMAIL, hash, true));
      saveUsers();
      console.log(`[Auth] Created built-in admin ${ADMIN_EMAIL} (password change required at first login)`);
    } else {
      console.error(`[Auth] No admin account and no ADMIN_INITIAL_PASSWORD or ${SEED_FILE}: nobody can log in.`);
    }
  }
  delete process.env.ADMIN_INITIAL_PASSWORD;

  const saved = (readJson(SESSIONS_FILE) || {}).sessions || {};
  for (const [key, s] of Object.entries(saved)) sessions.set(key, s);
  pruneSessions();
  dummyHash = hashPasswordSync(crypto.randomBytes(16).toString('hex'));
  setInterval(pruneSessions, 60 * 60 * 1000).unref();
  console.log(`[Auth] ${users.length} user(s), data in ${DATA_DIR}`);
}

function pruneSessions() {
  const cutoff = Date.now() - SESSION_IDLE_MS;
  let changed = false;
  for (const [key, s] of sessions) {
    if (s.lastSeen < cutoff) { sessions.delete(key); changed = true; }
  }
  if (changed) saveSessions();
}

// Set a password from the command line (scripts/auth-tool.js). The running
// server keeps users in memory, so it has to be restarted afterwards.
function resetPasswordOnDisk(email, password) {
  const list = (readJson(USERS_FILE) || {}).users || [];
  const user = list.find(u => u.email === normalizeEmail(email));
  if (!user) return false;
  user.hash = hashPasswordSync(password);
  user.passwordChangedAt = new Date().toISOString();
  user.mustChangePassword = true;
  writeJson(USERS_FILE, { users: list });
  return true;
}

// ── Helpers ────────────────────────────────────────────────────────
function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function passwordProblem(password, email) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) {
    return `Password must be at least ${PASSWORD_MIN} characters.`;
  }
  if (password.length > PASSWORD_MAX) return `Password must be at most ${PASSWORD_MAX} characters.`;
  if (password.toLowerCase() === email) return 'Password cannot be your email address.';
  return null;
}

// Only same-site paths, so a crafted ?next= can't send someone elsewhere.
function safeNext(value) {
  if (typeof value !== 'string' || !/^\/(?![/\\])/.test(value) || /[\s\\]/.test(value)) return '/';
  return value.startsWith('/api/') ? '/' : value;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isAdmin(user) {
  return user.email === ADMIN_EMAIL;
}

function publicUser(user) {
  let activeSessions = 0;
  for (const s of sessions.values()) if (s.userId === user.id) activeSessions++;
  const { id, email, disabled, mustChangePassword, createdAt, lastLoginAt } = user;
  return { id, email, disabled, mustChangePassword, createdAt, lastLoginAt, activeSessions, builtIn: isAdmin(user) };
}

// ── Rate limiting ──────────────────────────────────────────────────
// Failed logins, counted per IP, per IP + account, and per account. The
// account limit is the loosest so one address can't lock someone out.
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMITS = { ip: 20, pair: 5, account: 50 };
const failures = new Map();   // key → { count, resetAt }

function rateKeys(req, email) {
  const ip = req.ip;
  const keys = [[`ip|${ip}`, RATE_LIMITS.ip]];
  if (email) keys.push([`pair|${ip}|${email}`, RATE_LIMITS.pair], [`account|${email}`, RATE_LIMITS.account]);
  return keys;
}

function retryAfterSeconds(keys) {
  const now = Date.now();
  let wait = 0;
  for (const [key, limit] of keys) {
    const f = failures.get(key);
    if (f && f.resetAt > now && f.count >= limit) wait = Math.max(wait, f.resetAt - now);
  }
  return Math.ceil(wait / 1000);
}

function recordFailure(keys) {
  const now = Date.now();
  for (const [key] of keys) {
    const f = failures.get(key);
    if (f && f.resetAt > now) f.count++;
    else failures.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
  }
  if (failures.size > 10000) {
    for (const [key, f] of failures) if (f.resetAt <= now) failures.delete(key);
  }
}

// ── Cookies and sessions ───────────────────────────────────────────
function readCookie(req, name) {
  for (const part of (req.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function setSessionCookie(req, res, token) {
  const maxAge = Math.floor(SESSION_IDLE_MS / 1000);
  const name = req.secure ? COOKIE_SECURE : COOKIE_PLAIN;
  res.append('Set-Cookie', `${name}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}`);
}

function clearSessionCookie(req, res) {
  const name = req.secure ? COOKIE_SECURE : COOKIE_PLAIN;
  res.append('Set-Cookie', `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}`);
}

function createSession(req, res, user) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  sessions.set(sha256(token), {
    userId: user.id, passwordChangedAt: user.passwordChangedAt, createdAt: now, lastSeen: now,
  });
  saveSessions();
  setSessionCookie(req, res, token);
}

// Returns { token, key, session, user } for a valid session, else null. A
// session stops working when its user is removed or disabled, when the
// password changes, or after SESSION_IDLE_MS without a request.
function currentSession(req) {
  const token = readCookie(req, req.secure ? COOKIE_SECURE : COOKIE_PLAIN);
  if (!token) return null;
  const key = sha256(token);
  const session = sessions.get(key);
  if (!session) return null;
  const user = users.find(u => u.id === session.userId);
  const valid = user && !user.disabled && session.passwordChangedAt === user.passwordChangedAt &&
    Date.now() - session.lastSeen < SESSION_IDLE_MS;
  if (!valid) {
    sessions.delete(key);
    saveSessions();
    return null;
  }
  return { token, key, session, user };
}

function endUserSessions(userId, exceptKey) {
  let changed = false;
  for (const [key, s] of sessions) {
    if (s.userId === userId && key !== exceptKey) { sessions.delete(key); changed = true; }
  }
  if (changed) saveSessions();
}

// ── Middleware ─────────────────────────────────────────────────────
function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "frame-ancestors 'none'",
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
}

// Anything that changes state must come from this site's own pages.
function checkOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  let sameOrigin = false;
  try {
    sameOrigin = new URL(req.get('origin')).host === req.get('host');
  } catch (e) { /* missing or malformed Origin */ }
  if (!sameOrigin) return res.status(403).json({ error: 'Cross-site request refused.' });
  next();
}

function requireLogin(req, res, next) {
  const current = currentSession(req);
  if (!current) {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
      return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    }
    return res.status(401).json({ error: 'Login required.' });
  }
  // Revalidate on every load, so a logged-out browser can't reuse a copy.
  res.set('Cache-Control', 'private, no-cache');
  if (Date.now() - current.session.lastSeen > TOUCH_INTERVAL_MS) {
    current.session.lastSeen = Date.now();
    saveSessions();
    setSessionCookie(req, res, current.token);
  }
  req.auth = current;
  req.user = current.user;
  next();
}

function requireCurrentPassword(req, res, next) {
  if (!req.user.mustChangePassword) return next();
  if (req.method === 'GET' && !req.path.startsWith('/api/')) return res.redirect('/change-password');
  res.status(403).json({ error: 'Password change required.' });
}

function requireAdmin(req, res, next) {
  if (isAdmin(req.user)) return next();
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  res.status(403).type('text').send('Admin access required.');
}

// The auth pages use no inline code, so they can have a strict policy.
function sendPage(res, file) {
  res.set({
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; " +
      "connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
  });
  res.sendFile(path.join(PAGES_DIR, file));
}

// ── Routes ─────────────────────────────────────────────────────────
function adminRouter() {
  const router = express.Router();
  const target = (req, res) => {
    const user = users.find(u => u.id === req.params.id);
    if (!user) res.status(404).json({ error: 'User not found.' });
    return user;
  };
  const audit = (req, action, email) => console.log(`[Auth] ${req.user.email} ${action} ${email}`);

  router.get('/users', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ users: users.map(publicUser) });
  });

  router.post('/users', async (req, res) => {
    const { email: rawEmail, password, requireChange } = req.body || {};
    const email = normalizeEmail(rawEmail);
    if (!email) return res.status(400).json({ error: 'Enter a valid email address.' });
    const problem = passwordProblem(password, email);
    if (problem) return res.status(400).json({ error: problem });
    const hash = await hashPassword(password);
    if (users.some(u => u.email === email)) return res.status(409).json({ error: 'That user already exists.' });
    const user = newUser(email, hash, requireChange !== false);
    users.push(user);
    saveUsers();
    audit(req, 'created user', email);
    res.status(201).json({ user: publicUser(user) });
  });

  router.post('/users/:id/password', async (req, res) => {
    const user = target(req, res);
    if (!user) return;
    if (user.id === req.user.id) {
      return res.status(400).json({ error: 'Use Change Password for your own account.' });
    }
    const { password, requireChange } = req.body || {};
    const problem = passwordProblem(password, user.email);
    if (problem) return res.status(400).json({ error: problem });
    user.hash = await hashPassword(password);
    user.passwordChangedAt = new Date().toISOString();
    user.mustChangePassword = requireChange !== false;
    saveUsers();
    endUserSessions(user.id);
    audit(req, 'changed password of', user.email);
    res.json({ user: publicUser(user) });
  });

  router.post('/users/:id/disabled', (req, res) => {
    const user = target(req, res);
    if (!user) return;
    if (isAdmin(user)) return res.status(400).json({ error: 'The built-in admin cannot be disabled.' });
    user.disabled = !!(req.body && req.body.disabled);
    saveUsers();
    if (user.disabled) endUserSessions(user.id);
    audit(req, user.disabled ? 'disabled' : 'enabled', user.email);
    res.json({ user: publicUser(user) });
  });

  router.post('/users/:id/end-sessions', (req, res) => {
    const user = target(req, res);
    if (!user) return;
    endUserSessions(user.id, req.auth.key);
    audit(req, 'ended sessions of', user.email);
    res.json({ user: publicUser(user) });
  });

  router.delete('/users/:id', (req, res) => {
    const user = target(req, res);
    if (!user) return;
    if (isAdmin(user)) return res.status(400).json({ error: 'The built-in admin cannot be deleted.' });
    users = users.filter(u => u !== user);
    saveUsers();
    endUserSessions(user.id);
    audit(req, 'deleted user', user.email);
    res.json({ ok: true });
  });

  return router;
}

function install(app) {
  const json = express.json({ limit: '10kb' });

  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');   // nginx on this host sets X-Forwarded-*
  app.use(securityHeaders);
  app.use(checkOrigin);

  // ── Open to everyone ──
  app.get('/healthz', (req, res) => res.type('text').send('ok'));
  app.get('/favicon.svg', (req, res) => res.sendFile(path.join(__dirname, 'public', 'favicon.svg')));
  app.use('/auth', express.static(path.join(PAGES_DIR, 'auth')));

  app.get('/login', (req, res) => {
    if (currentSession(req)) return res.redirect(safeNext(req.query.next));
    sendPage(res, 'login.html');
  });

  app.post('/api/auth/login', json, async (req, res) => {
    const { email: rawEmail, password, next } = req.body || {};
    const email = normalizeEmail(rawEmail);
    const keys = rateKeys(req, email);
    const wait = retryAfterSeconds(keys);
    if (wait) {
      res.set('Retry-After', String(wait));
      return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    }
    const user = users.find(u => u.email === email);
    const given = typeof password === 'string' ? password.slice(0, PASSWORD_MAX * 4) : '';
    const matched = await verifyPassword(given, user ? user.hash : dummyHash);
    if (!user || !matched || user.disabled) {
      recordFailure(keys);
      console.warn(`[Auth] Failed login from ${req.ip}`);
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }
    const previous = currentSession(req);
    if (previous) sessions.delete(previous.key);
    user.lastLoginAt = new Date().toISOString();
    saveUsers();
    createSession(req, res, user);
    console.log(`[Auth] ${user.email} logged in from ${req.ip}`);
    res.json({ redirect: user.mustChangePassword ? '/change-password' : safeNext(next) });
  });

  app.post('/api/auth/logout', (req, res) => {
    const current = currentSession(req);
    if (current) {
      sessions.delete(current.key);
      saveSessions();
    }
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  // ── Everything below needs a session ──
  app.use(requireLogin);

  app.get('/api/auth/me', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ email: req.user.email, isAdmin: isAdmin(req.user), mustChangePassword: req.user.mustChangePassword });
  });

  app.get('/change-password', (req, res) => sendPage(res, 'change-password.html'));

  app.post('/api/auth/change-password', json, async (req, res) => {
    const { current, password } = req.body || {};
    const user = req.user;
    const keys = [[`change|${user.id}`, RATE_LIMITS.pair]];
    const wait = retryAfterSeconds(keys);
    if (wait) {
      res.set('Retry-After', String(wait));
      return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    }
    if (typeof current !== 'string' || !(await verifyPassword(current, user.hash))) {
      recordFailure(keys);
      return res.status(400).json({ error: 'Your current password is incorrect.' });
    }
    const problem = passwordProblem(password, user.email);
    if (problem) return res.status(400).json({ error: problem });
    if (password === current) return res.status(400).json({ error: 'Choose a different password.' });
    user.hash = await hashPassword(password);
    user.passwordChangedAt = new Date().toISOString();
    user.mustChangePassword = false;
    saveUsers();
    req.auth.session.passwordChangedAt = user.passwordChangedAt;
    saveSessions();
    endUserSessions(user.id, req.auth.key);   // this browser stays logged in
    console.log(`[Auth] ${user.email} changed their password`);
    res.json({ redirect: '/' });
  });

  app.use(requireCurrentPassword);

  // ── Admin only ──
  app.get('/admin', requireAdmin, (req, res) => sendPage(res, 'admin.html'));
  app.get('/admin/admin.js', requireAdmin, (req, res) => res.sendFile(path.join(PAGES_DIR, 'admin.js')));
  app.use('/api/admin', requireAdmin, json, adminRouter());
}

module.exports = { init, install, hashPasswordSync, resetPasswordOnDisk, passwordProblem, normalizeEmail, ADMIN_EMAIL };
