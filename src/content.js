import crypto from 'node:crypto';
import { config } from './config.js';
import { store } from './store.js';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { adapters } from './platforms/social.js';

const MAX_IMG = 4 * 1024 * 1024;
// Links de exportação (ex.: Canva) expiram. Guardamos uma cópia da imagem e servimos por um link nosso e estável.
async function cacheArt(url, origin) {
  if (origin && url.startsWith(origin + '/media/')) return { url };
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!/^image\/(png|jpe?g|webp)$/.test(type)) throw new Error(`não é uma imagem PNG/JPG (${type || 'tipo desconhecido'})`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_IMG) throw new Error('imagem maior que 4 MB');
  const id = crypto.randomBytes(16).toString('hex');
  store.setMedia(id, { type, data: buf.toString('base64'), at: new Date().toISOString() });
  return { url: `${origin}/media/${id}` };
}

export const CHANNELS = ['instagram', 'facebook', 'linkedin', 'tiktok'];
export const STATUS = {
  em_arte: 'Em arte (Luiz)',
  aguardando_aprovacao: 'Aguardando aprovação',
  ajustes: 'Ajustes pedidos',
  aprovado: 'Aprovado (sem agendamento)',
  agendado: 'Agendado',
  publicado: 'Publicado',
  erro: 'Erro',
  cancelado: 'Cancelado',
};
const EDITABLE = ['em_arte', 'ajustes', 'aguardando_aprovacao'];
const now = () => new Date().toISOString();

// Datas sem fuso são interpretadas em America/Recife (UTC-3, sem horário de verão).
export function parseWhen(v) {
  if (!v) return null;
  let s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T09:00';
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) s += '-03:00';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function hist(item, by, text) {
  (item.historico ||= []).push({ at: now(), by, text });
  item.historico = item.historico.slice(-50);
  item.updatedAt = now();
}

function cleanChannels(c) {
  const list = (Array.isArray(c) ? c : String(c || '').split(',')).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  const bad = list.filter((x) => !CHANNELS.includes(x));
  if (bad.length) return { error: `Canal inválido: ${bad.join(', ')}. Use: ${CHANNELS.join(', ')}.` };
  if (!list.length) return { error: 'Informe ao menos um canal.' };
  return { list: [...new Set(list)] };
}

// Kit mínimo para o time produzir: sem identidade/tom/estilo definidos o Hugo e o Luiz não criam nada para o cliente.
export const kitCompleto = (m = {}) => !!((m.identidade || m.posicionamento) && m.tom_de_voz && (m.estilo_visual || m.regras_visuais) && (m.estilo_comunicacao || m.tom_de_voz));
export function getCliente(ref) {
  const c = store.cliente(ref);
  return c || null;
}

export function createItem(p, by) {
  const cliente = getCliente(p.cliente || p.cliente_id);
  if (!cliente) return { error: `Cliente não encontrado: "${p.cliente || p.cliente_id}". Clientes: ${store.clientes().map((c) => c.nome).join(', ')}.` };
  const titulo = String(p.titulo || '').trim();
  const legenda = String(p.legenda || '').trim();
  const briefing = String(p.briefing_arte || '').trim();
  if (!titulo || !legenda || !briefing) return { error: 'Título, legenda e briefing da arte são obrigatórios.' };
  const ch = cleanChannels(p.canais);
  if (ch.error) return ch;
  let when = null;
  if (p.data_publicacao) {
    when = parseWhen(p.data_publicacao);
    if (!when) return { error: 'Data inválida. Use AAAA-MM-DD ou AAAA-MM-DDTHH:MM.' };
  }
  const item = {
    id: crypto.randomUUID().slice(0, 8),
    titulo, legenda, briefing_arte: briefing,
    cliente_id: cliente.id,
    marca: cliente.nome,
    formato: String(p.formato || 'feed').slice(0, 40),
    objetivo: String(p.objetivo || '').slice(0, 300),
    canais: ch.list,
    data_publicacao: when ? when.toISOString() : null,
    arte_url: '', arte_nota: '',
    status: 'em_arte',
    canais_status: {},
    historico: [],
    createdBy: by, createdAt: now(), updatedAt: now(),
  };
  hist(item, by, 'Pauta criada (legenda + briefing).');
  store.addContent(item);
  store.log({ type: 'content_created', id: item.id, by });
  return { item };
}

export const listItems = (status, cliente) => {
  const id = cliente ? getCliente(cliente)?.id : null;
  return store.content().filter((c) => (!status || c.status === status) && (!id || c.cliente_id === id));
};

export function editItem(id, patch, by) {
  const it = store.getContent(id);
  if (!it) return { error: 'Conteúdo não encontrado.' };
  if (!EDITABLE.includes(it.status)) return { error: `Não dá para editar um conteúdo "${STATUS[it.status]}".` };
  for (const k of ['titulo', 'legenda', 'briefing_arte', 'formato', 'objetivo']) if (patch[k] !== undefined) it[k] = String(patch[k]).trim();
  if (it.rascunho_auto && (patch.legenda !== undefined || patch.briefing_arte !== undefined)) it.rascunho_auto = false; // alguém revisou o texto
  if (patch.canais !== undefined) { const ch = cleanChannels(patch.canais); if (ch.error) return ch; it.canais = ch.list; }
  if (patch.data_publicacao !== undefined) {
    if (!patch.data_publicacao) it.data_publicacao = null;
    else { const w = parseWhen(patch.data_publicacao); if (!w) return { error: 'Data inválida.' }; it.data_publicacao = w.toISOString(); }
  }
  if (patch.arte_url !== undefined) {
    const u = String(patch.arte_url).trim();
    if (u && !/^https:\/\//i.test(u)) return { error: 'O link da arte precisa começar com https:// (e ser público para as redes conseguirem baixar).' };
    it.arte_url = u;
  }
  hist(it, by, 'Conteúdo editado.');
  store.saveContent();
  return { item: it };
}

// Luiz entrega a arte → sobe para aprovação humana.
export async function submitArt(id, { arte_url, observacoes }, by) {
  const it = store.getContent(id);
  if (!it) return { error: 'Conteúdo não encontrado.' };
  if (!['em_arte', 'ajustes'].includes(it.status)) return { error: `Este conteúdo está "${STATUS[it.status]}"; só recebe arte quando está em arte ou com ajustes.` };
  const u = String(arte_url || '').trim();
  if (!/^https:\/\//i.test(u)) return { error: 'Informe o link público (https://) da arte pronta.' };
  it.arte_origem = u;
  it.arte_url = u;
  it.arte_aviso = '';
  const origin = config.publicUrl;
  if (origin) {
    try { it.arte_url = (await cacheArt(u, origin)).url; }
    catch (e) { it.arte_aviso = `Não consegui guardar uma cópia da imagem (${e.message}). Se o link expirar, as redes não conseguirão baixá-la.`; }
  }
  it.arte_nota = String(observacoes || '').slice(0, 500);
  it.status = 'aguardando_aprovacao';
  hist(it, by, 'Arte entregue. Aguardando aprovação humana.');
  store.saveContent();
  store.log({ type: 'content_art', id, by });
  return { item: it };
}

export function requestChanges(id, nota, by) {
  const it = store.getContent(id);
  if (!it) return { error: 'Conteúdo não encontrado.' };
  if (!['em_arte', 'ajustes', 'aguardando_aprovacao'].includes(it.status)) return { error: 'Só dá para pedir ajustes antes da aprovação.' };
  const texto = String(nota || '').trim();
  if (!texto) return { error: 'Descreva o que deve ser ajustado.' };
  it.feedback = ((it.status === 'ajustes' && it.feedback ? it.feedback + ' | ' : '') + texto).slice(0, 1000);
  it.status = 'ajustes';
  hist(it, by, `Ajustes pedidos: ${texto}`);
  store.saveContent();
  store.log({ type: 'content_changes', id, by });
  return { item: it };
}

// APROVAÇÃO HUMANA. Só chamada por rota de administrador; não existe ferramenta de IA que aprove.
export async function approveItem(id, by, opts = {}) {
  const it = store.getContent(id);
  if (!it) return { error: 'Conteúdo não encontrado.' };
  if (it.status !== 'aguardando_aprovacao') return { error: `Este conteúdo está "${STATUS[it.status]}", não aguarda aprovação.` };
  if (!it.arte_url) return { error: 'Sem arte registrada.' };
  const agora = opts.modo === 'agora';
  if (opts.modo && !['agora', 'agendar'].includes(opts.modo)) return { error: 'Modo inválido. Use "agendar" ou "agora".' };
  if (!agora && !it.data_publicacao) return { error: 'Defina a data de publicação antes de aprovar (ou escolha publicar agora).' };
  if (opts.canais !== undefined) {
    const ch = cleanChannels(opts.canais);
    if (ch.error) return ch;
    it.canais = ch.list;
    for (const k of Object.keys(it.canais_status || {})) if (!ch.list.includes(k)) delete it.canais_status[k];
  }
  if (agora) it.data_publicacao = now();
  it.status = 'aprovado';
  it.approvedBy = by; it.approvedAt = now();
  hist(it, by, `Aprovado por humano para: ${it.canais.join(', ')} (${agora ? 'publicar agora' : 'agendar'}).`);
  store.saveContent();
  store.log({ type: 'content_approved', id, by, canais: it.canais, modo: agora ? 'agora' : 'agendar' });
  return scheduleItem(id, 'mariana', { agora });
}

export function cancelItem(id, by) {
  const it = store.getContent(id);
  if (!it) return { error: 'Conteúdo não encontrado.' };
  if (['publicado', 'cancelado'].includes(it.status)) return { error: `Já está "${STATUS[it.status]}".` };
  it.status = 'cancelado';
  hist(it, by, 'Cancelado. (Posts já agendados dentro da rede precisam ser removidos lá.)');
  store.saveContent();
  store.log({ type: 'content_cancelled', id, by });
  return { item: it };
}

// Mariana: só agenda o que foi aprovado por humano.
export async function scheduleItem(id, by = 'mariana', opts = {}) {
  const it = store.getContent(id);
  if (!it) return { error: 'Conteúdo não encontrado.' };
  if (!['aprovado', 'agendado', 'erro'].includes(it.status) || !it.approvedAt) {
    return { error: 'Mariana só agenda conteúdo aprovado por um humano.' };
  }
  const when = new Date(it.data_publicacao);
  it.canais_status ||= {};
  for (const canal of it.canais) {
    const cur = it.canais_status[canal]?.status;
    if (['agendado', 'na_fila', 'publicado'].includes(cur)) continue;
    const ad = adapters[canal];
    if (!ad?.configured(it)) {
      it.canais_status[canal] = { status: 'sem_integracao', detalhe: ad?.nota || `${ad?.nome || canal} não está conectado. Publique manualmente.` };
      continue;
    }
    if (config.dryRun) { it.canais_status[canal] = { status: 'simulado', detalhe: 'Modo simulação: nada foi enviado à rede.' }; continue; }
    try {
      if (opts.agora) {
        if (!ad.publicar) throw new Error(`${ad.nome} não publica direto.`);
        const r = await ad.publicar(it);
        it.canais_status[canal] = { status: 'publicado', detalhe: 'Publicado agora.', externalId: r.id };
        store.log({ type: 'content_published', id, canal, status: 'publicado' });
        continue;
      }
      const r = await ad.agendar(it, when);
      it.canais_status[canal] = r.modo === 'fila'
        ? { status: 'na_fila', detalhe: 'Será publicado automaticamente na data marcada.' }
        : { status: 'agendado', detalhe: 'Agendado dentro da rede.', externalId: r.id };
    } catch (e) {
      it.canais_status[canal] = { status: 'erro', detalhe: e.message };
    }
  }
  settle(it);
  hist(it, by, `Agendamento: ${it.canais.map((c) => `${c}=${it.canais_status[c].status}`).join(', ')}`);
  store.saveContent();
  store.log({ type: 'content_scheduled', id, by, canais: it.canais_status });
  return { item: it };
}

// Recalcula o status geral a partir dos canais.
function settle(it) {
  const st = it.canais.map((c) => it.canais_status?.[c]?.status);
  const active = (s) => ['agendado', 'na_fila'].includes(s);
  if (st.some(active)) it.status = 'agendado';
  else if (st.includes('publicado') && !st.includes('erro')) it.status = 'publicado';
  else if (st.includes('erro')) it.status = 'erro';
  else it.status = 'aprovado'; // nada agendado: sem integração/simulação
}

export function cronograma(cliente) {
  const id = cliente ? getCliente(cliente)?.id : null;
  return store.content().filter((c) => !id || c.cliente_id === id)
    .filter((c) => ['aprovado', 'agendado', 'erro', 'aguardando_aprovacao'].includes(c.status))
    .sort((a, b) => String(a.data_publicacao).localeCompare(String(b.data_publicacao)));
}

// Agendador: roda a cada minuto, publica o que está "na fila" e vencido; marca como publicados os agendados na rede.
export async function tick() {
  const t = Date.now();
  for (const it of store.content()) {
    if (it.status !== 'agendado' || !it.data_publicacao || Date.parse(it.data_publicacao) > t) continue;
    for (const canal of it.canais) {
      const cs = it.canais_status?.[canal];
      if (cs?.status === 'na_fila') {
        const atraso = Math.round((t - Date.parse(it.data_publicacao)) / 60000);
        try { const r = await adapters[canal].publicar(it); it.canais_status[canal] = { status: 'publicado', detalhe: atraso > 5 ? `Publicado com ${atraso} min de atraso (o servidor estava fora do ar).` : 'Publicado.', externalId: r.id }; }
        catch (e) { it.canais_status[canal] = { status: 'erro', detalhe: e.message }; }
        store.log({ type: 'content_published', id: it.id, canal, status: it.canais_status[canal].status });
      } else if (cs?.status === 'agendado') {
        it.canais_status[canal] = { ...cs, status: 'publicado', detalhe: 'Horário passou; a rede publica sozinha.' };
      }
    }
    settle(it);
    hist(it, 'mariana', `Publicação: ${it.status}`);
    store.saveContent();
  }
}

// --- Planejamento semanal (meta de posts por semana) ---
const RECIFE = 3 * 3600e3;
// Segunda-feira (AAAA-MM-DD) da semana de uma data, no horário de Recife.
export function weekStart(d) {
  const t = new Date(d.getTime() - RECIFE);
  const dow = (t.getUTCDay() + 6) % 7; // segunda = 0
  t.setUTCDate(t.getUTCDate() - dow);
  return t.toISOString().slice(0, 10);
}
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// Dias da semana sugeridos conforme a meta do cliente (0 = segunda). 7 posts = todos os dias.
const DIAS = { 1: [2], 2: [1, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6] };

export function planoSemanas(n = 3, clienteRef) {
  const cl = getCliente(clienteRef);
  const meta = cl?.meta_semanal || 3;
  const slots = DIAS[Math.min(Math.max(meta, 1), 7)] || DIAS[7];
  const start = weekStart(new Date());
  const weeks = [];
  for (let i = 0; i < n; i++) {
    const ini = addDays(start, i * 7);
    const items = store.content().filter((c) => c.status !== 'cancelado' && c.cliente_id === cl?.id && c.data_publicacao && weekStart(new Date(c.data_publicacao)) === ini);
    const falta = Math.max(0, meta - items.length);
    const usados = new Set(items.map((c) => new Date(new Date(c.data_publicacao).getTime() - RECIFE).toISOString().slice(0, 10)));
    const livres = slots.map((d) => `${addDays(ini, d)}T11:00`)
      .filter((x) => !usados.has(x.slice(0, 10)) && parseWhen(x).getTime() > Date.now() + 3600e3);
    // Em semana já em andamento só dá para planejar nos horários que ainda não passaram.
    const sug = livres.slice(0, falta);
    weeks.push({ semana_de: ini, semana_ate: addDays(ini, 6), meta, planejados: items.length, faltam: sug.length, datas_sugeridas: sug });
  }
  return weeks;
}

// Pautas iniciais entregues junto com o código (src/seedContent.json). Entram uma única vez e só se a data ainda não passou.
export async function importSeeds() {
  let seeds = [];
  try { seeds = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./seedContent.json', import.meta.url)), 'utf8')); } catch { return 0; }
  let n = 0;
  for (const sd of seeds) {
    if (store.seeded().includes(sd.seed_id)) continue;
    const when = parseWhen(sd.data_publicacao);
    if (!when || when.getTime() < Date.now()) continue;
    const r = createItem(sd, 'hugo');
    if (r.item) { r.item.seed_id = sd.seed_id; store.saveContent(); store.markSeeded(sd.seed_id); n++; }
  }
  // Artes entregues junto com o código: entram em pautas ainda não aprovadas e vão para aprovação humana.
  for (const sd of seeds) {
    if (!sd.arte_url) continue;
    const it = store.content().find((c) => c.seed_id === sd.seed_id || (!c.seed_id && c.titulo === sd.titulo));
    if (!it || !['em_arte', 'ajustes', 'aguardando_aprovacao'].includes(it.status) || it.arte_origem === sd.arte_url) continue;
    const origin = config.publicUrl;
    it.seed_id = sd.seed_id;
    it.arte_origem = sd.arte_url;
    it.arte_aviso = '';
    if (sd.arte_url.startsWith('/')) it.arte_url = `${origin}${sd.arte_url}`;
    else {
      it.arte_url = sd.arte_url;
      if (origin) {
        try { it.arte_url = (await cacheArt(sd.arte_url, origin)).url; }
        catch (e) { it.arte_aviso = `Não consegui guardar uma cópia da imagem (${e.message}). Se o link expirar, use "Registrar arte" com o PNG exportado.`; }
      }
    }
    it.arte_nota = sd.arte_nota || 'Arte entregue pelo Luiz no padrão do kit Disco.';
    it.status = 'aguardando_aprovacao';
    hist(it, 'luiz', 'Arte entregue. Aguardando aprovação humana.');
    store.saveContent(); n++;
  }
  return n;
}

// --- Pedidos feitos no painel (a usuária comanda o time sem abrir o Claude) ---
export function createRequest(p, by) {
  const cliente = getCliente(p.cliente || p.cliente_id);
  if (!cliente) return { error: 'Cliente não encontrado.' };
  const texto = String(p.texto || '').trim();
  if (texto.length < 8) return { error: 'Descreva o pedido (o que o post deve dizer, tema, objetivo).' };
  const ch = p.canais && p.canais.length ? cleanChannels(p.canais) : { list: ['instagram'] };
  if (ch.error) return ch;
  let data = '';
  if (p.data_publicacao) { if (!parseWhen(p.data_publicacao)) return { error: 'Data inválida. Use AAAA-MM-DD ou AAAA-MM-DDTHH:MM.' }; data = p.data_publicacao; }
  const r = { id: crypto.randomBytes(6).toString('hex'), tipo: 'pauta', cliente_id: cliente.id, texto: texto.slice(0, 1500), canais: ch.list, data_publicacao: data, status: 'aberto', por: by, em: now() };
  store.addPedido(r);
  store.log({ type: 'pedido_criado', id: r.id, by });
  return { pedido: r };
}
export const listRequests = (status, cliente) => {
  const id = cliente ? getCliente(cliente)?.id : null;
  return store.pedidos().filter((r) => (!status || r.status === status) && (!id || r.cliente_id === id));
};
export function closeRequest(id, itemId, by) {
  const r = store.pedidos().find((x) => x.id === id);
  if (!r) return { error: 'Pedido não encontrado.' };
  store.updatePedido(id, { status: 'atendido', item_id: itemId || null, atendido_por: by, atendido_em: now() });
  return { pedido: store.pedidos().find((x) => x.id === id) };
}
export function cancelRequest(id, by) {
  const r = store.pedidos().find((x) => x.id === id);
  if (!r) return { error: 'Pedido não encontrado.' };
  if (r.status !== 'aberto') return { error: 'Este pedido já foi atendido ou cancelado.' };
  store.updatePedido(id, { status: 'cancelado', atendido_por: by, atendido_em: now() });
  return { pedido: store.pedidos().find((x) => x.id === id) };
}
