import { config, socialStatus } from '../config.js';
import { httpJson } from '../http.js';
import { store } from '../store.js';

// Adaptadores das redes sociais usados pela Mariana. Cada um expõe:
//   configured(): bool
//   agendar(item, quando: Date): { modo: 'nativo'|'fila', id? }   (nativo = a rede agenda; fila = nosso agendador publica na hora)
//   publicar(item): { id }
// ATENÇÃO: ainda não testados contra contas reais. Teste primeiro com um post inocente.
const G = () => `https://graph.facebook.com/${config.meta.version}`;
const pageToken = () => config.social.fbPageToken || config.meta.token;

// Contas por cliente. O cliente padrão (Disco) usa as variáveis de ambiente; os demais usam os IDs cadastrados na área do cliente
// e nunca herdam as contas da Disco (para não publicar post de um cliente no perfil de outro).
export function contasDe(clienteId) {
  const c = store.cliente(clienteId);
  const own = c?.contas || {};
  const padrao = !c || c.padrao;
  return {
    fbPageId: own.fb_page_id || (padrao ? config.social.fbPageId : ''),
    igUserId: own.ig_user_id || (padrao ? config.social.igUserId : ''),
    padrao,
  };
}
const tokCache = new Map();
async function fbTokenFor(contas) {
  if (contas.fbPageId === config.social.fbPageId && config.social.fbPageToken) return config.social.fbPageToken;
  const hit = tokCache.get(contas.fbPageId);
  if (hit && hit.exp > Date.now()) return hit.v;
  // Token de página derivado do token do usuário do sistema (que enxerga as páginas dos clientes).
  const r = await httpJson(`${G()}/${contas.fbPageId}?fields=access_token&access_token=${encodeURIComponent(config.meta.token)}`);
  if (!r.access_token) throw new Error('Não foi possível obter o token da página (o usuário do sistema precisa ter acesso a ela).');
  tokCache.set(contas.fbPageId, { v: r.access_token, exp: Date.now() + 3600e3 });
  return r.access_token;
}
export function redesDe(clienteId) {
  const c = contasDe(clienteId); const base = socialStatus();
  const tok = !!(config.meta.token || config.social.fbPageToken);
  return {
    facebook: !!(c.fbPageId && (c.padrao ? base.facebook : tok)),
    instagram: !!(c.igUserId && tok),
    linkedin: base.linkedin && c.padrao, tiktok: false,
  };
}

export const adapters = {
  facebook: {
    nome: 'Facebook',
    configured: (item) => redesDe(item?.cliente_id).facebook,
    // O Facebook agenda sozinho (de 10 min a 30 dias à frente).
    // Fora dessa janela (menos de 11 min ou mais de 29 dias) o servidor publica na hora marcada.
    async agendar(item, quando) {
      const ahead = quando.getTime() - Date.now();
      if (ahead < 11 * 60e3 || ahead > 29 * 86400e3) return { modo: 'fila' };
      const c = contasDe(item.cliente_id);
      const r = await httpJson(`${G()}/${c.fbPageId}/photos`, {
        method: 'POST',
        form: {
          url: item.arte_url, caption: item.legenda, published: 'false',
          scheduled_publish_time: String(Math.floor(quando.getTime() / 1000)),
          access_token: await fbTokenFor(c),
        },
      });
      return { modo: 'nativo', id: r.post_id || r.id };
    },
    async publicar(item) {
      const c = contasDe(item.cliente_id);
      const r = await httpJson(`${G()}/${c.fbPageId}/photos`, {
        method: 'POST',
        form: { url: item.arte_url, caption: item.legenda, published: 'true', access_token: await fbTokenFor(c) },
      });
      return { id: r.post_id || r.id };
    },
  },
  instagram: {
    nome: 'Instagram',
    configured: (item) => redesDe(item?.cliente_id).instagram,
    // A API do Instagram não agenda: o agendador do servidor publica na hora marcada.
    async agendar() { return { modo: 'fila' }; },
    async publicar(item) {
      const ig = contasDe(item.cliente_id).igUserId;
      const token = contasDe(item.cliente_id).padrao ? pageToken() : config.meta.token;
      const c = await httpJson(`${G()}/${ig}/media`, { method: 'POST', form: { image_url: item.arte_url, caption: item.legenda, access_token: token } });
      const p = await httpJson(`${G()}/${ig}/media_publish`, { method: 'POST', form: { creation_id: c.id, access_token: token } });
      return { id: p.id };
    },
  },
  // Espaços reservados: preencha quando for integrar.
  linkedin: {
    nome: 'LinkedIn',
    configured: () => false,
    nota: 'Publicação no LinkedIn ainda não implementada (precisa upload de imagem em duas etapas e permissão w_organization_social).',
  },
  tiktok: {
    nome: 'TikTok',
    configured: () => false,
    nota: 'Publicação no TikTok ainda não implementada (exige app aprovado pelo TikTok e, em geral, vídeo).',
  },
};
