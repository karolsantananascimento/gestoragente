// Catálogo de formatos de peça: é a expertise do time (Hugo, Luiz, Camila e Mariana) e a fonte única de medidas e regras.
// Quem pede o conteúdo marca o formato; o Luiz cria exatamente nessas medidas.
const T = (id, nome, w, h, extra = {}) => ({ id, nome, w, h, ...extra });
const DISPLAY = [
  T('300x250', 'Retângulo médio', 300, 250, { principal: true }), T('336x280', 'Retângulo grande', 336, 280), T('728x90', 'Leaderboard', 728, 90, { principal: true }),
  T('970x90', 'Leaderboard grande', 970, 90), T('970x250', 'Billboard', 970, 250), T('980x120', 'Panorama', 980, 120), T('930x180', 'Top-hat', 930, 180),
  T('300x600', 'Meia página', 300, 600, { principal: true }), T('300x1050', 'Retrato', 300, 1050), T('160x600', 'Arranha-céu largo', 160, 600, { principal: true }), T('120x600', 'Arranha-céu', 120, 600),
  T('468x60', 'Banner', 468, 60), T('250x250', 'Quadrado', 250, 250), T('200x200', 'Quadrado pequeno', 200, 200),
  T('320x50', 'Banner móvel', 320, 50, { principal: true }), T('320x100', 'Banner móvel grande', 320, 100), T('300x50', 'Banner móvel pequeno', 300, 50),
  T('1200x628', 'Responsivo · paisagem (1,91:1)', 1200, 628, { principal: true }), T('1200x1200', 'Responsivo · quadrado (1:1)', 1200, 1200, { principal: true }), T('960x1200', 'Responsivo · retrato (4:5)', 960, 1200),
  T('1200x1200-logo', 'Logo quadrado', 1200, 1200, { logo: true }), T('1200x300-logo', 'Logo horizontal (4:1)', 1200, 300, { logo: true }),
];
export const FORMATOS = {
  ig_feed: { id: 'ig_feed', grupo: 'Instagram / Facebook', nome: 'Feed (imagem única)', legacy: 'feed', midia: 'imagem', canais: ['instagram', 'facebook'], canva: 'instagram_post',
    tamanhos: [T('1080x1350', '4:5 (principal)', 1080, 1350, { principal: true }), T('1080x1080', '1:1', 1080, 1080), T('1080x566', '1,91:1 paisagem', 1080, 566)],
    regras: 'Use 4:5 (1080x1350) por padrão: ocupa mais tela no feed. Margem de 60 px. Texto curto e grande, legível no celular; uma ideia e um ponto focal. Capa do grid do Instagram corta para 3:4 no perfil: mantenha o essencial no centro. JPG/PNG até 8 MB.' },
  ig_carrossel: { id: 'ig_carrossel', grupo: 'Instagram / Facebook', nome: 'Carrossel (2 a 10 lâminas)', legacy: 'carrossel', midia: 'imagem', canais: ['instagram', 'facebook'], canva: 'instagram_post',
    tamanhos: [T('1080x1350', '4:5 (principal)', 1080, 1350, { principal: true }), T('1080x1080', '1:1', 1080, 1080)],
    regras: 'Todas as lâminas no mesmo tamanho (4:5 recomendado). Capa com gancho, uma ideia por lâmina, última com CTA; contador (01/N) e mesma grade em todas. 2 a 10 lâminas.' },
  ig_story: { id: 'ig_story', grupo: 'Instagram / Facebook', nome: 'Story', legacy: 'story', midia: 'imagem+video', canais: ['instagram', 'facebook'], canva: 'your_story',
    tamanhos: [T('1080x1920', '9:16', 1080, 1920, { principal: true })],
    regras: 'Deixe livres ~250 px no topo (perfil e barra) e ~250 px na base (resposta e botões). Texto no miolo, grande. Figurinhas/links ficam sobre a arte, então não coloque CTA colado na borda. Vídeo até 60 s por cartão.' },
  reels: { id: 'reels', grupo: 'Vídeo vertical', nome: 'Reels (Instagram / Facebook)', legacy: 'reels', midia: 'video', canais: ['instagram', 'facebook'], canva: 'your_story',
    tamanhos: [T('1080x1920', '9:16 vídeo', 1080, 1920, { principal: true }), T('1080x1350', 'Capa visível no grid (4:5 central)', 1080, 1350)],
    regras: 'Vídeo vertical 9:16, 15 a 90 s (ideal 15 a 30 s), 30 fps, MP4/MOV. Gancho nos 3 primeiros segundos, legendas na tela (a maioria assiste sem som). Zona segura: topo ~250 px, base ~340 px e laterais ~65 px livres de texto. A capa aparece no grid em 4:5: centralize o título.' },
  tiktok: { id: 'tiktok', grupo: 'Vídeo vertical', nome: 'TikTok', legacy: 'tiktok', midia: 'video', canais: ['tiktok'], canva: 'your_story',
    tamanhos: [T('1080x1920', '9:16 vídeo', 1080, 1920, { principal: true })],
    regras: 'Vídeo vertical 9:16, 1080x1920, MP4/MOV, ideal 15 a 45 s. Gancho em 1 a 2 s, ritmo rápido, legendas na tela e tom nativo (menos "propaganda"). Zona segura: topo ~130 px, base ~450 px (legenda e música) e direita ~140 px (botões) livres. Legenda até 2200 caracteres.' },
  yt_widescreen: { id: 'yt_widescreen', grupo: 'YouTube', nome: 'YouTube · widescreen (16:9)', legacy: 'youtube', midia: 'video', canais: ['youtube'], canva: 'youtube_thumbnail',
    tamanhos: [T('1920x1080', '16:9 vídeo (Full HD)', 1920, 1080, { principal: true }), T('1280x720', 'Thumbnail (miniatura)', 1280, 720, { principal: true })],
    regras: 'Vídeo horizontal 16:9, 1920x1080 (ou 4K), MP4. Miniatura 1280x720, JPG/PNG até 2 MB: poucas palavras grandes, rosto ou objeto em destaque, contraste alto, sem texto nos cantos (onde aparece a duração). Título até ~60 caracteres e descrição com a chamada nas 2 primeiras linhas.' },
  yt_shorts: { id: 'yt_shorts', grupo: 'YouTube', nome: 'YouTube Shorts (9:16)', legacy: 'shorts', midia: 'video', canais: ['youtube'], canva: 'your_story',
    tamanhos: [T('1080x1920', '9:16 vídeo', 1080, 1920, { principal: true })],
    regras: 'Vídeo vertical 9:16, 1080x1920, até 60 s (recomendado), gancho imediato e loop natural. Zona segura: topo ~180 px, base ~380 px e direita ~150 px livres (título, botões e canal). Inclua #Shorts no título ou na descrição.' },
  google_display: { id: 'google_display', grupo: 'Google Ads', nome: 'Google Display (todos os tamanhos)', legacy: 'display', midia: 'imagem', canais: ['google_ads'], canva: null, variantes: true,
    tamanhos: DISPLAY,
    regras: 'Uma arte por tamanho, mantendo a mesma identidade. JPG, PNG ou GIF estático até 150 KB cada. Logo sempre visível; mensagem em uma frase; botão de CTA claro; texto mínimo de 10 px (tamanhos pequenos pedem 1 só ideia). Fundo claro precisa de borda de 1 px. Banners baixos (728x90, 320x50, 468x60) usam layout horizontal em linha. Anúncio responsivo: envie paisagem 1200x628, quadrado 1200x1200 e, se possível, retrato 960x1200 e logos; evite texto na imagem de fundo. Entrega: um arquivo por tamanho, na ordem dos tamanhos escolhidos.' },
};
export const GRUPOS = ['Instagram / Facebook', 'Vídeo vertical', 'YouTube', 'Google Ads'];
export const formatoPorId = (id) => FORMATOS[String(id || '')] || null;
const LEGACY = { feed: 'ig_feed', carrossel: 'ig_carrossel', story: 'ig_story', reels: 'reels', tiktok: 'tiktok', youtube: 'yt_widescreen', shorts: 'yt_shorts', display: 'google_display' };
export const idDeLegado = (f) => LEGACY[String(f || '').toLowerCase()] || null;
// Tamanhos escolhidos (ids). Vazio/inválido = principais (ou todos, no Google Display, que "domina todos").
export function tamanhosDe(fmt, escolhidos) {
  const f = typeof fmt === 'string' ? FORMATOS[fmt] : fmt; if (!f) return [];
  const ids = (Array.isArray(escolhidos) ? escolhidos : String(escolhidos || '').split(',')).map((x) => String(x).trim()).filter(Boolean);
  const ok = f.tamanhos.filter((t) => ids.includes(t.id));
  if (ok.length) return ok;
  return f.id === 'google_display' ? f.tamanhos.filter((t) => !t.logo) : f.tamanhos.filter((t) => t.principal).slice(0, 1);
}
export function especificacao(fmtId, escolhidos) {
  const f = FORMATOS[fmtId]; if (!f) return null;
  const t = tamanhosDe(f, escolhidos);
  return { formato: f.nome, formato_id: f.id, tipo: f.midia, canais_sugeridos: f.canais, tamanhos: t.map((x) => `${x.w}x${x.h} px (${x.nome})`), regras: f.regras, canva_design_type: f.canva, uma_arte_por_tamanho: !!f.variantes };
}
export const catalogo = () => ({ grupos: GRUPOS, formatos: Object.values(FORMATOS).map(({ regras, ...f }) => ({ ...f, resumo: regras })) });
// Texto compacto para os prompts dos agentes.
export const formatosGuia = () => Object.values(FORMATOS).map((f) => `- ${f.id} · ${f.nome} (${f.midia}): ${f.id === 'google_display' ? 'todos os tamanhos IAB e responsivos (300x250, 336x280, 728x90, 970x90, 970x250, 980x120, 930x180, 300x600, 300x1050, 160x600, 120x600, 468x60, 250x250, 200x200, 320x50, 320x100, 300x50, 1200x628, 1200x1200, 960x1200, logos)' : f.tamanhos.map((t) => `${t.w}x${t.h}`).join(', ')}. ${f.regras}`).join('\n');
// Descobre o formato citado num texto livre (chat/pedido). Sem pista, devolve null.
export function detectarFormato(texto) {
  const t = String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/\b(google )?(display|banner(s)?|gdn)\b|google ads/.test(t)) return 'google_display';
  if (/shorts?\b/.test(t)) return 'yt_shorts';
  if (/youtube|widescreen|16:9|miniatura|thumbnail/.test(t)) return 'yt_widescreen';
  if (/tik ?tok/.test(t)) return 'tiktok';
  if (/reels?\b/.test(t)) return 'reels';
  if (/stor(y|ies)\b/.test(t)) return 'ig_story';
  if (/carrossel|carousel/.test(t)) return 'ig_carrossel';
  if (/\b(feed|post)\b/.test(t)) return 'ig_feed';
  return null;
}
