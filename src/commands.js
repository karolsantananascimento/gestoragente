import { store } from './store.js';
import { detectarFormato } from './formatos.js';
import { getCliente, createRequest, requestChanges, listItems, listRequests, planoSemanas, STATUS, parseWhen } from './content.js';

// Interpretador de comandos da caixa de diálogo (sem IA): entende pedidos comuns em português e age no sistema.
// Criar pauta vira um PEDIDO ao time (quem escreve a pauta é o Hugo); ajuste de criativo é aplicado direto no item.
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const RECIFE = 3 * 3600e3;
const DIAS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
const ymd = (d) => d.toISOString().slice(0, 10);

export function findClientInText(text, fallback) {
  const t = norm(text);
  const hit = store.clientes().filter((c) => t.includes(norm(c.nome)) || t.includes(c.id.replace(/-/g, ' '))).sort((a, b) => b.nome.length - a.nome.length)[0];
  return hit || getCliente(fallback) || getCliente('');
}

// Todos os clientes citados (para pedidos como "crie um post para a Disco e para a Operizy").
export function findClientsInText(text) {
  const t = norm(text);
  const hits = store.clientes().filter((c) => t.includes(norm(c.nome)) || t.includes(c.id.replace(/-/g, ' ')));
  return hits.filter((a) => !hits.some((b) => b !== a && b.nome.length > a.nome.length && norm(b.nome).includes(norm(a.nome))));
}

export function findDate(text) {
  const t = norm(text);
  const hojeRecife = new Date(Date.now() - RECIFE);
  let m = t.match(/\b(20\d\d)-(\d\d)-(\d\d)\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d\d|\d\d))?\b/);
  if (m) {
    let y = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : hojeRecife.getUTCFullYear();
    const d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1])));
    if (!m[3] && d < new Date(hojeRecife.toISOString().slice(0, 10))) d.setUTCFullYear(y + 1);
    return ymd(d);
  }
  if (/\bamanha\b/.test(t)) { const d = new Date(hojeRecife); d.setUTCDate(d.getUTCDate() + 1); return ymd(d); }
  const w = t.match(/\b(domingo|segunda|terca|quarta|quinta|sexta|sabado)\b/);
  if (w) {
    const d = new Date(hojeRecife); const alvo = DIAS.indexOf(w[1]);
    d.setUTCDate(d.getUTCDate() + (((alvo - d.getUTCDay() + 7) % 7) || 7));
    return ymd(d);
  }
  return '';
}

const findChannels = (text) => {
  const t = norm(text); const out = [];
  if (/insta/.test(t)) out.push('instagram');
  if (/facebook|\bface\b/.test(t)) out.push('facebook');
  if (/linkedin/.test(t)) out.push('linkedin');
  if (/tiktok|tik tok/.test(t)) out.push('tiktok');
  if (/\bblog\b/.test(t)) out.push('blog');
  if (/youtube|shorts/.test(t)) out.push('youtube');
  if (/display|banner|google ads/.test(t)) out.push('google_ads');
  if (/reddit/.test(t) && !out.includes('reddit')) out.push('reddit');
  return out;
};

const titleOf = (c) => `"${c.titulo}" (${STATUS[c.status]}, id ${c.id})`;

function findItem(text, cliente) {
  const pool = listItems(null, cliente.id).filter((c) => ['em_arte', 'ajustes', 'aguardando_aprovacao'].includes(c.status));
  const t = norm(text);
  const byId = pool.find((c) => t.includes(c.id.toLowerCase()));
  if (byId) return { item: byId };
  const scored = pool.map((c) => ({ c, s: norm(c.titulo).split(/\W+/).filter((w) => w.length > 3 && t.includes(w)).length })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  if (scored.length && (scored.length === 1 || scored[0].s > scored[1].s)) return { item: scored[0].c };
  if (pool.length === 1) return { item: pool[0] };
  const ord = /primeir/.test(t) ? 0 : /segund/.test(t) ? 1 : /terceir/.test(t) ? 2 : -1;
  if (ord >= 0 && pool.slice().sort((a, b) => String(a.data_publicacao).localeCompare(String(b.data_publicacao)))[ord]) return { item: pool.slice().sort((a, b) => String(a.data_publicacao).localeCompare(String(b.data_publicacao)))[ord] };
  return { pool };
}

export function runCommand({ texto, cliente: clienteRef, by }) {
  const raw = String(texto || '').trim();
  const t = norm(raw);
  if (!t) return { handled: false };
  const cliente = findClientInText(raw, clienteRef);
  if (!cliente) return { handled: false };

  const querCriar = /\b(cri\w+|faz\w*|prepar\w+|mont\w+|ger\w+|escrev\w+|quero|preciso|bora|sugir\w+|plane\w+)\b/.test(t) && /\b(pauta|post|posts|conteudo|carrossel|reels|story|stories|legenda)\b/.test(t);
  if (/\b(aprov\w+|publiqu\w+|agend\w+)\b/.test(t) && !querCriar) {
    return { handled: true, reply: 'Aprovar e publicar só acontece no botão "Aprovar…" da aba Conteúdo, por uma administradora. Posso pedir ajustes ou criar novas pautas por aqui.' };
  }

  // ajustar criativo
  if (/\b(ajust\w+|corrij\w+|troc\w+|mud\w+|refa\w+|altere|alterar|melhor\w+)\b/.test(t) && /\b(arte|criativo|capa|imagem|foto|post|pauta|slide|titulo|cor)\b/.test(t)) {
    const nota = raw.includes(':') ? raw.slice(raw.indexOf(':') + 1).trim() : raw;
    const f = findItem(raw, cliente);
    if (!f.item) {
      const lista = (f.pool || []).map((c) => `• ${titleOf(c)}`).join('\n');
      return { handled: true, reply: f.pool?.length ? `Qual criativo de ${cliente.nome}? Repita o comando citando o título ou o id:\n${lista}` : `${cliente.nome} não tem criativos para ajustar agora (só dá antes da aprovação).` };
    }
    const r = requestChanges(f.item.id, nota, by);
    if (r.error) return { handled: true, reply: r.error };
    return { handled: true, ajuste: f.item.id, cliente_id: cliente.id, reply: `Ajuste registrado em ${titleOf(f.item)}: "${nota}". O Luiz refaz a arte na próxima rodada da squad e ela volta para aprovação.` };
  }

  // listar / status
  if (/\b(list\w+|mostr\w+|quais|status|resumo|situacao|como esta)\b/.test(t) && /\b(pauta|pendente|aprova\w*|plano|semana|squad|fila|posts?)\b/.test(t)) {
    const por = (s) => listItems(s, cliente.id).length;
    const ped = listRequests('aberto', cliente.id).length;
    const falta = planoSemanas(2, cliente.id).reduce((a, w) => a + w.faltam, 0);
    return { handled: true, reply: `${cliente.nome}: ${ped} pedido(s) aberto(s) · ${por('em_arte')} em arte · ${por('ajustes')} em ajustes · ${por('aguardando_aprovacao')} aguardando aprovação · ${por('aprovado') + por('agendado')} aprovados/agendados · ${falta} post(s) faltando para a meta das próximas 2 semanas (${cliente.meta_semanal}/semana).` };
  }

  // criar pauta
  if (/\b(pauta|post|posts|conteudo|carrossel|reels|story|stories|legenda|campanha de conteudo)\b/.test(t) && /\b(cri\w+|faz\w*|prepar\w+|mont\w+|ger\w+|escrev\w+|quero|preciso|necessito|bora|sugir\w+|planej\w+)\b/.test(t) || /^pauta\b/.test(t)) {
    const canais = findChannels(raw); const data = findDate(raw);
    const fmt = detectarFormato(raw);
    const alvos = findClientsInText(raw); const lista = alvos.length > 1 ? alvos : [cliente];
    const pedidos = []; const erros = [];
    for (const c of lista) {
      const r = createRequest({ cliente: c.id, texto: raw, canais, formato_midia: fmt || undefined, data_publicacao: data }, by);
      if (r.error) erros.push(`${c.nome}: ${r.error}`); else pedidos.push(r.pedido);
    }
    if (!pedidos.length) return { handled: true, reply: erros.join(' ') };
    const nomes = pedidos.map((p) => getCliente(p.cliente_id)?.nome).join(', ');
    let reply = `Pedido registrado para ${nomes}${data ? ` (data sugerida ${data.split('-').reverse().join('/')})` : ''}.`;
    if (erros.length) reply += ` Não deu para: ${erros.join(' ')}`;
    if (/\b(agend\w+|aprov\w+|publiqu\w+)\b/.test(t)) reply += ' O agendamento só acontece depois da aprovação humana no botão da aba Conteúdo.';
    return { handled: true, pedidos, pedido: pedidos[0], cliente_id: pedidos[0].cliente_id, reply };
  }
  return { handled: false };
}
