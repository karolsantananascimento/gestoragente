import crypto from 'node:crypto';
import { config } from '../config.js';
import { httpJson, NotConfigured } from '../http.js';

// WhatsApp Business Cloud API (oficial). Fora da janela de 24h desde a última mensagem do cliente só vale TEMPLATE aprovado pela Meta.
const G = () => `https://graph.facebook.com/${config.meta.version}`;
export const configurado = () => !!(config.whatsapp.token && config.whatsapp.phoneId);
function req() {
  const w = config.whatsapp;
  if (!w.token || !w.phoneId) throw new NotConfigured('WhatsApp', ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID']);
  return w;
}
const enviar = (corpo) => { const w = req(); return httpJson(`${G()}/${w.phoneId}/messages`, { method: 'POST', headers: { authorization: `Bearer ${w.token}` }, body: { messaging_product: 'whatsapp', ...corpo } }); };

export const enviarTexto = (para, texto) => enviar({ to: para, type: 'text', text: { body: String(texto).slice(0, 4000), preview_url: false } });
export const enviarTemplate = (para, nome, params = [], lang) => enviar({
  to: para, type: 'template',
  template: { name: nome, language: { code: lang || config.whatsapp.templateLang }, ...(params.length ? { components: [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: String(p).slice(0, 200) })) }] } : {}) },
});
export const marcarLida = (id) => enviar({ status: 'read', message_id: id }).catch(() => {});

// Verificação do webhook (GET) e assinatura (POST). Sem segredo configurado a assinatura é recusada (falha fechada).
export function verificarChallenge(q) {
  const t = config.whatsapp.verifyToken;
  return t && q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === t ? String(q['hub.challenge'] || '') : null;
}
export function assinaturaValida(raw, header) {
  const seg = config.whatsapp.appSecret; if (!seg || !raw || !header) return false;
  const esperado = 'sha256=' + crypto.createHmac('sha256', seg).update(raw).digest('hex');
  const a = Buffer.from(esperado), b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// Extrai mensagens de texto recebidas do payload do webhook.
export function extrairMensagens(body) {
  const out = [];
  for (const e of body?.entry || []) for (const c of e.changes || []) {
    const v = c.value || {}; const nomes = Object.fromEntries((v.contacts || []).map((x) => [x.wa_id, x.profile?.name]));
    for (const m of v.messages || []) {
      const texto = m.type === 'text' ? m.text?.body : m.type === 'button' ? m.button?.text : m.type === 'interactive' ? (m.interactive?.button_reply?.title || m.interactive?.list_reply?.title) : '';
      out.push({ id: m.id, de: m.from, nome: nomes[m.from] || '', texto: texto || '', tipo: m.type, at: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString() });
    }
  }
  return out;
}
