import { config, platformStatus } from './config.js';
import { platformTools } from './registry.js';
import { proposeAction, approveAction, rejectAction, pendingActions } from './guardrails.js';
import { NotConfigured } from './http.js';
import { teamTools } from './teamTools.js';

// Ferramentas de administração do fluxo de aprovação.
const adminTools = [
  {
    name: 'status_sistema',
    risk: 'read',
    description: 'Mostra o modo (simulação/real), os tetos de segurança e quais plataformas estão conectadas.',
    params: {},
    handler: async () => ({
      modo: config.dryRun ? 'SIMULAÇÃO (DRY_RUN)' : 'REAL',
      tetos: config.caps,
      plataformas_conectadas: platformStatus(),
    }),
  },
  {
    name: 'listar_pendentes',
    risk: 'read',
    description: 'Lista as ações propostas que aguardam aprovação humana.',
    params: {},
    handler: async () => pendingActions().map((a) => ({ id: a.id, plataforma: a.platform, resumo: a.summary, avisos: a.warnings, criada_em: a.createdAt })),
  },
  {
    name: 'rejeitar_acao',
    risk: 'read',
    description: 'Rejeita e descarta uma ação pendente.',
    params: { id: { type: 'string', desc: 'ID da ação pendente', required: true } },
    handler: async ({ id }) => rejectAction(id, 'agent'),
  },
  {
    // Só exposta no MCP. O modelo não conhece o PIN: quem aprova é o humano.
    name: 'aprovar_acao',
    risk: 'read',
    mcpOnly: true,
    description: 'Executa uma ação pendente. Exige o PIN de aprovação, que só o usuário conhece. Nunca invente nem tente adivinhar o PIN: peça ao usuário.',
    params: {
      id: { type: 'string', desc: 'ID da ação pendente', required: true },
      pin: { type: 'string', desc: 'PIN de aprovação informado pelo usuário', required: true },
    },
    handler: async ({ id, pin }) => {
      if (!config.approvalPin) return { status: 'erro', erro: 'APPROVAL_PIN não configurado no servidor.' };
      if (pin !== config.approvalPin) return { status: 'erro', erro: 'PIN incorreto.' };
      return approveAction(id, 'mcp-user');
    },
  },
];

// Camila é a dona das ferramentas de anúncios.
for (const t of platformTools) t.agent ||= 'camila';
export const allTools = [...platformTools, ...teamTools, ...adminTools];

// Ferramentas visíveis para o chat web (sem aprovar_acao).
export const agentTools = allTools.filter((t) => !t.mcpOnly);

export async function callTool(name, args = {}, source = 'agent') {
  const tool = allTools.find((t) => t.name === name);
  if (!tool) return { status: 'erro', erro: `Ferramenta desconhecida: ${name}` };
  try {
    if (tool.risk === 'write') return await proposeAction(tool, args, source);
    return await tool.handler(args);
  } catch (e) {
    if (e instanceof NotConfigured) return { status: 'nao_configurado', erro: e.message };
    return { status: 'erro', erro: e.message };
  }
}
