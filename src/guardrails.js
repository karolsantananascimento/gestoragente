import crypto from 'node:crypto';
import { config } from './config.js';
import { store } from './store.js';
import { getPlatformTool } from './registry.js';

const sameDay = (iso) => new Date(iso).toDateString() === new Date().toDateString();

// Validações que valem para QUALQUER escrita, independentemente do que o modelo "decidir".
export async function validateWrite(tool, args) {
  const errors = [];
  const warnings = [];

  const budget = tool.budgetBRL?.(args);
  if (budget !== undefined && budget !== null) {
    if (!(budget > 0)) errors.push('Orçamento diário inválido.');
    if (budget > config.caps.maxDailyBudgetBRL) {
      errors.push(`Orçamento diário R$ ${budget} acima do teto de R$ ${config.caps.maxDailyBudgetBRL}.`);
    }
  }

  if (tool.isActivation?.(args)) {
    const done = store.actions().filter(
      (a) => a.status === 'executed' && a.activation && a.executedAt && sameDay(a.executedAt)
    ).length;
    if (done >= config.caps.maxActivationsPerDay) {
      errors.push(`Limite de ${config.caps.maxActivationsPerDay} ativações por dia atingido.`);
    }
  }

  if (tool.precheck) {
    try {
      const r = (await tool.precheck(args)) || {};
      if (r.error) errors.push(r.error);
      if (r.warn) warnings.push(r.warn);
    } catch (e) {
      // Em modo real, falhar fechado: se não dá para verificar, não executa.
      if (config.dryRun) warnings.push(`Não foi possível verificar dados da conta: ${e.message}`);
      else errors.push(`Não foi possível verificar dados da conta (bloqueado por segurança): ${e.message}`);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

// Escrita nunca executa direto: vira uma proposta pendente de aprovação humana.
export async function proposeAction(tool, args, source = 'agent') {
  const v = await validateWrite(tool, args);
  if (!v.ok) {
    store.log({ type: 'blocked', tool: tool.name, args, errors: v.errors, source });
    return { status: 'bloqueado', motivos: v.errors };
  }
  const action = store.addAction({
    id: crypto.randomUUID().slice(0, 8),
    tool: tool.name,
    platform: tool.platform,
    args,
    summary: tool.summarize ? tool.summarize(args) : tool.name,
    warnings: v.warnings,
    activation: !!tool.isActivation?.(args),
    status: 'pending',
    source,
    createdAt: new Date().toISOString(),
  });
  store.log({ type: 'proposed', id: action.id, tool: tool.name, args, source });
  return {
    status: 'pendente_aprovacao',
    id: action.id,
    resumo: action.summary,
    avisos: v.warnings,
    modo: config.dryRun ? 'SIMULAÇÃO (DRY_RUN ligado: nada será alterado na conta)' : 'REAL',
    como_aprovar: 'Aprove no painel web ou com a ferramenta aprovar_acao (PIN exigido).',
  };
}

export async function approveAction(id, by = 'human') {
  const a = store.getAction(id);
  if (!a) return { status: 'erro', erro: 'Ação não encontrada.' };
  if (a.status !== 'pending') return { status: 'erro', erro: `Ação já está "${a.status}".` };
  const tool = getPlatformTool(a.tool);
  if (!tool) return { status: 'erro', erro: 'Ferramenta inexistente.' };

  // Revalida na hora de executar: teto e dados da conta podem ter mudado desde a proposta.
  const v = await validateWrite(tool, a.args);
  if (!v.ok) {
    store.updateAction(id, { status: 'blocked', errors: v.errors });
    store.log({ type: 'blocked', id, tool: a.tool, errors: v.errors, by });
    return { status: 'bloqueado', motivos: v.errors };
  }

  try {
    let result;
    if (config.dryRun) {
      result = { simulado: true, aconteceria: a.summary, ferramenta: a.tool, args: a.args };
    } else {
      result = await tool.handler(a.args);
    }
    store.updateAction(id, { status: 'executed', executedAt: new Date().toISOString(), result, simulated: config.dryRun });
    store.log({ type: config.dryRun ? 'simulated' : 'executed', id, tool: a.tool, args: a.args, result, by });
    return { status: config.dryRun ? 'simulado' : 'executado', id, resultado: result };
  } catch (e) {
    store.updateAction(id, { status: 'failed', error: e.message });
    store.log({ type: 'failed', id, tool: a.tool, error: e.message, by });
    return { status: 'falhou', erro: e.message };
  }
}

export function rejectAction(id, by = 'human') {
  const a = store.getAction(id);
  if (!a) return { status: 'erro', erro: 'Ação não encontrada.' };
  if (a.status !== 'pending') return { status: 'erro', erro: `Ação já está "${a.status}".` };
  store.updateAction(id, { status: 'rejected' });
  store.log({ type: 'rejected', id, tool: a.tool, by });
  return { status: 'rejeitado', id };
}

export const pendingActions = () => store.actions().filter((a) => a.status === 'pending');
