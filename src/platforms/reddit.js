import crypto from 'node:crypto';
import { config } from '../config.js';
import { store } from '../store.js';

// Reddit: OAuth2 com refresh token (duração permanente). A usuária autoriza no site do Reddit; o sistema guarda só o token.
// Publica um post de texto (título + legenda, com o link da arte no fim) no subreddit cadastrado para o cliente.
const UA = () => config.reddit.userAgent;
const basic = () => 'Basic ' + Buffer.from(`${config.reddit.clientId}:${config.reddit.clientSecret}`).toString('base64');
export const appConfigured = () => !!(config.reddit.clientId && config.reddit.clientSecret);
export const conectado = () => appConfigured() && !!store.integ('reddit')?.refresh_token;

const nonces = new Map();
export function authUrl(email, redirect) {
  const state = crypto.randomBytes(18).toString('hex');
  nonces.set(state, { email, exp: Date.now() + 10 * 60e3 });
  const q = new URLSearchParams({ client_id: config.reddit.clientId, response_type: 'code', state, redirect_uri: redirect, duration: 'permanent', scope: 'identity submit read' });
  return `https://www.reddit.com/api/v1/authorize?${q}`;
}
async function tokenReq(form) {
  const r = await fetch('https://www.reddit.com/api/v1/access_token', { method: 'POST', headers: { authorization: basic(), 'user-agent': UA(), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`Reddit recusou a autorização (${j.error || r.status}). Confira client id/secret e o redirect uri do app.`);
  return j;
}
let cache = null;
export const limparToken = () => { cache = null; };
async function accessToken() {
  if (cache && cache.exp > Date.now() + 30e3) return cache.v;
  const rt = store.integ('reddit')?.refresh_token;
  if (!rt) throw new Error('Reddit não conectado. Em Marca → Publicação, clique em "Conectar Reddit".');
  const j = await tokenReq({ grant_type: 'refresh_token', refresh_token: rt });
  cache = { v: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cache.v;
}
const api = async (path, opts = {}) => {
  const r = await fetch(`https://oauth.reddit.com${path}`, { ...opts, headers: { authorization: 'Bearer ' + await accessToken(), 'user-agent': UA(), ...(opts.form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: opts.form ? new URLSearchParams(opts.form).toString() : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
};

export async function callback(state, code, error, redirect) {
  const n = nonces.get(state); nonces.delete(state);
  if (!n || n.exp < Date.now()) throw new Error('Pedido de conexão expirado. Tente de novo.');
  if (error) throw new Error('Autorização negada no Reddit.');
  if (!code) throw new Error('O Reddit não devolveu o código de autorização.');
  const j = await tokenReq({ grant_type: 'authorization_code', code, redirect_uri: redirect });
  if (!j.refresh_token) throw new Error('O Reddit não devolveu o token permanente.');
  cache = { v: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  const me = await api('/api/v1/me');
  const usuario = me.j?.name || '';
  store.setInteg('reddit', { refresh_token: j.refresh_token, usuario, em: new Date().toISOString(), por: n.email });
  return { by: n.email, usuario };
}

const DICAS = [
  [/RATELIMIT|too much|rate/i, 'O Reddit limitou a frequência de posts desta conta. Espere alguns minutos e tente de novo.'],
  [/SUBREDDIT_NOTALLOWED|not allowed to post|only approved/i, 'Esta conta não pode postar nesse subreddit (precisa ser aprovada/participar da comunidade).'],
  [/NO_SELFS|NO_LINKS|self posts|link posts/i, 'Esse subreddit não aceita este tipo de post (texto ou link).'],
  [/SUBREDDIT_NOEXIST|not found|404/i, 'Subreddit não encontrado. Confira o nome (sem "r/").'],
  [/403|forbidden|banned/i, 'O Reddit negou acesso: a conta pode estar banida do subreddit ou sem permissão "submit".'],
  [/FLAIR|flair/i, 'Este subreddit exige flair (etiqueta) no post, o que o sistema ainda não escolhe. Publique manualmente.'],
];
const dica = (m) => (DICAS.find(([re]) => re.test(m)) || [, ''])[1];

export async function publicar(item, sub) {
  if (!sub) throw new Error('Este cliente não tem subreddit cadastrado (aba Marca → Publicação).');
  let titulo = String(item.titulo || '').replace(/^[^·]{1,30}·\s*/, '').trim().slice(0, 300);
  if (!titulo) titulo = String(item.legenda || '').split('\n')[0].slice(0, 300);
  const text = [item.legenda, item.arte_url ? `\n\n[Imagem do post](${item.arte_url})` : ''].join('').slice(0, 38000);
  const r = await api('/api/submit', { method: 'POST', form: { api_type: 'json', kind: 'self', sr: sub, title: titulo, text, resubmit: 'true', sendreplies: 'true' } });
  const errs = r.j?.json?.errors || [];
  if (r.status >= 400 || errs.length) {
    const m = errs.length ? errs.map((e) => `${e[0]}: ${e[1]}`).join('; ') : `HTTP ${r.status} ${r.j?.message || ''}`;
    throw new Error(`Reddit: ${m}${dica(m) ? ' → ' + dica(m) : ''}`);
  }
  const d = r.j?.json?.data || {};
  return { id: d.name || d.id, nota: d.url ? `Post: ${d.url}` : '' };
}

export async function status(clienteId) {
  const out = { app: appConfigured(), conectado: false, usuario: '', subreddit: '', dicas: [] };
  const c = store.cliente(clienteId); out.subreddit = c?.contas?.reddit_subreddit || '';
  if (!out.app) { out.dicas.push('Falta REDDIT_CLIENT_ID e REDDIT_CLIENT_SECRET no Render.'); return out; }
  const i = store.integ('reddit');
  if (!i?.refresh_token) { out.dicas.push('Reddit ainda não conectado: clique em "Conectar Reddit".'); return out; }
  try { const me = await api('/api/v1/me'); if (me.status !== 200) throw new Error(`HTTP ${me.status}`); out.conectado = true; out.usuario = me.j.name; }
  catch (e) { out.dicas.push(`O token do Reddit não funcionou (${e.message}). Conecte de novo.`); return out; }
  if (!out.subreddit) out.dicas.push('Informe o subreddit deste cliente (ex.: minhaloja ou u_seuusuario para postar no seu perfil).');
  else {
    const r = await api(`/r/${encodeURIComponent(out.subreddit)}/about`);
    if (r.status !== 200) out.dicas.push(`Não consegui abrir r/${out.subreddit} (HTTP ${r.status}). Confira o nome.`);
    else { const d = r.j?.data || {}; out.sub = { titulo: d.title, tipo: d.submission_type, assinantes: d.subscribers, pode_postar: d.user_is_banned ? false : true }; if (d.user_is_banned) out.dicas.push('Esta conta está banida desse subreddit.'); if (d.submission_type === 'link') out.dicas.push('Esse subreddit só aceita links; o sistema publica posts de texto.'); }
  }
  return out;
}
