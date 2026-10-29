import { store } from './store.js';
import { getCliente, createItem, closeRequest, planoSemanas, listItems, kitCompleto } from './content.js';

// "Hugo básico": cria na hora um RASCUNHO de pauta a partir do pedido + kit do cliente, sem precisar de IA.
// Serve para o pedido nunca ficar parado. O rascunho vem marcado; o Hugo com IA (chave da Anthropic ou conector do Claude) o refina.
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const trunc = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…');

function tema(texto) {
  let t = String(texto || '').replace(/\s+/g, ' ').trim();
  const m = t.match(/\b(?:sobre|a respeito de|tema|falando de|falando sobre|com o tema)\b[:\s]+(.+)$/i);
  if (m) t = m[1];
  else t = t.replace(/^.*?\b(?:post|posts|pauta|conteudo|conteúdo|carrossel|reels|story|stories|legenda)\b\s*(?:de|para|da|do|com)?\s*/i, '');
  t = t.replace(/\b(?:para|pra)\s+(?:a\s+|o\s+)?[A-ZÀ-Ú][\wÀ-ú]+(?:\s+[A-ZÀ-Ú][\wÀ-ú]+)?/g, '') // "para a Operizy"
    .replace(/\b(?:no|na|em)\s+(?:instagram|facebook|linkedin|tiktok)(?:\s+e\s+(?:instagram|facebook|linkedin|tiktok))?/gi, '')
    .replace(/\b(?:na|para|pra|no|em|dia)\s+(?:segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo|amanhã|amanha)\b/gi, '')
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b20\d\d-\d\d-\d\d\b/g, '')
    .replace(/\s{2,}/g, ' ').replace(/[\s,.;:-]+$/g, '').trim();
  return t.length >= 4 ? t : String(texto).trim();
}

const formatoDe = (t) => (/carrossel/i.test(t) ? 'carrossel' : /reels?/i.test(t) ? 'reels' : /stor(y|ies)/i.test(t) ? 'story' : 'feed');
const quoted = (s) => [...String(s || '').matchAll(/"([^"]{3,60})"/g)].map((m) => m[1]);
const first = (s, n = 400) => trunc(String(s || '').replace(/\s+/g, ' ').trim(), n);

export function montarRascunho(pedido, cliente, fontes = []) {
  const m = cliente.marca || {};
  const assunto = tema(pedido.texto);
  const formato = formatoDe(pedido.texto);
  const cta = quoted(m.estilo_comunicacao).find((c) => /criar|come|testar|falar|ver|conhe|agende|solicit/i.test(c)) || quoted(m.estilo_comunicacao)[0] || 'Fale com a gente';
  const tags = (String(m.estilo_comunicacao || '').match(/#\w+/g) || []).slice(0, 5).join(' ');
  const titulo = trunc(cap(assunto), 80);
  const legenda = [
    `${cap(assunto)}.`,
    '',
    'Vale prestar atenção nisso. Salve este post para voltar depois e compartilhe com quem precisa ver.',
    '',
    `👉 ${cta}.`,
    tags,
  ].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n').trim();
  const briefing = [
    `Peça de ${formato} sobre: ${assunto}.`,
    `Mensagem central: ${cap(assunto)}. Título curto e grande na arte (máx. 8 palavras), no padrão visual do cliente. CTA: ${cta}.`,
    m.estilo_visual ? `Estilo visual de ${cliente.nome}: ${first(m.estilo_visual)}` : '',
    m.cores ? `Cores: ${first(m.cores.replace(/\n/g, '; '), 300)}` : '',
    m.fontes ? `Fontes: ${first(m.fontes.replace(/\n/g, '; '), 250)}` : '',
    m.proibido ? `Evitar: ${first(m.proibido, 250)}` : '',
    fontes.length ? `Base: fonte(s) de pauta "${fontes.map((f) => f.titulo).join('", "')}" (veja o painel).` : '',
    'Origem: rascunho automático a partir do pedido; o Hugo com IA pode refinar o texto e o briefing.',
  ].filter(Boolean).join('\n');
  return { titulo, legenda, briefing_arte: briefing, formato, canais: pedido.canais?.length ? pedido.canais : ['instagram'] };
}

export function criarRascunhoDoPedido(pedido, by = 'hugo-auto') {
  const cl = getCliente(pedido.cliente_id);
  if (!cl) return { error: 'Cliente não encontrado.' };
  if (!kitCompleto(cl.marca)) return { error: `O kit de marca de ${cl.nome} está incompleto. Preencha a aba Marca para o time criar pautas.` };
  let data = pedido.data_publicacao;
  if (!data) data = planoSemanas(3, cl.id).flatMap((w) => w.datas_sugeridas)[0] || '';
  const d = montarRascunho(pedido, cl);
  const r = createItem({ cliente: cl.id, titulo: d.titulo, legenda: d.legenda, briefing_arte: d.briefing_arte, canais: d.canais, formato: d.formato, data_publicacao: data }, by);
  if (r.error) return r;
  r.item.rascunho_auto = true;
  store.saveContent();
  closeRequest(pedido.id, r.item.id, by);
  return { item: r.item, data };
}
