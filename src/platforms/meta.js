import { config } from '../config.js';
import { httpJson, NotConfigured } from '../http.js';

// Só o token é obrigatório. A conta de anúncio pode vir de META_AD_ACCOUNT_ID ou ser informada em cada chamada.
function requireMeta() {
  const m = config.meta;
  if (!m.token) throw new NotConfigured('Meta Ads', ['META_ACCESS_TOKEN']);
  return m;
}

const base = () => `https://graph.facebook.com/${config.meta.version}`;
const acct = (id) => {
  const v = String(id || config.meta.adAccountId || '').trim();
  if (!v) throw new NotConfigured('Meta Ads', ['META_AD_ACCOUNT_ID (ou informe ad_account_id; use meta_listar_contas para descobrir)']);
  return v.startsWith('act_') ? v : `act_${v}`;
};

async function get(path, params = {}) {
  const m = requireMeta();
  const qs = new URLSearchParams({ ...params, access_token: m.token }).toString();
  return httpJson(`${base()}/${path}?${qs}`);
}
async function post(path, params = {}) {
  const m = requireMeta();
  return httpJson(`${base()}/${path}`, { method: 'POST', form: { ...params, access_token: m.token } });
}

const PRESETS = ['today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_30d', 'this_month', 'last_month'];
// Moedas sem centavos na API de anúncios do Meta (menor unidade = 1 unidade da moeda).
const ZERO_DEC = new Set(['CLP', 'COP', 'CRC', 'HUF', 'ISK', 'IDR', 'JPY', 'KRW', 'PYG', 'TWD', 'VND']);
const fromMinor = (v, cur) => (v === undefined || v === null || v === '' ? 0 : Number(v) / (ZERO_DEC.has(String(cur).toUpperCase()) ? 1 : 100));
// Segue a paginação do Graph API (até 10 páginas) para não cortar campanhas.
async function getAll(path, params = {}) {
  let r = await get(path, params); const out = [...(r.data || [])];
  for (let i = 0; i < 10 && r.paging?.next; i++) {
    const m = requireMeta(); const u = new URL(r.paging.next);
    if (u.hostname !== 'graph.facebook.com') break;
    r = await httpJson(r.paging.next.replace(/access_token=[^&]+/, `access_token=${encodeURIComponent(m.token)}`)); out.push(...(r.data || []));
  }
  return out;
}
const cents = (brl) => String(Math.round(Number(brl) * 100)); // BRL → centavos (menor unidade)

async function currentDailyBudget(objectId) {
  const r = await get(objectId, { fields: 'daily_budget,name' });
  return { brl: r.daily_budget ? Number(r.daily_budget) / 100 : 0, name: r.name };
}

export const metaTools = [
  {
    name: 'meta_listar_contas',
    platform: 'meta',
    risk: 'read',
    description: 'Lista as contas de anúncio do Meta que o token enxerga (id no formato act_..., nome, moeda, status e total gasto). Use para descobrir o ID da conta antes das demais ferramentas.',
    params: {},
    handler: async () => {
      const r = { data: await getAll('me/adaccounts', { fields: 'id,name,account_status,currency,amount_spent,business{name}', limit: '100' }) };
      const status = { 1: 'ATIVA', 2: 'DESATIVADA', 3: 'COM PENDÊNCIA DE PAGAMENTO', 7: 'EM ANÁLISE', 9: 'EM PERÍODO DE CARÊNCIA', 100: 'ENCERRAMENTO PENDENTE', 101: 'ENCERRADA' };
      return (r.data || []).map((a) => ({
        id: a.id, nome: a.name, empresa: a.business?.name || null, moeda: a.currency,
        status: status[a.account_status] || String(a.account_status),
        gasto_vitalicio: fromMinor(a.amount_spent, a.currency), // total desde a criação da conta, NÃO é o gasto do período
      }));
    },
  },
  {
    name: 'meta_listar_campanhas',
    platform: 'meta',
    risk: 'read',
    description: 'Lista campanhas do Meta Ads (id, nome, objetivo, status e orçamento diário quando definido na campanha).',
    params: { ad_account_id: { type: 'string', desc: 'Conta de anúncio (act_...). Padrão: a configurada.' } },
    handler: async ({ ad_account_id }) => {
      const r = { data: await getAll(`${acct(ad_account_id)}/campaigns`, { fields: 'id,name,objective,status,effective_status,daily_budget', limit: '100' }) };
      return (r.data || []).map((c) => ({ id: c.id, nome: c.name, objetivo: c.objective, status: c.status, situacao: c.effective_status, orcamento_dia_brl: c.daily_budget ? Number(c.daily_budget) / 100 : null }));
    },
  },
  {
    name: 'meta_desempenho',
    platform: 'meta',
    risk: 'read',
    description: 'Desempenho do Meta Ads por campanha, conjunto ou anúncio: gasto, impressões, cliques, CTR, CPC, frequência e custo por resultado.',
    params: {
      nivel: { type: 'string', enum: ['campaign', 'adset', 'ad'], desc: 'Nível do relatório (padrão campaign)' },
      periodo: { type: 'string', enum: PRESETS, desc: 'Período (padrão last_7d)' },
      ad_account_id: { type: 'string', desc: 'Conta de anúncio (act_...). Padrão: a configurada.' },
      de: { type: 'string', desc: 'Data inicial AAAA-MM-DD (opcional; use com "ate" no lugar de periodo)' },
      ate: { type: 'string', desc: 'Data final AAAA-MM-DD (opcional)' },
    },
    handler: async ({ nivel = 'campaign', periodo = 'last_7d', ad_account_id, de, ate }) => {
      const range = de && ate ? { time_range: JSON.stringify({ since: de, until: ate }) } : { date_preset: periodo };
      const rows = await getAll(`${acct(ad_account_id)}/insights`, {
        level: nivel, ...range, limit: '100',
        fields: 'account_currency,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,ctr,cpc,frequency,actions,cost_per_action_type,date_start,date_stop',
      });
      // spend já vem em unidades da moeda da conta (ex.: "123.45"); não dividir por 100.
      return rows.map((x) => ({ ...x, moeda: x.account_currency, periodo_inicio: x.date_start, periodo_fim: x.date_stop }));
    },
  },
  {
    name: 'meta_pausar_ativar',
    platform: 'meta',
    risk: 'write',
    description: 'Pausa ou ativa uma campanha, conjunto de anúncios ou anúncio do Meta Ads. Nunca exclui.',
    params: {
      id: { type: 'string', desc: 'ID da campanha, conjunto ou anúncio', required: true },
      status: { type: 'string', enum: ['PAUSED', 'ACTIVE'], desc: 'Novo status', required: true },
    },
    isActivation: (a) => a.status === 'ACTIVE',
    summarize: (a) => `Meta: ${a.status === 'ACTIVE' ? 'ATIVAR' : 'PAUSAR'} objeto ${a.id}`,
    handler: async ({ id, status }) => post(id, { status }),
  },
  {
    name: 'meta_ajustar_orcamento',
    platform: 'meta',
    risk: 'write',
    description: 'Altera o orçamento diário de uma campanha (CBO) ou conjunto de anúncios do Meta. Aumentos acima do teto percentual são bloqueados.',
    params: {
      id: { type: 'string', desc: 'ID da campanha ou do conjunto', required: true },
      novo_orcamento_brl: { type: 'number', desc: 'Novo orçamento diário em reais', required: true },
    },
    budgetBRL: (a) => a.novo_orcamento_brl,
    summarize: (a) => `Meta: orçamento diário do objeto ${a.id} → R$ ${a.novo_orcamento_brl}`,
    precheck: async (a) => {
      const cur = await currentDailyBudget(a.id);
      const max = config.caps.maxBudgetIncreasePct;
      if (cur.brl > 0 && a.novo_orcamento_brl > cur.brl * (1 + max / 100)) {
        return { error: `Aumento de R$ ${cur.brl} para R$ ${a.novo_orcamento_brl} passa do teto de +${max}% por ação. Máximo: R$ ${(cur.brl * (1 + max / 100)).toFixed(2)}.` };
      }
      return { warn: `Orçamento atual: R$ ${cur.brl}.` };
    },
    handler: async ({ id, novo_orcamento_brl }) => post(id, { daily_budget: cents(novo_orcamento_brl) }),
  },
  {
    name: 'meta_criar_campanha',
    platform: 'meta',
    risk: 'write',
    description: 'Cria uma campanha no Meta Ads SEMPRE PAUSADA. Conjuntos e anúncios devem ser criados em seguida e revisados antes de ativar.',
    params: {
      nome: { type: 'string', desc: 'Nome da campanha', required: true },
      objetivo: { type: 'string', enum: ['OUTCOME_LEADS', 'OUTCOME_SALES', 'OUTCOME_TRAFFIC', 'OUTCOME_ENGAGEMENT', 'OUTCOME_AWARENESS', 'OUTCOME_APP_PROMOTION'], desc: 'Objetivo da campanha', required: true },
      orcamento_diario_brl: { type: 'number', desc: 'Orçamento diário (CBO) em reais. Omita para definir nos conjuntos.' },
      ad_account_id: { type: 'string', desc: 'Conta de anúncio (act_...). Padrão: a configurada.' },
    },
    budgetBRL: (a) => a.orcamento_diario_brl,
    summarize: (a) => `Meta: CRIAR campanha "${a.nome}" (pausada), objetivo ${a.objetivo}${a.orcamento_diario_brl ? `, R$ ${a.orcamento_diario_brl}/dia` : ''}`,
    handler: async (a) =>
      post(`${acct(a.ad_account_id)}/campaigns`, {
        name: a.nome,
        objective: a.objetivo,
        status: 'PAUSED',
        special_ad_categories: '[]',
        ...(a.orcamento_diario_brl ? { daily_budget: cents(a.orcamento_diario_brl), bid_strategy: 'LOWEST_COST_WITHOUT_CAP' } : {}),
      }),
  },
];
