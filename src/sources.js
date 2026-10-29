import crypto from 'node:crypto';
import { store } from './store.js';
import { getCliente, createRequest } from './content.js';

// Fontes de pauta: links de Google Docs ou Google Sheets lidos pelo servidor (precisam estar com "qualquer pessoa com o link pode ver").
// Só montamos URLs de exportação do próprio Google a partir do ID; o link informado nunca é buscado diretamente.
const MAX_TEXT = 30000;
const MAX_BYTES = 1_500_000;

export function parseGoogleUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com') return null;
  const m = u.pathname.match(/^\/(document|spreadsheets)\/d\/([A-Za-z0-9_-]{20,})/);
  if (!m) return null;
  const gid = (u.searchParams.get('gid') || u.hash.match(/gid=(\d+)/)?.[1] || '').replace(/\D/g, '');
  return m[1] === 'document'
    ? { tipo: 'doc', id: m[2], exportUrl: `https://docs.google.com/document/d/${m[2]}/export?format=txt` }
    : { tipo: 'sheet', id: m[2], gid, exportUrl: `https://docs.google.com/spreadsheets/d/${m[2]}/export?format=csv${gid ? `&gid=${gid}` : ''}` };
}

async function readBody(res) {
  const reader = res.body.getReader(); const chunks = []; let n = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    n += value.length; if (n > MAX_BYTES) { await reader.cancel(); break; }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function fetchSourceText(p) {
  let res;
  try { res = await fetch(p.exportUrl, { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'Mozilla/5.0 (gestoragente)' } }); }
  catch (e) { return { error: `Não consegui acessar o Google (${e.message}).` }; }
  const ct = res.headers.get('content-type') || '';
  const finalHost = new URL(res.url || p.exportUrl).hostname;
  if (!res.ok || ct.includes('text/html') || /accounts\.google\.com$/.test(finalHost)) {
    return { error: 'Não consegui ler o link. Abra o arquivo no Google → Compartilhar → "Qualquer pessoa com o link" como Leitor, e tente de novo.' };
  }
  let text = (await readBody(res)).replace(/^﻿/, '').replace(/\r\n/g, '\n').trim();
  if (!text) return { error: 'O arquivo está vazio.' };
  const cortado = text.length > MAX_TEXT;
  if (cortado) text = text.slice(0, MAX_TEXT);
  return { text, cortado };
}

const view = (f, full = false) => ({
  id: f.id, tipo: f.tipo, titulo: f.titulo, url: f.url, lido_em: f.lido_em, cortado: !!f.cortado, caracteres: (f.texto || '').length, erro: f.erro || undefined,
  ...(full ? { texto: f.texto } : {}),
});

export const listSources = (clienteRef, full = false) => (getCliente(clienteRef)?.fontes || []).map((f) => view(f, full));

export async function addSource(clienteRef, { url, titulo, criar_pedido = true }, by) {
  const cl = getCliente(clienteRef);
  if (!cl) return { error: 'Cliente não encontrado.' };
  const p = parseGoogleUrl(url);
  if (!p) return { error: 'Use um link de Google Docs ou Google Sheets (docs.google.com/document/... ou /spreadsheets/...).' };
  cl.fontes ||= [];
  if (cl.fontes.some((f) => f.doc_id === p.id && (f.gid || '') === (p.gid || ''))) return { error: 'Este link já foi adicionado a este cliente.' };
  if (cl.fontes.length >= 20) return { error: 'Limite de 20 fontes por cliente. Remova alguma.' };
  const r = await fetchSourceText(p);
  if (r.error) return { error: r.error };
  const f = {
    id: crypto.randomBytes(5).toString('hex'), doc_id: p.id, gid: p.gid || '', tipo: p.tipo,
    titulo: String(titulo || '').trim().slice(0, 100) || (p.tipo === 'doc' ? 'Documento' : 'Planilha') + ' ' + (cl.fontes.length + 1),
    url: String(url).trim().slice(0, 500), texto: r.text, cortado: r.cortado, lido_em: new Date().toISOString(), por: by,
  };
  cl.fontes.push(f); store.saveClientes();
  store.log({ type: 'fonte_adicionada', cliente: cl.id, fonte: f.id, by });
  let pedido;
  if (criar_pedido) {
    const q = createRequest({ cliente: cl.id, texto: `Criar pautas seguindo as recomendações da fonte "${f.titulo}" (${p.tipo === 'doc' ? 'documento' : 'planilha'} no Google; veja fontes_listar).` }, by);
    pedido = q.pedido?.id;
  }
  return { fonte: view(f), pedido_id: pedido };
}

export async function refreshSource(clienteRef, id) {
  const cl = getCliente(clienteRef); const f = cl?.fontes?.find((x) => x.id === id);
  if (!f) return { error: 'Fonte não encontrada.' };
  const r = await fetchSourceText(parseGoogleUrl(f.url) || { exportUrl: '' });
  if (r.error) { f.erro = r.error; store.saveClientes(); return { error: r.error }; }
  Object.assign(f, { texto: r.text, cortado: r.cortado, lido_em: new Date().toISOString(), erro: undefined });
  store.saveClientes();
  return { fonte: view(f) };
}

export function removeSource(clienteRef, id) {
  const cl = getCliente(clienteRef);
  if (!cl?.fontes?.some((x) => x.id === id)) return { error: 'Fonte não encontrada.' };
  cl.fontes = cl.fontes.filter((x) => x.id !== id); store.saveClientes();
  return { ok: true };
}

// Para o time: devolve o texto, relendo se estiver velho (5 min).
export async function sourcesForTeam(clienteRef) {
  const cl = getCliente(clienteRef);
  for (const f of cl?.fontes || []) if (Date.now() - Date.parse(f.lido_em) > 5 * 60e3) await refreshSource(cl.id, f.id).catch(() => {});
  return listSources(clienteRef, true);
}
