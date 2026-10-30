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
