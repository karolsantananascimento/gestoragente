import { config, socialStatus } from '../config.js';
import { httpJson } from '../http.js';

// Adaptadores das redes sociais usados pela Mariana. Cada um expõe:
//   configured(): bool
//   agendar(item, quando: Date): { modo: 'nativo'|'fila', id? }   (nativo = a rede agenda; fila = nosso agendador publica na hora)
//   publicar(item): { id }
// ATENÇÃO: ainda não testados contra contas reais. Teste primeiro com um post inocente.
const G = () => `https://graph.facebook.com/${config.meta.version}`;
const pageToken = () => config.social.fbPageToken || config.meta.token;

export const adapters = {
  facebook: {
    nome: 'Facebook',
    configured: () => socialStatus().facebook,
    // O Facebook agenda sozinho (de 10 min a 30 dias à frente).
    async agendar(item, quando) {
      const r = await httpJson(`${G()}/${config.social.fbPageId}/photos`, {
        method: 'POST',
        form: {
          url: item.arte_url, caption: item.legenda, published: 'false',
          scheduled_publish_time: String(Math.floor(quando.getTime() / 1000)),
          access_token: config.social.fbPageToken,
        },
      });
      return { modo: 'nativo', id: r.post_id || r.id };
    },
  },
  instagram: {
    nome: 'Instagram',
    configured: () => socialStatus().instagram,
    // A API do Instagram não agenda: o agendador do servidor publica na hora marcada.
    async agendar() { return { modo: 'fila' }; },
    async publicar(item) {
      const ig = config.social.igUserId;
      const token = pageToken();
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
