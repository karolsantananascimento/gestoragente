import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { config, platformStatus } from './config.js';
import { store } from './store.js';
import { buildMcpServer } from './mcp.js';
import { chat, resetSession } from './agent.js';
import { approveAction, rejectAction, pendingActions } from './guardrails.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));

const safeEq = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};

// --- Autenticação ---
const requireApp = (req, res, next) => {
  if (!config.appPassword) return res.status(503).json({ error: 'APP_PASSWORD não configurada no servidor.' });
  if (!safeEq(req.get('x-app-password'), config.appPassword)) return res.status(401).json({ error: 'Senha inválida.' });
  next();
};
const requireMcp = (req, res, next) => {
  if (!config.mcpToken) return res.status(503).json({ error: 'MCP_TOKEN não configurado no servidor.' });
  const bearer = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!safeEq(bearer, config.mcpToken)) return res.status(401).json({ error: 'Token inválido.' });
  next();
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

// --- API do chat web ---
app.get('/api/status', requireApp, (_req, res) =>
  res.json({ modo: config.dryRun ? 'SIMULAÇÃO' : 'REAL', tetos: config.caps, plataformas: platformStatus(), chat: !!config.anthropicKey }));

app.post('/api/chat', requireApp, async (req, res) => {
  const { sessionId = 'default', message } = req.body || {};
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'Mensagem vazia.' });
  try {
    res.json(await chat(sessionId, message));
  } catch (e) {
    console.error('[chat]', e);
    res.status(500).json({ error: e.message });
  }
});
app.post('/api/reset', requireApp, (req, res) => { resetSession(req.body?.sessionId || 'default'); res.json({ ok: true }); });

app.get('/api/pending', requireApp, (_req, res) => res.json(pendingActions()));
app.get('/api/actions', requireApp, (_req, res) => res.json(store.actions().slice(0, 50)));
app.get('/api/audit', requireApp, (_req, res) => res.json(store.audit().slice(0, 100)));
app.post('/api/approve/:id', requireApp, async (req, res) => res.json(await approveAction(req.params.id, 'web-user')));
app.post('/api/reject/:id', requireApp, (req, res) => res.json(rejectAction(req.params.id, 'web-user')));

app.use(express.static(path.join(here, '..', 'public')));

app.listen(config.port, () => {
  console.log(`traffic-agent na porta ${config.port} · modo ${config.dryRun ? 'SIMULAÇÃO (dry-run)' : 'REAL'}`);
  if (!config.appPassword) console.warn('APP_PASSWORD ausente: a interface web ficará bloqueada.');
  if (!config.mcpToken) console.warn('MCP_TOKEN ausente: o endpoint /mcp ficará bloqueado.');
});
