import { config } from '../config.js';
import { httpJson, NotConfigured } from '../http.js';

// Mensagens diretas da Meta: Messenger (Facebook) e Direct do Instagram, pela Messenger Platform / Instagram API.
// Só responde a quem escreveu primeiro, dentro de 24h (regra da Meta; não existe DM "a frio").
const G = () => `https://graph.facebook.com/${config.meta.version}`;
const baseToken = () => config.social?.fbPageToken || config.meta.token;
export const configurado = () => !!baseToken();
// Com token de usuário (sem token de Página), descobre a Página certa em /me/accounts: a de META_PAGE_ID ou a ligada ao Instagram desejado.
let cache = null;
async function pagina() {
  if (cache && Date.now() - cache.at < 6 * 3600e3) return cache;
  const t = baseToken(); if (!t) throw new NotConfigured('Meta DM', ['META_PAGE_ACCESS_TOKEN']);
  const campos = 'id,name,instagram_business_account{id,username}';
  let eu; try { eu = await httpJson(`${G()}/me?${new URLSearchParams({ fields: campos, access_token: t })}`); } catch { eu = null; }
  if (eu?.id && !eu.email && eu.name && (config.social?.fbPageToken || eu.instagram_business_account !== undefined || !config.social?.fbPageId)) {
    // token de Página: /me já é a Página
    if (config.social?.fbPageToken || eu.instagram_business_account) return (cache = { id: eu.id, nome: eu.name, token: t, ig: eu.instagram_business_account || null, at: Date.now() });
  }
  const lista = await httpJson(`${G()}/me/accounts?${new URLSearchParams({ fields: campos + ',access_token', limit: '100', access_token: t })}`);
  const alvo = process.env.INSTAGRAM_USERNAME || 'bydiscomidia';
  const p = (lista.data || []).find((x) => x.id === config.social?.fbPageId) || (lista.data || []).find((x) => x.instagram_business_account?.username === alvo);
  if (!p?.access_token) throw new Error('Não achei a Página da Disco entre as Páginas deste token (precisa de pages_show_list e acesso à Página).');
  return (cache = { id: p.id, nome: p.name, token: p.access_token, ig: p.instagram_business_account || null, at: Date.now() });
}
export const enviarTexto = async (idDestino, texto) => {
  const pg = await pagina();
  return httpJson(`${G()}/${pg.id}/messages?access_token=${encodeURIComponent(pg.token)}`, { method: 'POST', body: { recipient: { id: idDestino }, messaging_type: 'RESPONSE', message: { text: String(texto).slice(0, 1900) } } });
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

// Diagnóstico e vínculo: confere a Página/Instagram e assina a Página no app para receber as DMs.
export async function status() {
  const pg = await pagina();
  const out = { pagina: { id: pg.id, nome: pg.nome }, instagram: pg.ig ? { id: pg.ig.id, usuario: pg.ig.username } : null, assinaturas: [], app_webhook: !!(config.whatsapp.appId && config.whatsapp.appSecret && config.whatsapp.verifyToken) };
  try { const a = await httpJson(`${G()}/${pg.id}/subscribed_apps?access_token=${encodeURIComponent(pg.token)}`); out.assinaturas = (a.data || []).map((x) => ({ app: x.name || x.id, campos: x.subscribed_fields || [] })); } catch (e) { out.erro_assinaturas = String(e.message).slice(0, 200); }
  return out;
}
export async function vincular(publicUrl) {
  const pg = await pagina(); const r = { pagina: false, app_webhook: null };
  await httpJson(`${G()}/${pg.id}/subscribed_apps?${new URLSearchParams({ subscribed_fields: 'messages,messaging_postbacks', access_token: pg.token })}`, { method: 'POST' });
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
