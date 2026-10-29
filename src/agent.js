import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { agentTools, callTool } from './tools.js';
import { toJsonSchema } from './schema.js';
import { pendingActions } from './guardrails.js';

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

function system() {
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Recife', dateStyle: 'full' });
  const modo = config.dryRun
    ? 'MODO SIMULAÇÃO: nenhuma alteração será feita nas contas reais, mesmo após aprovação.'
    : 'MODO REAL: ações aprovadas alteram contas reais.';
  const tetos = `Tetos ativos: orçamento diário máx. R$ ${config.caps.maxDailyBudgetBRL}, aumento máx. +${config.caps.maxBudgetIncreasePct}% por ação, até ${config.caps.maxActivationsPerDay} ativações/dia.`;
  return `${masterPrompt()}\n\n---\nHoje é ${hoje}. ${modo} ${tetos}`;
}

export async function chat(sessionId, userMessage, who = 'chat') {
  if (!config.anthropicKey) {
    return { reply: 'O chat com IA deste painel é opcional e precisa da variável ANTHROPIC_API_KEY. Enquanto ela não existir, use os botões acima do campo de texto (Contas, Campanhas e Desempenho do Meta) ou converse com o agente dentro do Claude, pelo conector "Agente de Tráfego".', pending: pendingActions() };
  }
  const history = sessions.get(sessionId) || [];
  history.push({ role: 'user', content: userMessage });

  let text = '';
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await anthropic().messages.create({
      model: config.model,
      max_tokens: 3000,
      system: system(),
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
