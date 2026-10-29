import { store } from './store.js';
import { getCliente } from './content.js';

// Revisão de marca e conformidade da legenda (regras objetivas, sem IA). Só avisa: quem decide é a aprovação humana.
const SUPERLATIVOS = /\b(o melhor|a melhor|os melhores|as melhores|o único|a única|n[ºo]\s?1|número um|100\s?%|garantid[oa]s?|resultado (?:certo|garantido)|sem riscos?|milagr\w+|imperd[ií]vel)\b/gi;
const PROMESSA = /\b(ganhe|fature|lucre|enriqueça|renda extra)\b[^.!?\n]{0,40}\b(r\$\s?\d|\d+\s?(?:mil|%|x))/gi;
const PLACEHOLDER = /\[(?:LINK|PREENCHER|[A-ZÀ-Ú ]{3,20})\]/g;
const EMOJI = /\p{Extended_Pictographic}/gu;
const LIMITE = { instagram: 2200, facebook: 2000, linkedin: 3000, reddit: 38000, tiktok: 2200 };
const lista = (t) => String(t || '').split(/[;,\n]+/).map((x) => x.trim().replace(/^[-•]\s*/, '')).filter((x) => x.length >= 4 && x.length <= 60);

export function revisar(item) {
  const cl = getCliente(item.cliente_id) || store.cliente(item.cliente_id);
  const m = cl?.marca || {};
  const txt = String(item.legenda || ''); const f = [];
  const add = (sev, tema, msg, trecho) => f.push({ sev, tema, msg, ...(trecho ? { trecho: String(trecho).slice(0, 80) } : {}) });

  for (const p of new Set((txt.match(PLACEHOLDER) || []).concat((/ATENÇÃO: há trecho \[PREENCHER\]/.test(item.briefing_arte || '') ? ['[PREENCHER]'] : [])))) add('alta', 'Pendência', 'Há um campo a preencher antes de publicar. Troque por informação real.', p);
  for (const s of new Set((txt.match(SUPERLATIVOS) || []).map((x) => x.toLowerCase()))) add('média', 'Alegação', 'Superlativo ou promessa sem prova. Qualifique ou use só se estiver confirmado.', s);
  if (PROMESSA.test(txt)) add('alta', 'Conformidade', 'Promessa de ganho financeiro: pode exigir aviso legal e revisão humana.');
  for (const termo of lista(m.proibido)) { const re = new RegExp(`\\b${termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}\\b`, 'i'); if (re.test(txt) && termo.split(/\s+/).length <= 4) add('alta', 'Marca', 'Contém algo que o kit da marca proíbe.', termo); }
  if (/(?:\d[\d.,]*\s?(?:%|por cento)|\br\$\s?\d)/i.test(txt) && !/ilustrativ|hipot[eé]tic|exemplo/i.test(txt)) add('média', 'Alegação', 'Número ou valor na legenda: confirme a fonte (ou marque como exemplo ilustrativo).');
  const excl = (txt.match(/!/g) || []).length; if (excl > 2) add('baixa', 'Tom', `${excl} exclamações: reduza para manter o tom da marca.`);
  if (/[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{4,}(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{3,}){3,}/.test(txt)) add('baixa', 'Tom', 'Trecho inteiro em CAIXA ALTA: prefira negrito ou destaque curto.');
  const emo = (txt.match(EMOJI) || []).length; if (emo > 5) add('baixa', 'Tom', `${emo} emojis: use poucos e funcionais.`);
  const tags = (txt.match(/#\w+/g) || []).length;
  for (const c of item.canais || []) {
    const max = LIMITE[c]; if (max && txt.length > max) add('alta', 'Canal', `Legenda passa do limite do ${c} (${txt.length}/${max} caracteres).`);
    if (c === 'linkedin' && tags > 5) add('baixa', 'Canal', 'LinkedIn: use até 3-5 hashtags.');
    if (c === 'reddit' && tags > 0) add('média', 'Canal', 'Reddit: hashtags soam como anúncio; remova.');
    if (c === 'reddit' && /\b(compre|assine|teste gr[aá]tis|criar minha loja|cadastre)/i.test(txt)) add('média', 'Canal', 'Reddit: tom de venda costuma ser removido pelos moderadores. Foque em valor para a comunidade.');
  }
  if (tags > 8) add('baixa', 'Hashtags', `${tags} hashtags: use de 3 a 5.`);
  if (txt.trim().length < 40) add('média', 'Conteúdo', 'Legenda muito curta.');
  const primeira = txt.trim().split('\n')[0] || ''; if (primeira.length > 160) add('baixa', 'Gancho', 'A 1ª linha é longa: o gancho precisa caber antes do "ver mais".');
  if (!/(comente|salve|compartilh|marque|clique|acesse|teste|conhe[cç]a|veja|baixe|fale|link na bio|criar|agende|responda|conte|quer|participe|mande|chame|assine)/i.test(txt)) add('média', 'CTA', 'Não encontrei uma chamada para ação clara.');
  if (/carrossel/i.test(item.formato || '')) {
    const n = item.arte_urls?.length || (item.arte_url ? 1 : 0);
    if (item.arte_url && n < 2) add('média', 'Carrossel', 'Formato carrossel, mas só uma imagem foi registrada: vai sair como post de feed. Envie todas as lâminas.');
    if (!(item.slides?.length >= 2) && !item.arte_url) add('baixa', 'Carrossel', 'Sem roteiro por lâmina. Defina capa, desenvolvimento e CTA final (2 a 10 lâminas).');
    if (item.slides?.length && item.arte_urls?.length > 1 && item.slides.length !== item.arte_urls.length) add('média', 'Carrossel', `Roteiro com ${item.slides.length} lâminas e ${item.arte_urls.length} imagens registradas.`);
  }
  const ordem = { alta: 0, 'média': 1, baixa: 2 };
  f.sort((a, b) => ordem[a.sev] - ordem[b.sev]);
  return { alertas: f, altas: f.filter((x) => x.sev === 'alta').length, medias: f.filter((x) => x.sev === 'média').length, ok: !f.some((x) => x.sev !== 'baixa') };
}
