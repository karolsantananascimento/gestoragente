// Testa a conexão e a publicação no Reddit com a API simulada.
import fs from 'node:fs';
process.env.DATA_DIR = './data/reddit-test'; process.env.DRY_RUN = 'false';
process.env.REDDIT_CLIENT_ID = 'cid'; process.env.REDDIT_CLIENT_SECRET = 'sec';
fs.rmSync('./data/reddit-test', { recursive: true, force: true });
const { store } = await import('../src/store.js'); await store.init();
const reddit = await import('../src/platforms/reddit.js');
const { adapters, redesDe } = await import('../src/platforms/social.js');
const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url); const body = opts.body ? Object.fromEntries(new URLSearchParams(opts.body)) : {}; calls.push({ u, body, h: opts.headers });
  const j = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json' } });
  if (u.endsWith('/api/v1/access_token')) return body.grant_type === 'authorization_code' && body.code === 'ok' ? j({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }) : body.grant_type === 'refresh_token' ? j({ access_token: 'AT2', expires_in: 3600 }) : j({ error: 'invalid_grant' }, 400);
  if (u.endsWith('/api/v1/me')) return j({ name: 'karol' });
  if (u.endsWith('/api/submit')) return body.sr === 'cheio' ? j({ json: { errors: [['RATELIMIT', 'you are doing that too much']] } }) : j({ json: { errors: [], data: { name: 't3_abc', url: 'https://reddit.com/r/loja/comments/abc' } } });
  return j({}, 404);
};
let fails = 0; const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FALHA'} ${m}`); if (!c) fails++; };
store.cliente('operizy').contas = { reddit_subreddit: 'loja' }; store.saveClientes();
ok(!redesDe('operizy').reddit, 'sem conexão o canal Reddit não está disponível');
const url = reddit.authUrl('a@b.c', 'https://x/api/reddit/callback');
const state = new URL(url).searchParams.get('state');
ok(/scope=identity\+submit\+read/.test(url) && /duration=permanent/.test(url), 'URL de autorização pede identity/submit/read permanente');
let err = ''; try { await reddit.callback('falso', 'ok', '', 'r'); } catch (e) { err = e.message; }
ok(/expirado/.test(err), 'state inválido é recusado');
const w = await reddit.callback(state, 'ok', '', 'https://x/api/reddit/callback');
ok(w.usuario === 'karol' && store.integ('reddit').refresh_token === 'RT', 'conecta e guarda só o refresh token');
ok(redesDe('operizy').reddit && !redesDe('disco').reddit, 'só o cliente com subreddit fica conectado');
const r = await adapters.reddit.publicar({ cliente_id: 'operizy', titulo: 'Operizy · Order bump em 5 slides', legenda: 'Texto', arte_url: 'https://a/b.jpg' });
const sub = calls.find((c) => c.u.endsWith('/api/submit'));
ok(r.id === 't3_abc' && sub.body.title === 'Order bump em 5 slides' && sub.body.kind === 'self' && /b\.jpg/.test(sub.body.text), 'publica texto com título limpo e link da arte');
store.cliente('operizy').contas = { reddit_subreddit: 'cheio' };
err = ''; try { await adapters.reddit.publicar({ cliente_id: 'operizy', titulo: 'x', legenda: 'y' }); } catch (e) { err = e.message; }
ok(/RATELIMIT/.test(err) && /Espere/.test(err), 'erro do Reddit vem com explicação');
fs.rmSync('./data/reddit-test', { recursive: true, force: true });
console.log(fails ? `${fails} falha(s)` : 'reddit ok'); process.exit(fails ? 1 : 0);
