import { config, socialStatus } from '../config.js';
import { httpJson } from '../http.js';
import { store } from '../store.js';
import * as reddit from './reddit.js';
import * as linkedin from './linkedin.js';

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
    redditSub: own.reddit_subreddit || '',
    linkedinAuthor: own.linkedin_author || (padrao ? config.social.linkedinAuthor : ''),
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
    facebook: !!(c.fbPageId && (tok || (c.padrao && base.facebook))),
    instagram: !!(c.igUserId && tok),
    linkedin: !!(c.linkedinAuthor && linkedin.conectado()), tiktok: false,
    reddit: !!(c.redditSub && reddit.conectado()),
  };
}

// ---------- mídia e erros ----------
const VIDEO = /\.(mp4|mov)(\?|$)/i;
const midia = (item) => {
  const urls = (item.arte_urls?.length ? item.arte_urls : [item.arte_url]).filter(Boolean);
  return { urls, video: urls.length === 1 && VIDEO.test(urls[0]), carrossel: urls.length > 1 };
};
const DICAS = [
  [/\b190\b|access token|session has expired|invalid oauth/i, 'O token do Meta expirou ou é inválido. Gere um novo token do usuário do sistema e atualize META_ACCESS_TOKEN no Render.'],
  [/\(#?(10|200|283)\)|permission|permissão|not authorized/i, 'Faltam permissões. O token precisa de pages_manage_posts, pages_read_engagement, instagram_basic e instagram_content_publish, e o usuário do sistema precisa ter a página e a conta do Instagram atribuídas com controle total.'],
  [/9004|2207052|media.*(download|fetch)|could not be fetched/i, 'A rede não conseguiu baixar a imagem. O link da arte precisa ser público e abrir sem login.'],
  [/2207026|unsupported|format/i, 'Formato de mídia não aceito pelo Instagram (use JPEG para imagem, MP4 para vídeo).'],
  [/2207032|2207027|not ready|ainda processando/i, 'O Instagram ainda estava processando a mídia. Tente de novo em instantes.'],
  [/aspect ratio|proporção/i, 'Proporção fora do aceito pelo Instagram (entre 4:5 e 1,91:1).'],
];
const comDica = (e) => { const d = DICAS.find(([re]) => re.test(e.message)); return d ? new Error(`${e.message} → ${d[1]}`) : e; };
async function arteAcessivel(url) {
  let r;
  try { r = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { range: 'bytes=0-0' } }); } catch (e) { throw new Error(`O link da arte não abriu (${e.message}). Registre a arte de novo.`); }
  if (!(r.ok || r.status === 206)) throw new Error(`O link da arte respondeu HTTP ${r.status}: ele precisa ser público. Registre a arte de novo.`);
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function esperarContainer(id, token, tentativas = 40) {
  for (let i = 0; i < tentativas; i++) {
    const r = await httpJson(`${G()}/${id}?fields=status_code,status&access_token=${encodeURIComponent(token)}`);
    if (r.status_code === 'FINISHED') return;
    if (r.status_code === 'ERROR' || r.status_code === 'EXPIRED') throw new Error(`O Instagram recusou a mídia (${r.status || r.status_code}).`);
    await espera(3000);
  }
  throw new Error('O Instagram demorou demais para processar a mídia (2 min). Tente publicar de novo.');
}

export const adapters = {
  facebook: {
    nome: 'Facebook',
    configured: (item) => redesDe(item?.cliente_id).facebook,
    // O Facebook agenda sozinho (de 10 min a 30 dias à frente) para foto única.
    // Fora dessa janela, ou com vídeo/carrossel, o servidor publica na hora marcada.
    async agendar(item, quando) {
      const ahead = quando.getTime() - Date.now();
      const m = midia(item);
      if (ahead < 11 * 60e3 || ahead > 29 * 86400e3 || m.video || m.carrossel) return { modo: 'fila' };
      try {
        const c = contasDe(item.cliente_id);
        await arteAcessivel(item.arte_url);
        const r = await httpJson(`${G()}/${c.fbPageId}/photos`, {
          method: 'POST',
          form: { url: item.arte_url, caption: item.legenda, published: 'false', scheduled_publish_time: String(Math.floor(quando.getTime() / 1000)), access_token: await fbTokenFor(c) },
        });
        return { modo: 'nativo', id: r.post_id || r.id };
      } catch (e) { throw comDica(e); }
    },
    async publicar(item) {
      try {
        const c = contasDe(item.cliente_id); const m = midia(item); const access_token = await fbTokenFor(c);
        await arteAcessivel(m.urls[0]);
        if (m.video) { const r = await httpJson(`${G()}/${c.fbPageId}/videos`, { method: 'POST', form: { file_url: m.urls[0], description: item.legenda, access_token } }); return { id: r.id }; }
        if (m.carrossel) {
          const ids = [];
          for (const u of m.urls) { const f = await httpJson(`${G()}/${c.fbPageId}/photos`, { method: 'POST', form: { url: u, published: 'false', access_token } }); ids.push(f.id); }
          const form = { message: item.legenda, access_token }; ids.forEach((id, i) => { form[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id }); });
          const r = await httpJson(`${G()}/${c.fbPageId}/feed`, { method: 'POST', form }); return { id: r.id };
        }
        const r = await httpJson(`${G()}/${c.fbPageId}/photos`, { method: 'POST', form: { url: m.urls[0], caption: item.legenda, published: 'true', access_token } });
        return { id: r.post_id || r.id };
      } catch (e) { throw comDica(e); }
    },
  },
  instagram: {
    nome: 'Instagram',
    configured: (item) => redesDe(item?.cliente_id).instagram,
    // A API do Instagram não agenda: o agendador do servidor publica na hora marcada.
    async agendar() { return { modo: 'fila' }; },
    async publicar(item) {
      try {
        const c = contasDe(item.cliente_id); const ig = c.igUserId;
        const token = c.padrao ? pageToken() : config.meta.token;
        const m = midia(item); const f = String(item.formato || '').toLowerCase();
        for (const u of m.urls) await arteAcessivel(u);
        const cria = (form) => httpJson(`${G()}/${ig}/media`, { method: 'POST', form: { ...form, access_token: token } });
        let nota = ''; let container;
        if (m.carrossel) {
          const filhos = [];
          for (const u of m.urls) { const x = await cria({ image_url: u, is_carousel_item: 'true' }); await esperarContainer(x.id, token); filhos.push(x.id); }
          container = await cria({ media_type: 'CAROUSEL', children: filhos.join(','), caption: item.legenda });
        } else if (m.video) {
          container = await cria({ media_type: f === 'story' ? 'STORIES' : 'REELS', video_url: m.urls[0], ...(f === 'story' ? {} : { caption: item.legenda }) });
        } else if (f === 'story') {
          container = await cria({ media_type: 'STORIES', image_url: m.urls[0] }); nota = 'Story publicado sem legenda (o Instagram não aceita legenda em stories).';
        } else {
          container = await cria({ image_url: m.urls[0], caption: item.legenda });
          if (f === 'reels') nota = 'Reels precisa de vídeo: como só havia imagem, foi publicado como post de feed.';
          else if (f === 'carrossel') nota = 'Carrossel com uma só imagem: publicado como post de feed (registre todos os slides para publicar o carrossel).';
        }
        await esperarContainer(container.id, token);
        const p = await httpJson(`${G()}/${ig}/media_publish`, { method: 'POST', form: { creation_id: container.id, access_token: token } });
        return { id: p.id, nota };
      } catch (e) { throw comDica(e); }
    },
  },
  reddit: {
    nome: 'Reddit',
    configured: (item) => redesDe(item?.cliente_id).reddit,
    // O Reddit não agenda pela API: o agendador do servidor publica na hora marcada.
    async agendar() { return { modo: 'fila' }; },
    async publicar(item) { return reddit.publicar(item, contasDe(item.cliente_id).redditSub); },
  },
  // Espaços reservados: preencha quando for integrar.
  linkedin: {
    nome: 'LinkedIn',
    configured: (item) => redesDe(item?.cliente_id).linkedin,
    // O LinkedIn não agenda pela API: o agendador do servidor publica na hora marcada.
    async agendar() { return { modo: 'fila' }; },
    async publicar(item) { return linkedin.publicar(item, contasDe(item.cliente_id).linkedinAuthor); },
  },
  tiktok: {
    nome: 'TikTok',
    configured: () => false,
    nota: 'Publicação no TikTok ainda não implementada (exige app aprovado pelo TikTok e, em geral, vídeo).',
  },
};

// ---------- diagnóstico e descoberta de contas ----------
const NECESSARIAS = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish'];
export async function diagnostico(clienteId) {
  const tok = config.meta.token || config.social.fbPageToken;
  const out = { token: { ok: false }, permissoes: { concedidas: [], faltam: [] }, paginas: [], cliente: {}, dicas: [] };
  const c = contasDe(clienteId);
  out.cliente = { nome: store.cliente(clienteId)?.nome || '', fb_page_id: c.fbPageId || '', ig_user_id: c.igUserId || '', padrao: c.padrao };
  if (!tok) { out.dicas.push('Falta META_ACCESS_TOKEN no Render (token do usuário do sistema).'); return out; }
  const q = (path) => httpJson(`${G()}/${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(tok)}`);
  try { const me = await q('me?fields=id,name'); out.token = { ok: true, nome: me.name || me.id }; }
  catch (e) { out.token = { ok: false, erro: e.message }; out.dicas.push(comDica(e).message); return out; }
  try {
    const perms = await q('me/permissions');
    out.permissoes.concedidas = (perms.data || []).filter((p) => p.status === 'granted').map((p) => p.permission);
    out.permissoes.faltam = NECESSARIAS.filter((p) => !out.permissoes.concedidas.includes(p));
    if (out.permissoes.faltam.length) out.dicas.push(`Permissões que faltam no token: ${out.permissoes.faltam.join(', ')}. Sem elas a publicação falha.`);
  } catch { /* alguns tokens de sistema não listam permissões */ }
  try {
    let after = '';
    for (let i = 0; i < 5; i++) {
      const r = await q(`me/accounts?fields=id,name,instagram_business_account{id,username}&limit=100${after ? '&after=' + encodeURIComponent(after) : ''}`);
      for (const p of r.data || []) out.paginas.push({ id: p.id, nome: p.name, ig: p.instagram_business_account ? { id: p.instagram_business_account.id, usuario: p.instagram_business_account.username } : null });
      after = r.paging?.next ? r.paging.cursors?.after || '' : ''; if (!after) break;
    }
  } catch (e) { out.dicas.push(`Não consegui listar as páginas: ${comDica(e).message}`); }
  if (!out.paginas.length && out.token.ok) out.dicas.push('O token não enxerga nenhuma página. No Gerenciador de Negócios, atribua as páginas e contas do Instagram ao usuário do sistema com controle total.');
  if (out.cliente.fb_page_id) { const hit = out.paginas.find((p) => p.id === out.cliente.fb_page_id); out.cliente.fb_visivel = !!hit; if (!hit && out.paginas.length) out.dicas.push(`A página ${out.cliente.fb_page_id} deste cliente não aparece para o token.`); }
  if (out.cliente.ig_user_id) { const hit = out.paginas.find((p) => p.ig?.id === out.cliente.ig_user_id); out.cliente.ig_visivel = !!hit; if (!hit && out.paginas.length) out.dicas.push(`A conta de Instagram ${out.cliente.ig_user_id} não está ligada a nenhuma página visível ao token (o Instagram precisa ser profissional e vinculado a uma página).`); }
  if (!out.cliente.ig_user_id) out.dicas.push('Este cliente ainda não tem o ID do Instagram. Escolha uma conta na lista abaixo.');
  return out;
}
