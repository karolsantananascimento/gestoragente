import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { config, platformStatus, socialStatus } from './config.js';
import { store } from './store.js';
import { buildMcpServer } from './mcp.js';
import { chat, resetSession } from './agent.js';
import { verifyGoogleIdToken } from './googleAuth.js';
import { allTools, callTool } from './tools.js';
import { teamInfo } from './team.js';
import { addSource, refreshSource, removeSource, listSources } from './sources.js';
import { redesDe } from './platforms/social.js';
import { kitCompleto, getCliente, createItem, listItems, editItem, submitArt, requestChanges, createRequest, listRequests, cancelRequest, approveItem, cancelItem, scheduleItem, tick, planoSemanas, importSeeds, STATUS } from './content.js';
import { approveAction, rejectAction, pendingActions } from './guardrails.js';
import {
  authenticate, loginByVerifiedEmail, signSession, readSession, changePassword,
  listUsers, removeUser, createInvite, inviteInfo, acceptInvite, revokeInvite, pendingInvites, sendInviteEmail,
  signup, pendingSignups, approveSignup,
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

// Aceita a chave no cabeçalho Authorization: Bearer ... (Claude Code, API) ou no próprio endereço
// /mcp/<chave> (conector personalizado do claude.ai, que não permite cabeçalhos).
const requireMcp = (req, res, next) => {
  if (!config.mcpToken) return res.status(503).json({ error: 'MCP_TOKEN não configurado no servidor.' });
  const bearer = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!safeEq(bearer || req.params.key, config.mcpToken)) return res.status(401).json({ error: 'Chave inválida.' });
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
app.post(['/mcp', '/mcp/:key'], requireMcp, async (req, res) => {
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
app.all(['/mcp', '/mcp/:key'], requireMcp, (_req, res) => res.status(405).json({ error: 'Use POST.' }));

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
    res.json({ token: signSession(user, !!req.body?.remember), user: { email: user.email, role: user.role } });
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
    res.json({ token: signSession(r.user, !!req.body?.remember), user: { email: r.user.email, role: r.user.role } });
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
  if (user?.pendente) return res.status(403).json({ error: 'Seu cadastro foi recebido e está aguardando a liberação da administradora.' });
  if (!user) { fail(key); store.log({ type: 'login_failed', email: String(email || '').slice(0, 120) }); return res.status(401).json({ error: 'E-mail ou senha inválidos.' }); }
  attempts.delete(key);
  res.json({ token: signSession(user, !!req.body?.remember), user: { email: user.email, role: user.role } });
});

app.post('/api/signup', (req, res) => {
  if (config.disablePasswordLogin) return res.status(403).json({ error: 'Cadastro por senha desativado.' });
  const key = `${req.ip}|signup`;
  if (limited(key)) return res.status(429).json({ error: 'Muitas tentativas. Aguarde 15 minutos.' });
  fail(key);
  const r = signup(req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ ok: true });
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
  res.json({ token: signSession(r.user, !!req.body?.remember), user: { email: r.user.email, role: r.user.role } });
});

app.get('/api/me', requireUser, (req, res) => res.json({ email: req.user.email, role: req.user.role }));

app.post('/api/password', requireUser, (req, res) => {
  const r = changePassword(req.user.email, req.body?.current, req.body?.next);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ ok: true });
});

// --- Equipe (somente admin) ---
app.get('/api/users', requireUser, requireAdmin, (req, res) => res.json({ users: listUsers(), invites: pendingInvites(), cadastros: pendingSignups(), link_cadastro: `${config.publicUrl || `${req.protocol}://${req.get('host')}`}/?cadastro=1` }));

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

app.post('/api/users/:email/approve', requireUser, requireAdmin, (req, res) => {
  const r = approveSignup(req.params.email, req.body?.role || 'member', req.user.email);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(r);
});

app.delete('/api/users/:email', requireUser, requireAdmin, (req, res) => {
  const r = removeUser(req.params.email, req.user.email);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json(r);
});

// --- Agente e fila de aprovação ---
app.get('/api/status', requireUser, (req, res) =>
  res.json({ modo: config.dryRun ? 'SIMULAÇÃO' : 'REAL', tetos: config.caps, plataformas: platformStatus(), redes: redesDe(req.query.cliente), armazenamento: store.mode(), chat: !!config.anthropicKey }));

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

// Consultas diretas (sem IA) para os botões do painel. Somente ferramentas de leitura.
const NO_PANEL = new Set(['aprovar_acao', 'rejeitar_acao']);
app.post('/api/tool', requireUser, async (req, res) => {
  const { name, args } = req.body || {};
  const t = allTools.find((x) => x.name === name);
  if (!t || t.risk !== 'read' || t.mcpOnly || NO_PANEL.has(name)) return res.status(400).json({ error: 'Ferramenta não disponível neste painel.' });
  res.json(await callTool(name, args && typeof args === 'object' ? args : {}, `painel:${req.user.email}`));
});

app.get('/api/pending', requireUser, (_req, res) => res.json(pendingActions()));
app.get('/api/actions', requireUser, (_req, res) => res.json(store.actions().slice(0, 50)));
app.get('/api/audit', requireUser, requireAdmin, (_req, res) => res.json(store.audit().slice(0, 100)));
// Gastar dinheiro é decisão de administrador: colaboradores propõem, administradores aprovam.
app.post('/api/approve/:id', requireUser, requireAdmin, async (req, res) => res.json(await approveAction(req.params.id, req.user.email)));
app.post('/api/reject/:id', requireUser, requireAdmin, (req, res) => res.json(rejectAction(req.params.id, req.user.email)));


// --- Time, conteúdo e marca ---
app.get('/api/team', requireUser, (_req, res) => res.json(teamInfo()));

app.get('/api/content', requireUser, (req, res) => res.json({ status: STATUS, items: listItems(req.query.status, req.query.cliente) }));
const out = (res, r, code = 400) => (r.error ? res.status(code).json({ error: r.error }) : res.json(r.item ? { item: r.item } : r));
app.post('/api/content', requireUser, (req, res) => out(res, createItem(req.body || {}, req.user.email)));
app.patch('/api/content/:id', requireUser, (req, res) => out(res, editItem(req.params.id, req.body || {}, req.user.email)));
app.post('/api/content/:id/art', requireUser, async (req, res) => out(res, await submitArt(req.params.id, req.body || {}, req.user.email)));
// Botão de aprovação humana: só administradores. Aprovar dispara o agendamento da Mariana.
app.post('/api/content/:id/approve', requireUser, requireAdmin, async (req, res) => out(res, await approveItem(req.params.id, req.user.email, { canais: req.body?.canais, modo: req.body?.modo })));
app.post('/api/content/:id/changes', requireUser, (req, res) => out(res, requestChanges(req.params.id, req.body?.nota, req.user.email)));
app.post('/api/content/:id/schedule', requireUser, requireAdmin, async (req, res) => out(res, await scheduleItem(req.params.id, req.user.email)));
app.post('/api/content/:id/cancel', requireUser, requireAdmin, (req, res) => out(res, cancelItem(req.params.id, req.user.email)));

// Pedidos ao time: comandos escritos no painel (criar pauta). O time os executa quando roda.
app.get('/api/requests', requireUser, (req, res) => res.json({ pedidos: listRequests(req.query.status, req.query.cliente) }));
app.post('/api/requests', requireUser, (req, res) => out(res, createRequest(req.body || {}, req.user.email)));
app.post('/api/requests/:id/cancel', requireUser, (req, res) => out(res, cancelRequest(req.params.id, req.user.email)));

app.get('/api/plan', requireUser, (req, res) => res.json({ semanas: planoSemanas(Math.min(Number(req.query.n) || 3, 8), req.query.cliente) }));
// --- Clientes (áreas de trabalho): kit de marca, meta semanal e contas próprias ---
const BRAND_FIELDS = ['nome', 'identidade', 'posicionamento', 'objetivo_conteudo', 'frentes', 'tom_de_voz', 'estilo_comunicacao', 'estilo_visual', 'publico', 'cores', 'fontes', 'logo_url', 'regras_visuais', 'proibido', 'links', 'modelo_lista_numerada', 'padrao_de_feed'];
const clientView = (c) => ({ id: c.id, nome: c.nome, meta_semanal: c.meta_semanal, padrao: !!c.padrao, kit_completo: kitCompleto(c.marca), contas: c.contas || {} });
app.get('/api/clients', requireUser, (_req, res) => res.json({ clientes: store.clientes().map(clientView) }));
app.get('/api/clients/:id', requireUser, (req, res) => {
  const c = getCliente(req.params.id);
  return c ? res.json({ ...clientView(c), marca: c.marca }) : res.status(404).json({ error: 'Cliente não encontrado.' });
});
const slug = (x) => String(x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const cleanMeta = (v) => { const m = Number(v); return Number.isInteger(m) && m >= 1 && m <= 21 ? m : null; };
const cleanContas = (c = {}) => ({ ig_user_id: String(c.ig_user_id || '').replace(/\D/g, '').slice(0, 30), fb_page_id: String(c.fb_page_id || '').replace(/\D/g, '').slice(0, 30) });
app.post('/api/clients', requireUser, requireAdmin, (req, res) => {
  const nome = String(req.body?.nome || '').trim().slice(0, 80);
  if (!nome) return res.status(400).json({ error: 'Informe o nome do cliente.' });
  if (getCliente(nome)) return res.status(400).json({ error: 'Já existe um cliente com esse nome.' });
  const meta = cleanMeta(req.body?.meta_semanal ?? 3);
  if (!meta) return res.status(400).json({ error: 'Meta semanal precisa ser um número de 1 a 21.' });
  const c = store.addCliente({ id: slug(nome), nome, meta_semanal: meta, padrao: false, contas: {}, marca: { nome }, criado_em: new Date().toISOString() });
  store.log({ type: 'cliente_criado', id: c.id, by: req.user.email });
  res.json(clientView(c));
});
app.put('/api/clients/:id', requireUser, requireAdmin, (req, res) => {
  const c = getCliente(req.params.id);
  if (!c) return res.status(404).json({ error: 'Cliente não encontrado.' });
  const b = req.body || {};
  if (b.meta_semanal !== undefined) { const m = cleanMeta(b.meta_semanal); if (!m) return res.status(400).json({ error: 'Meta semanal precisa ser um número de 1 a 21.' }); c.meta_semanal = m; }
  if (b.contas) c.contas = cleanContas(b.contas);
  if (b.marca) {
    // Mescla: campos que o painel não edita (ex.: referências visuais) são preservados.
    for (const k of BRAND_FIELDS) if (b.marca[k] !== undefined) c.marca[k] = String(b.marca[k]).slice(0, 8000);
    if (c.marca.nome) c.nome = c.marca.nome.slice(0, 80);
  }
  store.saveClientes();
  store.log({ type: 'cliente_atualizado', id: c.id, by: req.user.email });
  res.json({ ...clientView(c), marca: c.marca });
});
// Fontes de pauta (links de Google Docs/Sheets)
app.get('/api/clients/:id/sources', requireUser, (req, res) => res.json({ fontes: listSources(req.params.id) }));
app.post('/api/clients/:id/sources', requireUser, async (req, res) => out(res, await addSource(req.params.id, req.body || {}, req.user.email)));
app.post('/api/clients/:id/sources/:sid/refresh', requireUser, async (req, res) => out(res, await refreshSource(req.params.id, req.params.sid)));
app.delete('/api/clients/:id/sources/:sid', requireUser, (req, res) => out(res, removeSource(req.params.id, req.params.sid)));
// Compatibilidade: rotas antigas (cliente padrão ou ?cliente=)
app.get('/api/brand', requireUser, (req, res) => res.json(store.brand(req.query.cliente)));
app.put('/api/brand', requireUser, requireAdmin, (req, res) => {
  const c = getCliente(req.query.cliente);
  if (!c) return res.status(404).json({ error: 'Cliente não encontrado.' });
  for (const k of BRAND_FIELDS) if (req.body?.[k] !== undefined) c.marca[k] = String(req.body[k]).slice(0, 8000);
  if (c.marca.nome) c.nome = c.marca.nome.slice(0, 80);
  store.saveClientes(); store.log({ type: 'brand_updated', by: req.user.email });
  res.json(c.marca);
});
app.put('/api/settings', requireUser, requireAdmin, (req, res) => {
  const m = cleanMeta(req.body?.meta_semanal); const c = getCliente(req.body?.cliente);
  if (!m || !c) return res.status(400).json({ error: 'Informe o cliente e uma meta semanal de 1 a 21.' });
  c.meta_semanal = m; store.saveClientes();
  res.json({ meta_semanal: m });
});

// Imagens das artes (link público e difícil de adivinhar, usado pelas redes sociais)
app.get('/media/:id', (req, res) => {
  const m = /^[a-f0-9]{32}$/.test(req.params.id) && store.media(req.params.id);
  if (!m) return res.status(404).end();
  res.set('content-type', m.type).set('cache-control', 'public, max-age=86400').send(Buffer.from(m.data, 'base64'));
});

app.use(express.static(path.join(here, '..', 'public')));

await store.init().then((m) => console.log(`[store] armazenamento: ${m}`));
{ const n = await importSeeds(); if (n) console.log(`[conteudo] ${n} pauta(s) inicial(is) criada(s)`); }
setTimeout(() => tick().catch((e) => console.error('[agendador]', e.message)), 10_000).unref(); // recupera posts vencidos após reinício
setInterval(() => tick().catch((e) => console.error('[agendador]', e.message)), 60_000).unref();
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => store.flush().finally(() => process.exit(0)));

app.listen(config.port, () => {
  console.log(`traffic-agent na porta ${config.port} · modo ${config.dryRun ? 'SIMULAÇÃO (dry-run)' : 'REAL'} · admin ${config.adminEmail}`);
  if (!config.appPassword) console.warn('APP_PASSWORD ausente: o administrador não conseguirá entrar até que seja definida.');
  if (!config.mcpToken) console.warn('MCP_TOKEN ausente: o endpoint /mcp ficará bloqueado.');
});
