import { store } from './store.js';
import { gerarImagem } from './images.js';
import { config } from './config.js';
import { AGENTS, promptOf, teamInfo } from './team.js';
import { createItem, submitArt, scheduleItem, listItems, cronograma, planoSemanas, listRequests, closeRequest, kitCompleto, getCliente, STATUS } from './content.js';

const view = (c) => ({
  id: c.id, cliente: c.marca, cliente_id: c.cliente_id, titulo: c.titulo, status: c.status, status_texto: STATUS[c.status], canais: c.canais,
  data_publicacao: c.data_publicacao, formato: c.formato, objetivo: c.objetivo,
  legenda: c.legenda, briefing_arte: c.briefing_arte, arte_url: c.arte_url || null, arte_aviso: c.arte_aviso || undefined,
  ajustes_pedidos: c.status === 'ajustes' ? c.feedback : undefined, canais_status: c.canais_status,
});
const wrap = (r) => (r.error ? { status: 'erro', erro: r.error } : { status: 'ok', conteudo: view(r.item) });

// risk 'internal': age só dentro do sistema (nada é gasto nem publicado sem aprovação humana).
export const teamTools = [
  {
    name: 'time_proximas_tarefas', risk: 'read', agent: 'todos',
    description: 'COMECE POR AQUI. O time trabalha como uma squad por cliente (Hugo, Luiz e Mariana atendem cada cliente com a identidade dele). Devolve, por cliente, o que fazer agora: pedidos da usuária, pautas que faltam para bater a meta semanal, artes pendentes e agendamentos a tentar. Execute as tarefas sem pedir permissão: tudo termina na aprovação humana. Antes de criar pauta ou arte de um cliente, chame marca_ver com o nome dele e siga a identidade, o tom e o estilo DAQUELE cliente (nunca misture com o de outro). Com "cliente" filtra um só.',
    params: {
      semanas: { type: 'number', desc: 'Quantas semanas à frente planejar (padrão 2)' },
      cliente: { type: 'string', desc: 'Nome ou id do cliente (opcional; padrão: todos)' },
    },
    handler: async ({ semanas, cliente }) => {
      const n = Math.min(Math.max(Number(semanas) || 2, 1), 6);
      const alvo = cliente ? [getCliente(cliente)].filter(Boolean) : store.clientes();
      if (!alvo.length) return { status: 'erro', erro: `Cliente não encontrado. Clientes: ${store.clientes().map((c) => c.nome).join(', ')}.` };
      const squads = alvo.map((cl) => {
        const por = (st) => listItems(st, cl.id).map((c) => ({ id: c.id, titulo: c.titulo, canais: c.canais, data_publicacao: c.data_publicacao, formato: c.formato, ajustes_pedidos: c.feedback }));
        const pedidos = listRequests('aberto', cl.id).map((r) => ({ pedido_id: r.id, pedido: r.texto, canais: r.canais, data_sugerida: r.data_publicacao || undefined, feito_por: r.por }));
        const base = { cliente: cl.nome, cliente_id: cl.id, meta_semanal: cl.meta_semanal, aguardando_aprovacao_humana: por('aguardando_aprovacao').length };
        if (!kitCompleto(cl.marca)) {
          return { ...base, aguardando_identidade: 'O kit de marca deste cliente ainda não está completo (identidade, tom de voz, estilo visual e estilo de comunicação). NÃO crie pautas nem artes para ele; avise a usuária para preencher na aba Marca do painel.' };
        }
        const plano = planoSemanas(n, cl.id);
        return {
          ...base,
          pedidos_da_usuaria: pedidos.length ? { tarefa: 'PRIORIDADE: pedidos escritos no painel. Hugo cria uma pauta para cada um com hugo_criar_pauta (cliente + pedido_id, que fecha o pedido). Depois o Luiz faz a arte.', pedidos } : undefined,
          hugo: { tarefa: `Criar as pautas que faltam para ${cl.nome} com hugo_criar_pauta (cliente="${cl.nome}"), legenda + briefing da arte, nas datas sugeridas. Use marca_ver e conteudo_listar (deste cliente) para não repetir temas.`, semanas: plano.filter((w) => w.faltam > 0) },
          luiz: { tarefa: `Criar a arte de cada item de ${cl.nome} no padrão visual DELE e registrar com luiz_registrar_arte.`, pendentes: [...por('em_arte'), ...por('ajustes')] },
          mariana: { tarefa: 'Reagendar com mariana_agendar os itens abaixo (aprovados que não foram agendados ou deram erro).', pendentes: [...por('aprovado'), ...por('erro')] },
        };
      });
      return { squads };
    },
  },
  {
    name: 'clientes_listar', risk: 'read', agent: 'todos',
    description: 'Lista os clientes atendidos pelo time, com a meta de posts por semana e se o kit de marca está completo.',
    params: {},
    handler: async () => store.clientes().map((c) => ({ id: c.id, nome: c.nome, meta_semanal: c.meta_semanal, kit_completo: kitCompleto(c.marca) })),
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
    description: 'Devolve o kit de marca de UM cliente (identidade, tom de voz, estilo visual, estilo de comunicação, cores, fontes, regras do logo, links). Luiz deve seguir à risca; Hugo usa o tom e o estilo de comunicação. Cada cliente tem o seu: nunca use o de outro.',
    params: { cliente: { type: 'string', desc: 'Nome ou id do cliente (padrão: Disco)' } },
    handler: async ({ cliente }) => { const cl = getCliente(cliente); if (!cl) return { status: 'erro', erro: `Cliente não encontrado. Clientes: ${store.clientes().map((c) => c.nome).join(', ')}.` }; const b = { cliente: cl.nome, ...cl.marca }; if (b.logo_url?.startsWith('/')) b.logo_url = `${config.publicUrl}${b.logo_url}`; if (Array.isArray(b.referencias_visuais)) b.referencias_visuais = b.referencias_visuais.map((u) => (u.startsWith('/') ? `${config.publicUrl}${u}` : u)); return kitCompleto(cl.marca) ? b : { ...b, aviso: 'Kit da marca incompleto. Peça à administradora para preencher na aba Marca do painel antes de produzir.' }; },
  },
  {
    name: 'conteudo_listar', risk: 'read', agent: 'hugo,luiz,mariana',
    description: 'Lista conteúdos do pipeline. Filtre por status: em_arte (briefings para o Luiz), ajustes, aguardando_aprovacao, aprovado, agendado, publicado, erro, cancelado.',
    params: { status: { type: 'string', desc: 'Filtro de status (opcional)', enum: Object.keys(STATUS) }, cliente: { type: 'string', desc: 'Nome ou id do cliente (opcional)' } },
    handler: async ({ status, cliente }) => listItems(status, cliente).map(view),
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
      cliente: { type: 'string', desc: 'Cliente do post (nome ou id). Obrigatório.', required: true },
      pedido_id: { type: 'string', desc: 'ID do pedido do painel que esta pauta atende (fecha o pedido)' },
    },
    handler: async (a) => {
      const cl = getCliente(a.cliente);
      if (!cl) return { status: 'erro', erro: `Cliente não encontrado. Clientes: ${store.clientes().map((c) => c.nome).join(', ')}.` };
      if (!kitCompleto(cl.marca)) return { status: 'erro', erro: `O kit de marca de ${cl.nome} está incompleto (identidade, tom de voz, estilo visual e de comunicação). Peça à administradora para preencher na aba Marca antes de criar pautas.` };
      const r = createItem(a, 'hugo');
      if (!r.error && a.pedido_id) closeRequest(a.pedido_id, r.item.id, 'hugo');
      return wrap(r);
    },
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
    name: 'luiz_gerar_imagem', risk: 'internal', agent: 'luiz',
    description: 'LUIZ gera com o ChatGPT (OpenAI) uma imagem no estilo da marca. modo=fundo: fundo/ilustração SEM texto, devolve link público para compor no Canva (upload-asset-from-url). modo=arte_completa: arte pronta com o texto informado, copiando o padrão visual das referências da marca (revise cada palavra antes de registrar). Tem teto diário (IMAGE_DAILY_CAP).',
    params: {
      prompt: { type: 'string', desc: 'Descrição da imagem (cena, objetos, clima). Não peça texto na imagem.', required: true },
      formato: { type: 'string', desc: 'retrato (feed 4:5 / story), quadrado ou paisagem', enum: ['retrato', 'quadrado', 'paisagem'] },
      modo: { type: 'string', desc: 'fundo (padrão): imagem sem texto para compor no Canva. arte_completa: arte pronta com texto, no padrão visual de referência da marca', enum: ['fundo', 'arte_completa'] },
      cliente: { type: 'string', desc: 'Cliente (nome ou id; padrão Disco). Define o estilo visual usado.' },
      texto: { type: 'string', desc: 'Só em arte_completa: TODO o texto exato que deve aparecer na arte (títulos, itens, CTA), já revisado em português' },
    },
    handler: async (a) => gerarImagem(a),
  },
  {
    name: 'mariana_agendar', risk: 'internal', agent: 'mariana',
    description: 'MARIANA agenda nas redes um conteúdo JÁ APROVADO por humano (o agendamento normalmente acontece sozinho na aprovação; use para tentar de novo após erro ou depois de conectar um canal). Recusa conteúdo não aprovado.',
    params: { id: { type: 'string', desc: 'ID do conteúdo', required: true } },
    handler: async ({ id }) => wrap(await scheduleItem(id, 'mariana')),
  },
  {
    name: 'mariana_cronograma', risk: 'read', agent: 'mariana',
    description: 'Cronograma de publicações (aguardando aprovação, aprovadas, agendadas), ordenado por data. Com "cliente" mostra só um.',
    params: { cliente: { type: 'string', desc: 'Nome ou id do cliente (opcional)' } },
    handler: async ({ cliente }) => cronograma(cliente).map(view),
  },
];
