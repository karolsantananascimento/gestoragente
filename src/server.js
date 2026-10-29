import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { config, platformStatus } from './config.js';
import { store } from './store.js';
import { buildMcpServer } from './mcp.js';
import { chat, resetSession } from './agent.js';
import { verifyGoogleIdToken } from './googleAuth.js';
import { approveAction, rejectAction, pendingActions } from './guardrails.js';
import {
  authenticate, loginByVerifiedEmail, signSession, readSession, changePassword,
  listUsers, removeUser, createInvite, inviteInfo, acceptInvite, revokeInvite, pendingInvites, sendInviteEmail,
} from './users.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1); // Render termina o HTTPS num proxy
app.use(express.json({ limit: '1mb' }));

const safeEq = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};

// --- Autenticação ---
const requireUser = (req, res, next) => {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const user = readSession(token);
  if (!user) return res.status(401).json({ error: 'Sessão inválida ou expirada. Entre novamente.' });
  req.user = user;
  next();
};
const requireAdmin = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Somente administradores podem fazer isso.' });

const requireMcp = (req, res, next) => {
  if (!config.mcpToken) return res.status(503).json({ error: 'MCP_TOKEN não configurado no servidor.' });
  const bearer = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!safeEq(bearer, config.mcpToken)) return res.status(401).json({ error: 'Token inválido.' });
  next();
};

// Limite de tentativas de login: 8 por 15 min por IP+e-mail
const attempts = new Map();
const limited = (key) => {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || now > a.reset) return false;
  return a.count >= 8;
};
const fail = (key) => {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || now > a.reset) attempts.set(key, { count: 1, reset: now + 15 * 60 * 1000 });
  else a.count++;
};

app.get('/health', (_req, res) => res.json({ ok: true, modo: config.dryRun ? 'dry-run' : 'real' }));

// --- MCP (conectar no Claude como conector personalizado) ---
app.post('/mcp', requireMcp, async (req, res) => {
  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error('[mcp]', e);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Erro interno' }, id: null });
  }
});
app.all('/mcp', requireMcp, (_req, res) => res.status(405).json({ error: 'Use POST.' }));

// --- Login, convites e conta ---
app.get('/api/config', (_req, res) =>
  res.json({ googleClientId: config.googleLoginClientId || null, passwordLogin: !config.disablePasswordLogin }));

app.post('/api/login/google', async (req, res) => {
  const key = `${req.ip}|google`;
  if (limited(key)) return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos.' });
  try {
    const g = await verifyGoogleIdToken(req.body?.credential);
    const user = loginByVerifiedEmail(g.email);
    if (!user) {
      fail(key);
      store.log({ type: 'login_denied', email: g.email, via: 'google' });
      return res.status(403).json({ error: `${g.email} não tem acesso. Peça um convite para a administradora.` });
    }
    attempts.delete(key);
    store.log({ type: 'login', email: user.email, via: 'google' });
    res.json({ token: signSession(user), user: { email: user.email, role: user.role } });
  } catch (e) {
    fail(key);
    res.status(401).json({ error: e.message });
  }
});

app.post('/api/accept-invite-google', async (req, res) => {
  try {
    const g = await verifyGoogleIdToken(req.body?.credential);
    const r = acceptInvite(req.body?.token, null, g.email);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ token: signSession(r.user), user: { email: r.user.email, role: r.user.role } });
  } catch (e) {
    res.status(401).json({ error: e.message });
  }
});

app.post('/api/login', (req, res) => {
  if (config.disablePasswordLogin) return res.status(403).json({ error: 'Login por senha desativado. Use "Continuar com Google".' });
  const { email, password } = req.body || {};
  const key = `${req.ip}|${String(email || '').toLowerCase()}`;
  if (limited(key)) return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos.' });
  const user = authenticate(email, password);
  if (!user) { fail(key); store.log({ type: 'login_failed', email: String(email || '').slice(0, 120) }); return res.status(401).json({ error: 'E-mail ou senha inválidos.' }); }
  attempts.delete(key);
  res.json({ token: signSession(user), user: { email: user.email, role: user.role } });
});

app.get('/api/invite-info', (req, res) => {
  const info = inviteInfo(req.query.token);
  if (!info) return res.status(404).json({ error: 'Convite inválido, expirado ou já usado.' });
  res.json(info);
});

app.post('/api/accept-invite', (req, res) => {
  if (config.disablePasswordLogin) return res.status(403).json({ error: 'Cadastro por senha desativado. Use "Continuar com Google".' });
  const { token, password } = req.body || {};
  const r = acceptInvite(token, password);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ token: signSession(r.user), user: { email: r.user.email, role: r.user.role } });
});

app.get('/api/me', requireUser, (req, res) => res.json({ email: req.user.email, role: req.user.role }));

app.post('/api/password', requireUser, (req, res) => {
  const r = changePassword(req.user.email, req.body?.current, req.body?.next);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ ok: true });
});

// --- Equipe (somente admin) ---
app.get('/api/users', requireUser, requireAdmin, (_req, res) => res.json({ users: listUsers(), invites: pendingInvites() }));

app.post('/api/invites', requireUser, requireAdmin, async (req, res) => {
  const { email, role } = req.body || {};
  const r = createInvite({ email, role, by: req.user.email });
  if (r.error) return res.status(400).json({ error: r.error });
  const base = config.publicUrl || `${req.protocol}://${req.get('host')}`;
  const link = `${base}/?invite=${r.token}`;
  const mail = await sendInviteEmail({ to: r.invite.email, link, by: req.user.email, role: r.invite.role });
  res.json({ id: r.invite.id, email: r.invite.email, role: r.invite.role, expiresAt: r.invite.expiresAt, link, emailSent: mail.sent, emailNote: mail.reason || null });
});

app.delete('/api/invites/:id', requireUser, requireAdmin, (req, res) => {
  const r = revokeInvite(req.params.id, req.user.email);
  if (r.error) return res.status(404).json({ error: r.error });
  res.json(r);
});

app.delete('/api/users/:email', requireUser, requireAdmin, (req, res) => {
  const r = removeUser(req.params.email, req.user.email);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(r);
});

// --- Agente e fila de aprovação ---
app.get('/api/status', requireUser, (_req, res) =>
  res.json({ modo: config.dryRun ? 'SIMULAÇÃO' : 'REAL', tetos: config.caps, plataformas: platformStatus(), chat: !!config.anthropicKey }));

app.post('/api/chat', requireUser, async (req, res) => {
  const { sessionId = 'default', message } = req.body || {};
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'Mensagem vazia.' });
  try {
    res.json(await chat(`${req.user.email}:${sessionId}`, message, req.user.email));
  } catch (e) {
    console.error('[chat]', e);
    res.status(500).json({ error: e.message });
  }
});
app.post('/api/reset', requireUser, (req, res) => { resetSession(`${req.user.email}:${req.body?.sessionId || 'default'}`); res.json({ ok: true }); });

app.get('/api/pending', requireUser, (_req, res) => res.json(pendingActions()));
app.get('/api/actions', requireUser, (_req, res) => res.json(store.actions().slice(0, 50)));
app.get('/api/audit', requireUser, requireAdmin, (_req, res) => res.json(store.audit().slice(0, 100)));
// Gastar dinheiro é decisão de administrador: colaboradores propõem, administradores aprovam.
app.post('/api/approve/:id', requireUser, requireAdmin, async (req, res) => res.json(await approveAction(req.params.id, req.user.email)));
app.post('/api/reject/:id', requireUser, requireAdmin, (req, res) => res.json(rejectAction(req.params.id, req.user.email)));

app.use(express.static(path.join(here, '..', 'public')));

app.listen(config.port, () => {
  console.log(`traffic-agent na porta ${config.port} · modo ${config.dryRun ? 'SIMULAÇÃO (dry-run)' : 'REAL'} · admin ${config.adminEmail}`);
  if (!config.appPassword) console.warn('APP_PASSWORD ausente: o administrador não conseguirá entrar até que seja definida.');
  if (!config.mcpToken) console.warn('MCP_TOKEN ausente: o endpoint /mcp ficará bloqueado.');
});
