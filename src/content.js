import crypto from 'node:crypto';
import { config } from './config.js';
import { store } from './store.js';
import { adapters } from './platforms/social.js';

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

export function createItem(p, by) {
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

export const listItems = (status) => store.content().filter((c) => !status || c.status === status);

export function editItem(id, patch, by) {
  const it = store.getContent(id);
  if (!it) return { error: 'Conteúdo não encontrado.' };
  if (!EDITABLE.includes(it.status)) return { error: `Não dá para editar um conteúdo "${STATUS[it.status]}".` };
  for (const k of ['titulo', 'legenda', 'briefing_arte', 'formato', 'objetivo']) if (patch[k] !== undefined) it[k] = String(patch[k]).trim();
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
export function submitArt(id, { arte_url, observacoes }, by) {
  const it = store.getContent(id);
  if (!it) return { error: 'Conteúdo não encontrado.' };
  if (!['em_arte', 'ajustes'].includes(it.status)) return { error: `Este conteúdo está "${STATUS[it.status]}"; só recebe arte quando está em arte ou com ajustes.` };
  const u = String(arte_url || '').trim();
  if (!/^https:\/\//i.test(u)) return { error: 'Informe o link público (https://) da arte pronta.' };
  it.arte_url = u;
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
  if (it.status !== 'aguardando_aprovacao') return { error: 'Só dá para pedir ajustes enquanto aguarda aprovação.' };
  it.status = 'ajustes';
  it.feedback = String(nota || '').slice(0, 500);
  hist(it, by, `Ajustes pedidos: ${it.feedback || '(sem observação)'}`);
  store.saveContent();
  store.log({ type: 'content_changes', id, by });
  return { item: it };
}

// APROVAÇÃO HUMANA. Só chamada por rota de administrador; não existe ferramenta de IA que aprove.
export async function approveItem(id, by) {
  const it = store.getContent(id);
  if (!it) return { error: 'Conteúdo não encontrado.' };
  if (it.status !== 'aguardando_aprovacao') return { error: `Este conteúdo está "${STATUS[it.status]}", não aguarda aprovação.` };
  if (!it.arte_url) return { error: 'Sem arte registrada.' };
  if (!it.data_publicacao) return { error: 'Defina a data de publicação antes de aprovar.' };
  it.status = 'aprovado';
  it.approvedBy = by; it.approvedAt = now();
  hist(it, by, 'Aprovado por humano.');
  store.saveContent();
  store.log({ type: 'content_approved', id, by });
  return scheduleItem(id, 'mariana');
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
export async function scheduleItem(id, by = 'mariana') {
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
    if (!ad?.configured()) {
      it.canais_status[canal] = { status: 'sem_integracao', detalhe: ad?.nota || `${ad?.nome || canal} não está conectado. Publique manualmente.` };
      continue;
    }
    if (config.dryRun) { it.canais_status[canal] = { status: 'simulado', detalhe: 'Modo simulação: nada foi enviado à rede.' }; continue; }
    try {
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

export function cronograma() {
  return store.content()
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
        try { const r = await adapters[canal].publicar(it); it.canais_status[canal] = { status: 'publicado', detalhe: 'Publicado.', externalId: r.id }; }
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
