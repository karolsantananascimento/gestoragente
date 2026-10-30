import { config } from '../config.js';
import { httpJson, NotConfigured } from '../http.js';

// Mensagens diretas da Meta: Messenger (Facebook) e Direct do Instagram, pela Messenger Platform / Instagram API.
// Só responde a quem escreveu primeiro, dentro de 24h (regra da Meta; não existe DM "a frio").
const G = () => `https://graph.facebook.com/${config.meta.version}`;
const token = () => config.social?.fbPageToken || config.meta.token;
export const configurado = () => !!token();
export const enviarTexto = (idDestino, texto) => {
  if (!token()) throw new NotConfigured('Meta DM', ['META_PAGE_ACCESS_TOKEN']);
  return httpJson(`${G()}/me/messages?access_token=${encodeURIComponent(token())}`, { method: 'POST', body: { recipient: { id: idDestino }, messaging_type: 'RESPONSE', message: { text: String(texto).slice(0, 1900) } } });
};
// Extrai mensagens de texto de payloads object=page (Messenger) e object=instagram.
export function extrairMensagens(body) {
  const canal = body?.object === 'instagram' ? 'instagram' : body?.object === 'page' ? 'facebook' : null;
  const out = [];
  if (!canal) return out;
  for (const e of body.entry || []) for (const m of e.messaging || []) {
    if (!m.message || m.message.is_echo || !m.sender?.id || m.sender.id === e.id) continue;
    out.push({ canal, id: m.message.mid, de: m.sender.id, nome: '', texto: m.message.text || '', tipo: m.message.text ? 'text' : 'midia', at: m.timestamp ? new Date(Number(m.timestamp)).toISOString() : new Date().toISOString() });
  }
  return out;
}

// Diagnóstico e vínculo: confere a Página/Instagram do token e assina a Página no app para receber as DMs.
const q = (path, params = {}) => `${G()}/${path}?${new URLSearchParams({ access_token: token(), ...params })}`;
export async function status() {
  if (!token()) throw new NotConfigured('Meta DM', ['META_PAGE_ACCESS_TOKEN']);
  const out = { pagina: null, instagram: null, assinaturas: [], app_webhook: !!(config.whatsapp.appId && config.whatsapp.appSecret && config.whatsapp.verifyToken) };
  try { const p = await httpJson(q('me', { fields: 'id,name,instagram_business_account{id,username}' })); out.pagina = { id: p.id, nome: p.name }; out.instagram = p.instagram_business_account ? { id: p.instagram_business_account.id, usuario: p.instagram_business_account.username } : null; }
  catch (e) { out.erro = e.message; return out; }
  try { const a = await httpJson(q('me/subscribed_apps')); out.assinaturas = (a.data || []).map((x) => ({ app: x.name || x.id, campos: x.subscribed_fields || [] })); } catch (e) { out.erro_assinaturas = e.message; }
  return out;
}
export async function vincular(publicUrl) {
  if (!token()) throw new NotConfigured('Meta DM', ['META_PAGE_ACCESS_TOKEN']);
  const r = { pagina: false, app_webhook: null };
  await httpJson(q('me/subscribed_apps', { subscribed_fields: 'messages,messaging_postbacks' }), { method: 'POST' });
  r.pagina = true;
  const w = config.whatsapp;
  if (w.appId && w.appSecret && w.verifyToken && /^https:/.test(publicUrl || '')) {
    r.app_webhook = [];
    for (const object of ['page', 'instagram']) {
      try { await httpJson(`${G()}/${w.appId}/subscriptions`, { method: 'POST', form: { object, callback_url: `${publicUrl}/hooks/meta-dm`, fields: 'messages', verify_token: w.verifyToken, access_token: `${w.appId}|${w.appSecret}` } }); r.app_webhook.push({ object, ok: true }); }
      catch (e) { r.app_webhook.push({ object, ok: false, erro: String(e.message).slice(0, 200) }); }
    }
  }
  return r;
}
