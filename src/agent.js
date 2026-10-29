import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { agentTools, callTool } from './tools.js';
import { toJsonSchema } from './schema.js';
import { pendingActions } from './guardrails.js';
import { store } from './store.js';
import { listItems, kitCompleto, listRequests, planoSemanas } from './content.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const prompt = (n) => fs.readFileSync(path.join(here, '..', 'prompts', `${n}.md`), 'utf8');
const masterPrompt = () => `${prompt('master')}\n\n---\n${prompt('time')}`;

const sessions = new Map(); // sessionId -> messages[]
const MAX_TURNS = 10;       // iterações de ferramenta por mensagem
const MAX_HISTORY = 40;     // mensagens mantidas por sessão

let client;
const anthropic = () => (client ??= new Anthropic({ apiKey: config.anthropicKey }));

const toolDefs = agentTools.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: toJsonSchema(t.params || {}),
}));

function system(clienteNome = '') {
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Recife', dateStyle: 'full' });
  const modo = config.dryRun
    ? 'MODO SIMULAÇÃO: nenhuma alteração será feita nas contas reais, mesmo após aprovação.'
    : 'MODO REAL: ações aprovadas alteram contas reais.';
  const tetos = `Tetos ativos: orçamento diário máx. R$ ${config.caps.maxDailyBudgetBRL}, aumento máx. +${config.caps.maxBudgetIncreasePct}% por ação, até ${config.caps.maxActivationsPerDay} ativações/dia.`;
  return `${masterPrompt()}\n\n---\nHoje é ${hoje}. ${modo} ${tetos}${clienteNome ? `\nCliente em foco no painel: ${clienteNome}. Para pautas, pedidos e artes use sempre cliente="${clienteNome}" (a menos que a usuária cite outro) e siga o kit de marca dele (marca_ver).` : ''}`;
}

// Automação: o Hugo (IA do próprio servidor) atende os pedidos abertos de um cliente criando as pautas.
// Só usa ferramentas de equipe (nada de anúncios, nada de aprovação). A arte continua com o Luiz no Canva (conector do Claude).
const TEAM_AUTO = ['conteudo_revisar', 'hugo_atualizar_pauta', 'pedidos_listar', 'marca_ver', 'fontes_listar', 'conteudo_listar', 'hugo_criar_pauta', 'time_proximas_tarefas'];
const autoDefs = toolDefs.filter((t) => TEAM_AUTO.includes(t.name));
const running = new Set();
export const autoDisponivel = () => !!config.anthropicKey;
// Estado da IA: erros de chave/crédito viram aviso claro e fazem o sistema usar o rascunho sem IA em vez de falhar calado.
export const iaStatus = { erro: '', at: 0 };
export function msgIA(e) {
  const m = String(e?.message || e || '');
  if (/credit balance|billing|purchase credits/i.test(m)) return 'A conta da API da Anthropic está sem crédito. Adicione créditos em console.anthropic.com → Plans & Billing; enquanto isso o sistema cria rascunhos sem IA.';
  if (/401|invalid x-api-key|authentication|invalid api key/i.test(m)) return 'A chave ANTHROPIC_API_KEY foi recusada (inválida ou revogada). Gere outra em console.anthropic.com e atualize no Render.';
  if (/429|rate.?limit|overloaded/i.test(m)) return 'A API da Anthropic está limitando as chamadas agora. Tente de novo em instantes.';
  return m.slice(0, 200);
}
export const marcarIA = (e) => { if (!e) { iaStatus.erro = ''; return; } iaStatus.erro = msgIA(e); iaStatus.at = Date.now(); };
// IA "com problema" só por 10 min: depois tenta de novo.
export const iaComProblema = () => !!iaStatus.erro && Date.now() - iaStatus.at < 10 * 60e3;
export const autoRodando = (id) => running.has(id);
// Roda todos os clientes com kit completo (uso: início do servidor e rotina diária).
export async function rodarTodos(opts) {
  const out = [];
  for (const c of store.clientes()) out.push({ cliente: c.nome, ...(await atenderPedidos(c.id, opts)) });
  return out;
}

export async function atenderPedidos(clienteId, { completarMeta = false } = {}) {
  if (!config.anthropicKey) return { status: 'sem_chave' };
  if (running.has(clienteId)) return { status: 'ja_rodando' };
  const cl = store.cliente(clienteId);
  if (!cl) return { status: 'erro', erro: 'Cliente não encontrado.' };
  if (!kitCompleto(cl.marca)) return { status: 'bloqueado', motivo: `O kit de marca de ${cl.nome} está incompleto (identidade, tom de voz, estilo visual e estilo de comunicação). Preencha na aba Marca.` };
  const faltam = completarMeta ? planoSemanas(2, clienteId).reduce((a, w) => a + w.faltam, 0) : 0;
  if (!listRequests('aberto', clienteId).length && !faltam) return { status: 'nada_a_fazer' };
  running.add(clienteId);
  const antes = listItems(null, clienteId).length;
  try {
    const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Recife', dateStyle: 'full' });
    const sys = `${prompt('hugo')}\n\n---\n${prompt('marketing')}\n\n---\n${prompt('squad')}\n\nHoje é ${hoje}. Você é o Hugo rodando automaticamente dentro do sistema. Use só as ferramentas disponíveis. Nunca aprove nem publique nada.`;
    const history = [{ role: 'user', content: `Atenda agora TODOS os pedidos abertos do cliente "${cl.nome}": chame pedidos_listar (cliente) e marca_ver; se houver fontes_de_pauta chame fontes_listar; para cada pedido crie a pauta com hugo_criar_pauta (cliente, pedido_id, canais, data_publicacao no formato AAAA-MM-DDTHH:MM em horário de Recife, formato, legenda completa com CTA e hashtags no tom do cliente, briefing_arte detalhado). Se o pedido não trouxer data, use as datas sugeridas de time_proximas_tarefas.${completarMeta ? ' Depois, chame time_proximas_tarefas (cliente) e crie também as pautas que faltam para bater a meta semanal, nas datas sugeridas, sem repetir temas já existentes (conteudo_listar).' : ''} Ao final responda com uma linha por pauta criada.` }];
    for (let turn = 0; turn < 14; turn++) {
      const res = await anthropic().messages.create({ model: config.model, max_tokens: 3500, system: sys, tools: autoDefs, messages: history });
      history.push({ role: 'assistant', content: res.content });
      const uses = res.content.filter((b) => b.type === 'tool_use');
      if (res.stop_reason !== 'tool_use' || !uses.length) break;
      const results = [];
      for (const u of uses) {
        const out = TEAM_AUTO.includes(u.name) ? await callTool(u.name, u.input, 'auto:hugo') : { status: 'erro', erro: 'Ferramenta não permitida na automação.' };
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 30000) });
      }
      history.push({ role: 'user', content: results });
    }
    const criadas = listItems(null, clienteId).length - antes;
    store.log({ type: 'auto_hugo', cliente: clienteId, pautas_criadas: criadas });
    marcarIA(null);
    return { status: 'ok', criadas };
  } catch (e) {
    store.log({ type: 'auto_hugo_erro', cliente: clienteId, erro: String(e.message).slice(0, 200) });
    marcarIA(e);
    return { status: 'erro', erro: msgIA(e) };
  } finally { running.delete(clienteId); }
}

export async function chat(sessionId, userMessage, who = 'chat', clienteNome = '') {
  if (!config.anthropicKey) {
    return { reply: 'Entendo estes comandos mesmo sem IA: "criar pauta de [tema] para [cliente] na quinta", "ajustar criativo [título]: trocar a foto", "listar pauta"; e, para o Meta Ads: "pausar campanha \"nome\"", "ativar campanha \"nome\"", "orçamento da campanha \"nome\" para 50" e "aumentar orçamento da campanha \"nome\" em 10%". Para conversar livremente sobre campanhas, configure ANTHROPIC_API_KEY no Render, ou use o agente dentro do Claude pelo conector "Agente de Tráfego". Os botões acima (Contas, Campanhas e Desempenho do Meta) também funcionam.', pending: pendingActions() };
  }
  if (iaComProblema()) return { reply: `A IA está indisponível agora. ${iaStatus.erro}\n\nOs comandos fixos continuam funcionando (criar pauta, ajustar criativo, listar pauta, pausar/ativar campanha e orçamento).`, pending: pendingActions() };
  const history = sessions.get(sessionId) || [];
  history.push({ role: 'user', content: userMessage });

  let text = '';
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await anthropic().messages.create({
      model: config.model,
      max_tokens: 3000,
      system: system(clienteNome),
      tools: toolDefs,
      messages: history,
    });
    history.push({ role: 'assistant', content: res.content });
    text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

    const uses = res.content.filter((b) => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !uses.length) break;

    const results = [];
    for (const u of uses) {
      const out = await callTool(u.name, u.input, `chat:${who}`);
      results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 30000) });
    }
    history.push({ role: 'user', content: results });
  }

  // Poda o histórico sem quebrar pares tool_use/tool_result: começa sempre numa mensagem de texto do usuário.
  let trimmed = history.slice(-MAX_HISTORY);
  while (trimmed.length && !(trimmed[0].role === 'user' && typeof trimmed[0].content === 'string')) trimmed = trimmed.slice(1);
  sessions.set(sessionId, trimmed);
  return { reply: text || '(sem resposta)', pending: pendingActions() };
}

export const resetSession = (id) => sessions.delete(id);
