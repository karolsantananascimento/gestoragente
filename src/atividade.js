import { store } from './store.js';
import { pendingActions } from './guardrails.js';
import { listItems, listRequests, getCliente } from './content.js';
import { autoRodando, iaComProblema, autoDisponivel } from './agent.js';
import { listarLeads } from './vendas.js';

// O que cada pessoa do time está fazendo agora e o que fez por último (lido do estado real do sistema).
const DIAS = (iso) => { try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Recife' }); } catch { return ''; } };
const nomeCli = (id) => store.cliente(id)?.nome || id || '';
const ROT = {
  proposed: 'Propôs uma ação de tráfego', executed: 'Ação de tráfego executada após aprovação', simulated: 'Ação simulada (modo simulação)', rejected: 'Proposta rejeitada', blocked: 'Ação bloqueada pelos tetos de segurança', failed: 'Ação falhou',
  auto_hugo: 'Hugo criou pautas automaticamente', auto_hugo_erro: 'Hugo não conseguiu atender (erro da IA)', content_created: 'Pauta criada', content_art: 'Arte entregue para aprovação', content_changes: 'Ajustes pedidos na arte', content_approved: 'Conteúdo aprovado por um administrador',
  content_scheduled: 'Conteúdo agendado', content_published: 'Conteúdo publicado', content_cancelled: 'Conteúdo cancelado', pedido_criado: 'Novo pedido de pauta',
  lead_novo: 'Novo lead recebido', lead_qualificado: 'Lead qualificado', lead_humano: 'Conversa passada para um humano', lead_optout: 'Lead pediu para parar', disparo_proposto: 'Disparo proposto', disparo_aprovado: 'Disparo aprovado', disparo_cancelado: 'Disparo cancelado',
};
const POR_AGENTE = {
  camila: ['proposed', 'executed', 'simulated', 'rejected', 'blocked', 'failed'],
  hugo: ['auto_hugo', 'auto_hugo_erro', 'content_created', 'pedido_criado'],
  luiz: ['content_art', 'content_changes'],
  mariana: ['content_approved', 'content_scheduled', 'content_published', 'content_cancelled'],
  felipe: ['lead_novo', 'lead_qualificado', 'lead_humano', 'lead_optout', 'disparo_proposto', 'disparo_aprovado', 'disparo_cancelado'],
};
const recentes = (id) => store.audit().filter((e) => (POR_AGENTE[id] || []).includes(e.type)).slice(0, 8).map((e) => ({
  at: e.at, quando: DIAS(e.at),
  texto: `${ROT[e.type] || e.type}${e.cliente ? ' · ' + nomeCli(e.cliente) : ''}${e.tool ? ' · ' + e.tool : ''}${e.by && e.by !== 'sistema' ? ' · por ' + e.by : ''}${e.erro ? ' · ' + e.erro : ''}`,
}));
const lista = (arr, max = 6) => arr.slice(0, max);

export function atividadeDe(id) {
  const agora = []; let estado = 'livre';
  const set = (e) => { if (e === 'trabalhando' || (e === 'aguardando' && estado === 'livre')) estado = e; };
  if (id === 'camila') {
    const p = pendingActions();
    for (const a of lista(p, 5)) agora.push(`Proposta aguardando aprovação: ${a.summary}`);
    if (p.length) set('aguardando'); else agora.push('Sem propostas de tráfego pendentes. Pronta para analisar e propor ajustes.');
  } else if (id === 'hugo') {
    const rod = store.clientes().filter((c) => autoRodando(c.id));
    for (const c of rod) agora.push(`Escrevendo pautas para ${c.nome} neste momento.`);
    if (rod.length) set('trabalhando');
    const ab = listRequests('aberto');
    for (const r of lista(ab, 5)) agora.push(`Pedido aberto (${nomeCli(r.cliente_id)}): ${String(r.texto).slice(0, 110)}`);
    if (ab.length && !rod.length) set('aguardando');
    if (!autoDisponivel() && ab.length) agora.push('Atende por rascunho automático: a IA do servidor não está ativa (sem chave da Anthropic).');
    else if (autoDisponivel() && iaComProblema()) agora.push('A IA do servidor está com problema (crédito ou chave). Pedidos viram rascunho.');
    if (!agora.length) agora.push('Sem pedidos abertos. Aguardando novas solicitações.');
  } else if (id === 'luiz') {
    const em = [...listItems('em_arte'), ...listItems('ajustes')].sort((a, b) => String(a.data_publicacao || '9').localeCompare(String(b.data_publicacao || '9')));
    for (const i of lista(em, 6)) agora.push(`${i.status === 'ajustes' ? 'Refazer arte (ajustes pedidos)' : 'Arte a criar'}: ${i.titulo} (${nomeCli(i.cliente_id)}${i.data_publicacao ? ', ' + DIAS(i.data_publicacao) : ''})`);
    if (em.length > 6) agora.push(`… e mais ${em.length - 6} na fila.`);
    if (em.length) set('aguardando'); else agora.push('Fila de artes vazia.');
    const aprov = listItems('aguardando_aprovacao').length;
    if (aprov) agora.push(`${aprov} arte(s) entregue(s) aguardando aprovação de um administrador.`);
  } else if (id === 'mariana') {
    const ag = [...listItems('agendado')].sort((a, b) => String(a.data_publicacao).localeCompare(String(b.data_publicacao)));
    for (const i of lista(ag, 5)) agora.push(`Agendado: ${i.titulo} (${nomeCli(i.cliente_id)}, ${DIAS(i.data_publicacao)})`);
    const pend = [...listItems('aprovado'), ...listItems('erro')];
    for (const i of lista(pend, 3)) agora.push(`Precisa de atenção (${i.status}): ${i.titulo}`);
    if (ag.length || pend.length) set(pend.length ? 'trabalhando' : 'aguardando');
    if (!agora.length) agora.push('Nada agendado no momento.');
  } else if (id === 'felipe') {
    const L = listarLeads({});
    const recente = L.filter((l) => l.mensagens.at(-1) && Date.now() - new Date(l.mensagens.at(-1).at).getTime() < 10 * 60e3);
    for (const l of lista(recente, 4)) agora.push(`Em conversa agora: ${l.nome || l.telefone} (${l.canal || 'whatsapp'}), status ${l.status}`);
    if (recente.length) set('trabalhando');
    const q = L.filter((l) => l.status === 'qualificado').length, h = L.filter((l) => l.status === 'humano').length, n = L.filter((l) => l.status === 'novo').length;
    if (q) agora.push(`${q} lead(s) qualificado(s) para a equipe.`);
    if (h) agora.push(`${h} conversa(s) com um humano.`);
    if (n) agora.push(`${n} lead(s) novo(s) aguardando primeiro contato.`);
    const d = store.vendas().disparos.filter((x) => ['pendente', 'aprovado', 'enviando'].includes(x.estado));
    for (const x of d) agora.push(`Disparo "${x.nome}": ${x.estado}, restam ${x.ids.length}.`);
    if (q || h || n || d.length) set('aguardando');
    if (!agora.length) agora.push('Sem leads no momento.');
  }
  return { estado, agora, recentes: recentes(id) };
}
