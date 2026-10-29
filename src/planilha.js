import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { store } from './store.js';
import { getCliente, createItem, listItems, kitCompleto } from './content.js';

// Importa pautas já prontas de uma planilha da agência (CSV com colunas ID, Data, Formato, Arte, Legenda, Prompt).
// Cada linha vira um item "Em arte" (Hugo → Luiz → aprovação humana → Mariana). Idempotente: o ID da planilha fica em item.origem.
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const isoDe = (txt) => { const m = String(txt || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null; };
const trunc = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…');

// Devolve as linhas estruturadas ou null se o texto não for uma planilha de pauta.
export function lerPlanilhaPauta(csv) {
  const rows = parseCsv(csv);
  const h = rows.findIndex((r) => { const n = r.map(norm); return n.includes('data') && n.includes('formato') && n.some((x) => x.startsWith('legenda')); });
  if (h < 0) return null;
  const head = rows[h].map(norm);
  const col = (re) => head.findIndex((x) => re.test(x));
  const ix = { id: col(/^id$/), data: col(/^data$/), formato: col(/^formato$/), arte: col(/^arte/), legenda: col(/^legenda/), prompt: col(/prompt|criativo/) };
  const out = [];
  for (const r of rows.slice(h + 1)) {
    const data = isoDe(r[ix.data]); const legenda = (r[ix.legenda] || '').trim();
    if (!data || !legenda) continue;
    out.push({ id: (r[ix.id] || '').trim(), data, formato: (r[ix.formato] || '').trim(), arte: (r[ix.arte] || '').trim(), legenda, prompt: (r[ix.prompt] || '').trim() });
  }
  return out.length ? out : null;
}

const formatoDe = (f) => (/carrossel/i.test(f) ? 'carrossel' : /reels?/i.test(f) ? 'reels' : /stor/i.test(f) ? 'story' : 'feed');
const hojeRecife = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const somaDias = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400_000).toISOString().slice(0, 10);

export function importarLinhas(clienteRef, linhas, { de, ate, fonte = 'planilha', by = 'hugo' } = {}) {
  const cl = getCliente(clienteRef);
  if (!cl) return { error: 'Cliente não encontrado.' };
  if (!kitCompleto(cl.marca)) return { error: `O kit de marca de ${cl.nome} está incompleto. Preencha a aba Marca antes de importar pautas.` };
  const jaTem = new Set(listItems(null, cl.id).map((c) => c.origem).filter(Boolean));
  const criados = [], pulados = [];
  for (const l of linhas) {
    if ((de && l.data < de) || (ate && l.data > ate)) continue;
    const origem = `${fonte}:${l.id || l.data + ':' + trunc(l.legenda, 30)}`;
    if (jaTem.has(origem)) { pulados.push(l.id); continue; }
    const pendente = /\[PREENCHER\]/i.test(l.arte + l.legenda);
    const legenda = l.legenda.replace(/o link:\s*\[LINK\]/i, 'o link da bio.').replace(/\s*\[LINK\]/g, ' Link na bio.').replace(/\s{2,}/g, ' ').trim();
    const primeira = l.arte.split('\n')[0].replace(/^Capa:\s*/i, '').trim();
    const briefing = [
      `Formato: ${l.formato || 'feed'}. Seguir o kit de marca de ${cl.nome} (cores, fontes e logo oficiais).`,
      l.arte ? `TEXTO NA ARTE (como veio da agência, um slide/cena por linha):\n${l.arte}` : '',
      l.prompt ? `PROMPT DO CRIATIVO (agência):\n${l.prompt}` : '',
      `Origem: planilha da agência, item ${l.id || '—'}. Resolver [LINK]/[PREENCHER] antes de publicar.`,
      pendente ? 'ATENÇÃO: há trecho [PREENCHER] (depoimento/caso) que precisa de dado real da cliente antes de publicar.' : '',
    ].filter(Boolean).join('\n\n');
    const r = createItem({ cliente: cl.id, titulo: trunc(`${l.id ? l.id + ' · ' : ''}${primeira}`, 80), legenda, briefing_arte: briefing, canais: ['instagram'], formato: formatoDe(l.formato), data_publicacao: l.data, objetivo: 'Pauta da agência (planilha)' }, by);
    if (r.error) { pulados.push(`${l.id}: ${r.error}`); continue; }
    r.item.origem = origem;
    criados.push(r.item.id);
  }
  if (criados.length) { store.saveContent(); store.log({ type: 'pauta_importada', cliente: cl.id, qtd: criados.length, by }); }
  return { criados: criados.length, pulados: pulados.length, ids: criados };
}

export function importarCsv(clienteRef, csv, opts = {}) {
  const linhas = lerPlanilhaPauta(csv);
  if (!linhas) return { error: 'Não reconheci colunas Data, Formato e Legenda na planilha.' };
  return importarLinhas(clienteRef, linhas, opts);
}

// Arquivos src/pautas/<cliente>-*.csv entram sozinhos: só os próximos 7 dias (a partir de amanhã), sem repetir.
export function importarPautasDeArquivo() {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pautas');
  if (!fs.existsSync(dir)) return [];
  const de = somaDias(hojeRecife(), 1), ate = somaDias(hojeRecife(), 7);
  const res = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.csv'))) {
    const cl = getCliente(f.split('-')[0]);
    if (!cl || cl.id !== f.split('-')[0]) continue;
    res.push({ arquivo: f, cliente: cl.nome, ...importarCsv(cl.id, fs.readFileSync(path.join(dir, f), 'utf8'), { de, ate, fonte: f.replace(/\.csv$/, '') }) });
  }
  return res;
}
