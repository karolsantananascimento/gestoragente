import crypto from 'node:crypto';
import { config } from '../config.js';
import { store } from '../store.js';

// LinkedIn: OAuth2 (produto "Compartilhar no LinkedIn", escopo w_member_social). A usuária autoriza no site do LinkedIn;
// o sistema guarda só o token de acesso (válido por ~60 dias; depois é preciso reconectar).
// Cada cliente só publica se tiver o "autor" cadastrado (urn:li:person:... ou urn:li:organization:...).
const API = 'https://api.linkedin.com';
const VERSION = () => process.env.LINKEDIN_API_VERSION || '202510';
export const appConfigured = () => !!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET);
const saved = () => { const t = store.integ('linkedin'); return t && t.expira && Date.parse(t.expira) > Date.now() ? t : null; };
const token = () => saved()?.access_token || config.social.linkedinToken || '';
export const conectado = () => !!token();

const nonces = new Map();
export function authUrl(email, redirect) {
  const state = crypto.randomBytes(18).toString('hex');
  nonces.set(state, { email, exp: Date.now() + 10 * 60e3 });
  const q = new URLSearchParams({ response_type: 'code', client_id: process.env.LINKEDIN_CLIENT_ID, redirect_uri: redirect, state, scope: process.env.LINKEDIN_SCOPES || 'openid profile w_member_social' });
  return `https://www.linkedin.com/oauth/v2/authorization?${q}`;
}
const call = async (path, { method = 'GET', body, headers = {}, raw, tk } = {}) => {
  const r = await fetch(path.startsWith('http') ? path : API + path, {
    method, body: raw ?? (body ? JSON.stringify(body) : undefined),
    headers: { authorization: 'Bearer ' + (tk || token()), 'linkedin-version': VERSION(), 'x-restli-protocol-version': '2.0.0', ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
  });
  const text = await r.text(); let j = {}; try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text }; }
  return { status: r.status, j, h: r.headers };
};

export async function callback(state, code, error, redirect) {
  const n = nonces.get(state); nonces.delete(state);
  if (!n || n.exp < Date.now()) throw new Error('Pedido de conexão expirado. Tente de novo.');
  if (error) throw new Error('Autorização negada no LinkedIn.');
  if (!code) throw new Error('O LinkedIn não devolveu o código de autorização.');
  const r = await fetch('https://www.linkedin.com/oauth/v2/accessToken', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: process.env.LINKEDIN_CLIENT_ID, client_secret: process.env.LINKEDIN_CLIENT_SECRET }).toString() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`O LinkedIn recusou a autorização (${j.error_description || j.error || r.status}). Confira client id/secret e o redirect uri.`);
  const me = await call('/v2/userinfo', { tk: j.access_token });
  const urn = me.j?.sub ? `urn:li:person:${me.j.sub}` : '';
  store.setInteg('linkedin', { access_token: j.access_token, expira: new Date(Date.now() + (j.expires_in || 5184000) * 1000).toISOString(), usuario: me.j?.name || '', urn, em: new Date().toISOString(), por: n.email });
  return { by: n.email, usuario: me.j?.name || '' };
}

const esc = (t) => String(t).replace(/[\\|{}@\[\]()<>~_*]/g, (c) => '\\' + c); // caracteres reservados do "little text" (# fica livre: vira hashtag)
const DICAS = [
  [/401|expired|revoked|invalid.*token/i, 'O token do LinkedIn venceu (dura ~60 dias). Clique em "Reconectar LinkedIn".'],
  [/403|not enough permissions|ACCESS_DENIED|permission/i, 'Sem permissão: o app precisa do produto "Compartilhar no LinkedIn" (w_member_social) e, para páginas, de w_organization_social e papel de administrador da página.'],
  [/429|throttl|too many/i, 'Limite de requisições do LinkedIn atingido. Tente mais tarde.'],
  [/422|duplicate/i, 'O LinkedIn recusou o conteúdo (pode ser post duplicado).'],
];
const falha = (r, etapa) => { const m = r.j?.message || r.j?.raw || JSON.stringify(r.j).slice(0, 300); const t = `LinkedIn (${etapa}) HTTP ${r.status}: ${String(m).slice(0, 300)}`; const d = DICAS.find(([re]) => re.test(t)); return new Error(d ? `${t} → ${d[1]}` : t); };

async function subirImagem(url, author) {
  const ini = await call('/rest/images?action=initializeUpload', { method: 'POST', body: { initializeUploadRequest: { owner: author } } });
  if (ini.status >= 300) throw falha(ini, 'iniciar upload');
  const { uploadUrl, image } = ini.j.value || {};
  const img = await fetch(url, { redirect: 'follow' });
  if (!img.ok) throw new Error(`Não consegui baixar a arte (${img.status}). O link precisa ser público.`);
  const buf = Buffer.from(await img.arrayBuffer());
  const up = await fetch(uploadUrl, { method: 'PUT', headers: { authorization: 'Bearer ' + token(), 'content-type': img.headers.get('content-type') || 'image/jpeg' }, body: buf });
  if (!up.ok) throw new Error(`LinkedIn (enviar imagem) HTTP ${up.status}`);
  return image;
}

export async function publicar(item, author) {
  if (!author) throw new Error('Este cliente não tem o autor do LinkedIn cadastrado (aba Marca → Publicação).');
  if (!token()) throw new Error('LinkedIn não conectado. Em Marca → Publicação, clique em "Conectar LinkedIn".');
  const urls = (item.arte_urls?.length ? item.arte_urls : [item.arte_url]).filter(Boolean);
  const video = urls.length === 1 && /\.(mp4|mov)(\?|$)/i.test(urls[0]);
  const post = { author, commentary: esc(item.legenda).slice(0, 3000), visibility: 'PUBLIC', distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] }, lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false };
  let nota = '';
  if (video) nota = 'Vídeo ainda não é publicado no LinkedIn: saiu só o texto.';
  else if (urls.length > 1) { const ids = []; for (const u of urls.slice(0, 20)) ids.push({ id: await subirImagem(u, author), altText: item.titulo?.slice(0, 120) || 'imagem' }); post.content = { multiImage: { images: ids } }; }
  else if (urls.length === 1) post.content = { media: { id: await subirImagem(urls[0], author), altText: item.titulo?.slice(0, 120) || 'imagem' } };
  const r = await call('/rest/posts', { method: 'POST', body: post });
  if (r.status >= 300) throw falha(r, 'publicar');
  return { id: r.h.get('x-restli-id') || '', nota };
}

export async function status(clienteId) {
  const out = { app: appConfigured(), conectado: false, usuario: '', urn: '', autor: '', dicas: [] };
  const c = store.cliente(clienteId); out.autor = c?.contas?.linkedin_author || '';
  const t = store.integ('linkedin');
  if (!appConfigured() && !config.social.linkedinToken) { out.dicas.push('Falta LINKEDIN_CLIENT_ID e LINKEDIN_CLIENT_SECRET no Render (app em linkedin.com/developers).'); return out; }
  if (t && !saved()) out.dicas.push('O token do LinkedIn venceu. Clique em "Reconectar LinkedIn".');
  if (!token()) { out.dicas.push('LinkedIn ainda não conectado: clique em "Conectar LinkedIn".'); return out; }
  out.conectado = true; out.usuario = t?.usuario || '(token por variável de ambiente)'; out.urn = t?.urn || '';
  if (t?.expira) { out.dias = Math.max(0, Math.round((Date.parse(t.expira) - Date.now()) / 86400e3)); if (out.dias <= 7) out.dicas.push(`O token vence em ${out.dias} dia(s): reconecte em breve.`); }
  if (!out.autor) out.dicas.push(out.urn ? 'Este cliente ainda não publica no LinkedIn. Para usar o seu perfil, clique em "Usar meu perfil" (ou informe o URN de uma página que você administra).' : 'Informe o autor (URN) deste cliente.');
  return out;
}
export const limpar = () => store.setInteg('linkedin', null);
