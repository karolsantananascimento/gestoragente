import { store } from './store.js';
import { config } from './config.js';
import { AGENTS, promptOf, teamInfo } from './team.js';
import { createItem, submitArt, scheduleItem, listItems, cronograma, planoSemanas, STATUS } from './content.js';

const view = (c) => ({
  id: c.id, titulo: c.titulo, status: c.status, status_texto: STATUS[c.status], canais: c.canais,
  data_publicacao: c.data_publicacao, formato: c.formato, objetivo: c.objetivo,
  legenda: c.legenda, briefing_arte: c.briefing_arte, arte_url: c.arte_url || null, arte_aviso: c.arte_aviso || undefined,
  ajustes_pedidos: c.status === 'ajustes' ? c.feedback : undefined, canais_status: c.canais_status,
});
const wrap = (r) => (r.error ? { status: 'erro', erro: r.error } : { status: 'ok', conteudo: view(r.item) });

// risk 'internal': age só dentro do sistema (nada é gasto nem publicado sem aprovação humana).
export const teamTools = [
  {
    name: 'time_proximas_tarefas', risk: 'read', agent: 'todos',
    description: 'COMECE POR AQUI. Fila de trabalho do time: o que Hugo, Luiz e Mariana devem fazer agora (semanas com menos posts que a meta, artes pendentes, agendamentos a tentar) e o que espera aprovação humana. Execute as tarefas de Hugo e Luiz sem pedir permissão: tudo termina na aprovação humana.',
    params: { semanas: { type: 'number', desc: 'Quantas semanas à frente planejar (padrão 2)' } },
    handler: async ({ semanas }) => {
      const n = Math.min(Math.max(Number(semanas) || 2, 1), 6);
      const plano = planoSemanas(n);
      const por = (s) => listItems(s).map((c) => ({ id: c.id, titulo: c.titulo, canais: c.canais, data_publicacao: c.data_publicacao, formato: c.formato, ajustes_pedidos: c.feedback }));
      return {
        meta_semanal: plano[0]?.meta,
        hugo: { tarefa: 'Criar as pautas que faltam com hugo_criar_pauta (legenda + briefing da arte), usando as datas sugeridas. Consulte marca_ver e conteudo_listar para não repetir temas; varie entre posts de autoridade e de storytelling.', semanas: plano.filter((w) => w.faltam > 0) },
        luiz: { tarefa: 'Criar a arte de cada item no Canva e registrar com luiz_registrar_arte.', pendentes: [...por('em_arte'), ...por('ajustes')] },
        mariana: { tarefa: 'Reagendar com mariana_agendar os itens abaixo (aprovados que não foram agendados ou deram erro).', pendentes: [...por('aprovado'), ...por('erro')] },
        aguardando_aprovacao_humana: por('aguardando_aprovacao').length,
      };
    },
  },
  {
    name: 'time_agentes', risk: 'read', agent: 'todos',
    description: 'Lista o time (Camila, Hugo, Luiz, Mariana) e a função de cada um. Com "agente", devolve também as instruções detalhadas dele.',
    params: { agente: { type: 'string', desc: 'camila, hugo, luiz ou mariana (opcional)', enum: AGENTS.map((a) => a.id) } },
    handler: async ({ agente }) => (agente
      ? { ...teamInfo().find((a) => a.id === agente), instrucoes: promptOf(agente) }
      : teamInfo()),
  },
  {
    name: 'marca_ver', risk: 'read', agent: 'hugo,luiz',
    description: 'Devolve o kit da marca (tom de voz, cores, fontes, regras de uso do logo, links). Luiz deve seguir à risca; Hugo usa o tom de voz.',
    params: {},
    handler: async () => { const b = { ...store.brand() }; if (b.logo_url?.startsWith('/')) b.logo_url = `${config.publicUrl}${b.logo_url}`; return Object.keys(b).length ? b : { aviso: 'Kit da marca ainda vazio. Peça à administradora para preencher na aba Marca do painel.' }; },
  },
  {
    name: 'conteudo_listar', risk: 'read', agent: 'hugo,luiz,mariana',
    description: 'Lista conteúdos do pipeline. Filtre por status: em_arte (briefings para o Luiz), ajustes, aguardando_aprovacao, aprovado, agendado, publicado, erro, cancelado.',
    params: { status: { type: 'string', desc: 'Filtro de status (opcional)', enum: Object.keys(STATUS) } },
    handler: async ({ status }) => listItems(status).map(view),
  },
  {
    name: 'hugo_criar_pauta', risk: 'internal', agent: 'hugo',
    description: 'HUGO cria um item da pauta: título, legenda pronta do post e briefing da arte para o Luiz. O item nasce na etapa "Em arte". Nada é publicado.',
    params: {
      titulo: { type: 'string', desc: 'Título interno da pauta', required: true },
      legenda: { type: 'string', desc: 'Legenda completa do post, com hashtags e chamada para ação', required: true },
      briefing_arte: { type: 'string', desc: 'Briefing para o designer: mensagem central, texto na arte, estilo, formato, referências', required: true },
      canais: { type: 'string[]', desc: 'Canais: instagram, facebook, linkedin, tiktok', required: true },
      data_publicacao: { type: 'string', desc: 'Quando publicar, AAAA-MM-DD ou AAAA-MM-DDTHH:MM (horário de Recife)', required: true },
      formato: { type: 'string', desc: 'feed, carrossel, story, reels (padrão feed)' },
      objetivo: { type: 'string', desc: 'Objetivo do post' },
      marca: { type: 'string', desc: 'Marca/cliente do post (padrão: a marca do kit)' },
    },
    handler: async (a) => wrap(createItem(a, 'hugo')),
  },
  {
    name: 'luiz_registrar_arte', risk: 'internal', agent: 'luiz',
    description: 'LUIZ entrega a arte pronta de uma pauta (link público https da imagem). O conteúdo passa para "Aguardando aprovação" e só avança quando um humano aprovar no painel.',
    params: {
      id: { type: 'string', desc: 'ID do conteúdo', required: true },
      arte_url: { type: 'string', desc: 'Link público https da arte exportada (JPG/PNG)', required: true },
      observacoes: { type: 'string', desc: 'Observações sobre a arte (opcional)' },
    },
    handler: async ({ id, arte_url, observacoes }) => wrap(await submitArt(id, { arte_url, observacoes }, 'luiz')),
  },
  {
    name: 'mariana_agendar', risk: 'internal', agent: 'mariana',
    description: 'MARIANA agenda nas redes um conteúdo JÁ APROVADO por humano (o agendamento normalmente acontece sozinho na aprovação; use para tentar de novo após erro ou depois de conectar um canal). Recusa conteúdo não aprovado.',
    params: { id: { type: 'string', desc: 'ID do conteúdo', required: true } },
    handler: async ({ id }) => wrap(await scheduleItem(id, 'mariana')),
  },
  {
    name: 'mariana_cronograma', risk: 'read', agent: 'mariana',
    description: 'Cronograma de publicações (aguardando aprovação, aprovadas, agendadas), ordenado por data.',
    params: {},
    handler: async () => cronograma().map(view),
  },
];
