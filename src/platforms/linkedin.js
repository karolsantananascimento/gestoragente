import { config } from '../config.js';
import { httpJson, NotConfigured } from '../http.js';

function requireLinkedin() {
  const l = config.linkedin;
  const missing = [];
  if (!l.token) missing.push('LINKEDIN_ACCESS_TOKEN');
  if (!l.adAccountId) missing.push('LINKEDIN_AD_ACCOUNT_ID');
  if (missing.length) throw new NotConfigured('LinkedIn Ads', missing);
  return l;
}

const headers = (extra = {}) => {
  const l = requireLinkedin();
  return { Authorization: `Bearer ${l.token}`, 'LinkedIn-Version': l.version, 'X-Restli-Protocol-Version': '2.0.0', ...extra };
};

// ATENÇÃO: a API de anúncios do LinkedIn exige aprovação da Marketing Developer Platform e a
// versão (LINKEDIN_API_VERSION) muda com frequência. Valide estas chamadas na sua conta antes de usar em modo real.
export const linkedinTools = [
  {
    name: 'linkedin_listar_campanhas',
    platform: 'linkedin',
    risk: 'read',
    description: 'Lista campanhas do LinkedIn Ads (id, nome, status, tipo e orçamento diário).',
    params: {},
    handler: async () => {
      const l = requireLinkedin();
      const r = await httpJson(`https://api.linkedin.com/rest/adAccounts/${l.adAccountId}/adCampaigns?q=search&count=100`, { headers: headers() });
      return (r.elements || []).map((c) => ({
        id: c.id, nome: c.name, status: c.status, tipo: c.type, objetivo: c.objectiveType,
        orcamento_dia: c.dailyBudget ? `${c.dailyBudget.currencyCode} ${c.dailyBudget.amount}` : null,
      }));
    },
  },
  {
    name: 'linkedin_desempenho',
    platform: 'linkedin',
    risk: 'read',
    description: 'Métricas do LinkedIn Ads por campanha nos últimos N dias (gasto, impressões, cliques, conversões, leads).',
    params: { dias: { type: 'number', desc: 'Janela em dias (padrão 7)' } },
    handler: async ({ dias = 7 }) => {
      const l = requireLinkedin();
      const end = new Date();
      const start = new Date(Date.now() - dias * 86400000);
      const dr = `(start:(year:${start.getFullYear()},month:${start.getMonth() + 1},day:${start.getDate()}),end:(year:${end.getFullYear()},month:${end.getMonth() + 1},day:${end.getDate()}))`;
      const acc = encodeURIComponent(`urn:li:sponsoredAccount:${l.adAccountId}`);
      const url = `https://api.linkedin.com/rest/adAnalytics?q=analytics&pivot=CAMPAIGN&timeGranularity=ALL&dateRange=${dr}&accounts=List(${acc})&fields=costInLocalCurrency,impressions,clicks,externalWebsiteConversions,oneClickLeads,pivotValues`;
      const r = await httpJson(url, { headers: headers() });
      return r.elements || [];
    },
  },
  {
    name: 'linkedin_pausar_ativar',
    platform: 'linkedin',
    risk: 'write',
    description: 'Pausa ou ativa uma campanha do LinkedIn Ads. Nunca exclui.',
    params: {
      campaign_id: { type: 'string', desc: 'ID numérico da campanha', required: true },
      status: { type: 'string', enum: ['PAUSED', 'ACTIVE'], desc: 'Novo status', required: true },
    },
    isActivation: (a) => a.status === 'ACTIVE',
    summarize: (a) => `LinkedIn: ${a.status === 'ACTIVE' ? 'ATIVAR' : 'PAUSAR'} campanha ${a.campaign_id}`,
    handler: async ({ campaign_id, status }) => {
      const l = requireLinkedin();
      return httpJson(`https://api.linkedin.com/rest/adAccounts/${l.adAccountId}/adCampaigns/${campaign_id}`, {
        method: 'POST',
        headers: headers({ 'X-RestLi-Method': 'PARTIAL_UPDATE' }),
        body: { patch: { $set: { status } } },
      });
    },
  },
];
