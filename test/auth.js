// Testa login, convites e permissões subindo o servidor de verdade em porta local.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = 3222;
const BASE = `http://localhost:${PORT}`;
fs.rmSync('./data/auth-test', { recursive: true, force: true });

const srv = spawn('node', ['src/server.js'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: './data/auth-test', DRY_RUN: 'true', APP_PASSWORD: 'senha-do-admin-1', MCP_TOKEN: 'tok', ADMIN_EMAIL: 'knasck@gmail.com' },
  stdio: 'ignore',
});
const done = (code) => { srv.kill(); fs.rmSync('./data/auth-test', { recursive: true, force: true }); process.exit(code); };

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FALHA'} ${msg}`); if (!cond) fails++; };
const call = async (path, { method = 'GET', body, token } = {}) => {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }

  // Google (sem Client ID configurado no teste: recusa com mensagem clara, sem quebrar)
  let g = await call('/api/config');
  ok(g.status === 200 && g.data.googleClientId === null && g.data.passwordLogin === true, 'config pública informa que o Google ainda não está configurado');
  g = await call('/api/login/google', { method: 'POST', body: { credential: 'qualquer' } });
  ok(g.status === 401, 'login Google sem configuração é recusado');

  // login admin
  let r = await call('/api/login', { method: 'POST', body: { email: 'knasck@gmail.com', password: 'errada' } });
  ok(r.status === 401, 'senha errada é recusada');
  r = await call('/api/login', { method: 'POST', body: { email: 'KNASCK@gmail.com', password: 'senha-do-admin-1' } });
  ok(r.status === 200 && r.data.user.role === 'admin', 'admin entra com e-mail + APP_PASSWORD (e-mail case-insensitive)');
  const admin = r.data.token;

  r = await call('/api/login', { method: 'POST', body: { email: 'outra@x.com', password: 'senha-do-admin-1' } });
  ok(r.status === 401, 'APP_PASSWORD não vale para outros e-mails');

  r = await call('/api/status');
  ok(r.status === 401, 'sem sessão, API é bloqueada');

  // convite
  r = await call('/api/invites', { method: 'POST', token: admin, body: { email: 'colega@x.com', role: 'member' } });
  ok(r.status === 200 && r.data.link.includes('?invite='), 'admin cria convite e recebe o link');
  const invToken = new URL(r.data.link).searchParams.get('invite');

  r = await call('/api/invite-info?token=' + invToken);
  ok(r.data.email === 'colega@x.com', 'link do convite revela o e-mail convidado');
  r = await call('/api/accept-invite', { method: 'POST', body: { token: invToken, password: 'curta' } });
  ok(r.status === 400, 'senha com menos de 8 caracteres é recusada');
  r = await call('/api/accept-invite', { method: 'POST', body: { token: invToken, password: 'senha-da-colega-1' } });
  ok(r.status === 200 && r.data.user.role === 'member', 'colaboradora aceita o convite e entra');
  const member = r.data.token;
  r = await call('/api/accept-invite', { method: 'POST', body: { token: invToken, password: 'outra-senha-123' } });
  ok(r.status === 400, 'convite não pode ser usado duas vezes');

  // permissões
  r = await call('/api/users', { token: member });
  ok(r.status === 403, 'colaboradora não vê a equipe');
  r = await call('/api/invites', { method: 'POST', token: member, body: { email: 'x@x.com' } });
  ok(r.status === 403, 'colaboradora não convida ninguém');
  r = await call('/api/approve/qualquer', { method: 'POST', token: member });
  ok(r.status === 403, 'colaboradora não aprova ações');
  r = await call('/api/pending', { token: member });
  ok(r.status === 200, 'colaboradora enxerga a fila de pendências');

  // convite para admin + remoção
  r = await call('/api/invites', { method: 'POST', token: admin, body: { email: 'colega@x.com', role: 'member' } });
  ok(r.status === 400, 'não convida e-mail que já tem acesso');
  r = await call('/api/users/knasck%40gmail.com', { method: 'DELETE', token: admin });
  ok(r.status === 400, 'administradora principal não pode ser removida');
  r = await call('/api/users/colega%40x.com', { method: 'DELETE', token: admin });
  ok(r.status === 200, 'admin remove a colaboradora');
  r = await call('/api/me', { token: member });
  ok(r.status === 401, 'sessão da colaboradora removida deixa de valer na hora');

  // consultas diretas do painel: só leitura
  r = await call('/api/tool', { method: 'POST', token: admin, body: { name: 'meta_listar_contas', args: {} } });
  ok(r.status === 200 && r.data.status === 'nao_configurado', 'botão de contas responde sem IA (aqui: Meta sem token no teste)');
  r = await call('/api/tool', { method: 'POST', token: admin, body: { name: 'meta_pausar_ativar', args: { id: '1', status: 'ACTIVE' } } });
  ok(r.status === 400, 'rota do painel recusa ferramentas de escrita');
  r = await call('/api/tool', { method: 'POST', token: admin, body: { name: 'aprovar_acao', args: { id: 'x', pin: '1' } } });
  ok(r.status === 400, 'rota do painel recusa aprovar_acao');
  r = await call('/api/tool', { method: 'POST', body: { name: 'meta_listar_contas' } });
  ok(r.status === 401, 'rota do painel exige login');

  // troca de senha do admin
  r = await call('/api/password', { method: 'POST', token: admin, body: { current: 'senha-do-admin-1', next: 'nova-senha-admin-2' } });
  ok(r.status === 200, 'admin troca a própria senha');
  r = await call('/api/login', { method: 'POST', body: { email: 'knasck@gmail.com', password: 'senha-do-admin-1' } });
  ok(r.status === 401, 'senha antiga deixa de valer');
  r = await call('/api/login', { method: 'POST', body: { email: 'knasck@gmail.com', password: 'nova-senha-admin-2' } });
  ok(r.status === 200, 'nova senha funciona');

  // limite de tentativas
  let last;
  for (let i = 0; i < 10; i++) last = await call('/api/login', { method: 'POST', body: { email: 'brute@x.com', password: 'x' + i } });
  ok(last.status === 429, 'muitas tentativas erradas bloqueiam o login');

  // MCP independente
  const m = await fetch(BASE + '/mcp', { method: 'POST', headers: { authorization: 'Bearer tok', 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  ok(m.status === 200, 'endpoint MCP continua funcionando com MCP_TOKEN');
  const mh = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  const init = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  const viaPath = await fetch(BASE + '/mcp/tok', { method: 'POST', headers: mh, body: init });
  const txt = await viaPath.text();
  ok(viaPath.status === 200 && txt.includes('gestora de tráfego'), 'conector por endereço (/mcp/<chave>) funciona e entrega o prompt mestre');
  const bad = await fetch(BASE + '/mcp/errada', { method: 'POST', headers: mh, body: init });
  ok(bad.status === 401, 'chave errada no endereço é recusada');
} catch (e) {
  console.error('ERRO NO TESTE:', e);
  fails++;
}
console.log(fails ? `\n${fails} falha(s)` : '\nTodos os testes passaram');
done(fails ? 1 : 0);
