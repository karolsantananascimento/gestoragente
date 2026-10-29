import { config } from '../config.js';
import { httpJson, NotConfigured } from '../http.js';

const brl = (micros) => Number(micros || 0) / 1_000_000;
const toMicros = (v) => Math.round(Number(v) * 1_000_000);
const cid = (v) => String(v).replace(/-/g, '');

function requireGoogle() {
  const g = config.google;
  const missing = [];
  if (!g.developerToken) missing.push('GOOGLE_ADS_DEVELOPER_TOKEN');
  if (!g.clientId) missing.push('GOOGLE_ADS_CLIENT_ID');
  if (!g.clientSecret) missing.push('GOOGLE_ADS_CLIENT_SECRET');
  if (!g.refreshToken) missing.push('GOOGLE_ADS_REFRESH_TOKEN');
  if (missing.length) throw new NotConfigured('Google Ads', missing);
  return g;
}

let tokenCache = { value: '', exp: 0 };
async function accessToken() {
  const g = requireGoogle();
  if (tokenCache.value && Date.now() < tokenCache.exp) return tokenCache.value;
  const r = await httpJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    form: { client_id: g.clientId, client_secret: g.clientSecret, refresh_token: g.refreshToken, grant_type: 'refresh_token' },
  });
  tokenCache = { value: r.access_token, exp: Date.now() + (r.expires_in - 60) * 1000 };
  return tokenCache.value;
}

async function call(customerId, path, body) {
  const g = requireGoogle();
  const token = await accessToken();
  const headers = { Authorization: `Bearer ${token}`, 'developer-token': g.developerToken };
  if (g.loginCustomerId) headers['login-customer-id'] = g.loginCustomerId;
  return httpJson(`https://googleads.googleapis.com/${g.version}/customers/${cid(customerId)}/${path}`, { method: 'POST', headers, body });
}

const gaql = async (customerId, query) => (await call(customerId, 'googleAds:search', { query })).results || [];

const PERIODOS = ['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_14_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH'];
const campRn = (c, id) => `customers/${cid(c)}/campaigns/${id}`;

async function currentBudget(customerId, campaignId) {
  const rows = await gaql(
    customerId,
    `SELECT campaign.id, campaign.campaign_budget, campaign_budget.amount_micros, campaign_budget.resource_name FROM campaign WHERE campaign.id = ${Number(campaignId)}`
  );
  const r = rows[0];
  if (!r) throw new Error('Campanha não encontrada.');
  return { resourceName: r.campaignBudget.resourceName, amountBRL: brl(r.campaignBudget.amountMicros) };
}

export const googleTools = [
  {
    name: 'google_listar_campanhas',
    platform: 'google',
    risk: 'read',
    description: 'Lista campanhas do Google Ads com status, orçamento diário e métricas (gasto, cliques, CPC, conversões, custo por conversão) no período.',
    params: {
      customer_id: { type: 'string', desc: 'ID da conta de anúncio (10 dígitos, com ou sem hífen)', required: true },
      periodo: { type: 'string', enum: PERIODOS, desc: 'Período das métricas (padrão LAST_7_DAYS)' },
    },
    handler: async ({ customer_id, periodo = 'LAST_7_DAYS' }) => {
      const rows = await gaql(
        customer_id,
        `SELECT campaign.id, campaign.name, campaign.status, campaign.primary_status, campaign.bidding_strategy_type,
                campaign_budget.amount_micros, metrics.cost_micros, metrics.clicks, metrics.impressions,
                metrics.average_cpc, metrics.conversions, metrics.cost_per_conversion
         FROM campaign WHERE campaign.status != 'REMOVED' AND segments.date DURING ${periodo}`
      );
      return rows.map((r) => ({
        id: r.campaign.id,
        nome: r.campaign.name,
        status: r.campaign.status,
        situacao: r.campaign.primaryStatus,
        estrategia_lance: r.campaign.biddingStrategyType,
        orcamento_dia_brl: brl(r.campaignBudget?.amountMicros),
        gasto_brl: brl(r.metrics?.costMicros),
        cliques: Number(r.metrics?.clicks || 0),
        impressoes: Number(r.metrics?.impressions || 0),
        cpc_medio_brl: brl(r.metrics?.averageCpc),
        conversoes: Number(r.metrics?.conversions || 0),
        custo_por_conversao_brl: brl(r.metrics?.costPerConversion),
      }));
    },
  },
  {
    name: 'google_termos_pesquisa',
    platform: 'google',
    risk: 'read',
    description: 'Relatório de termos de pesquisa (o que as pessoas digitaram) com gasto, cliques e conversões. Use para achar termos que gastam sem converter e candidatos a palavra negativa.',
    params: {
      customer_id: { type: 'string', desc: 'ID da conta de anúncio', required: true },
      periodo: { type: 'string', enum: PERIODOS, desc: 'Período (padrão LAST_7_DAYS)' },
      campaign_id: { type: 'string', desc: 'Filtrar por campanha (opcional)' },
    },
    handler: async ({ customer_id, periodo = 'LAST_7_DAYS', campaign_id }) => {
      const filtro = campaign_id ? `AND campaign.id = ${Number(campaign_id)}` : '';
      const rows = await gaql(
        customer_id,
        `SELECT search_term_view.search_term, campaign.id, campaign.name, metrics.cost_micros, metrics.clicks, metrics.conversions
         FROM search_term_view WHERE segments.date DURING ${periodo} ${filtro} ORDER BY metrics.cost_micros DESC LIMIT 200`
      );
      return rows.map((r) => ({
        termo: r.searchTermView.searchTerm,
        campanha_id: r.campaign.id,
        campanha: r.campaign.name,
        gasto_brl: brl(r.metrics.costMicros),
        cliques: Number(r.metrics.clicks || 0),
        conversoes: Number(r.metrics.conversions || 0),
      }));
    },
  },
  {
    name: 'google_pausar_ativar_campanha',
    platform: 'google',
    risk: 'write',
    description: 'Pausa ou ativa uma campanha do Google Ads. Exige aprovação humana. Nunca exclui.',
    params: {
      customer_id: { type: 'string', desc: 'ID da conta de anúncio', required: true },
      campaign_id: { type: 'string', desc: 'ID da campanha', required: true },
      status: { type: 'string', enum: ['PAUSED', 'ENABLED'], desc: 'Novo status', required: true },
    },
    isActivation: (a) => a.status === 'ENABLED',
    summarize: (a) => `Google: ${a.status === 'ENABLED' ? 'ATIVAR' : 'PAUSAR'} campanha ${a.campaign_id} (conta ${a.customer_id})`,
    handler: async ({ customer_id, campaign_id, status }) =>
      call(customer_id, 'campaigns:mutate', {
        operations: [{ update: { resourceName: campRn(customer_id, campaign_id), status }, updateMask: 'status' }],
      }),
  },
  {
    name: 'google_ajustar_orcamento',
    platform: 'google',
    risk: 'write',
    description: 'Altera o orçamento diário de uma campanha do Google Ads. Aumentos acima do teto percentual configurado são bloqueados.',
    params: {
      customer_id: { type: 'string', desc: 'ID da conta de anúncio', required: true },
      campaign_id: { type: 'string', desc: 'ID da campanha', required: true },
      novo_orcamento_brl: { type: 'number', desc: 'Novo orçamento diário em reais', required: true },
    },
    budgetBRL: (a) => a.novo_orcamento_brl,
    summarize: (a) => `Google: orçamento diário da campanha ${a.campaign_id} → R$ ${a.novo_orcamento_brl}`,
    precheck: async (a) => {
      const cur = await currentBudget(a.customer_id, a.campaign_id);
      const max = config.caps.maxBudgetIncreasePct;
      if (cur.amountBRL > 0 && a.novo_orcamento_brl > cur.amountBRL * (1 + max / 100)) {
        return { error: `Aumento de R$ ${cur.amountBRL} para R$ ${a.novo_orcamento_brl} passa do teto de +${max}% por ação. Máximo permitido: R$ ${(cur.amountBRL * (1 + max / 100)).toFixed(2)}.` };
      }
      return { warn: `Orçamento atual: R$ ${cur.amountBRL}.` };
    },
    handler: async ({ customer_id, campaign_id, novo_orcamento_brl }) => {
      const cur = await currentBudget(customer_id, campaign_id);
      return call(customer_id, 'campaignBudgets:mutate', {
        operations: [{ update: { resourceName: cur.resourceName, amountMicros: String(toMicros(novo_orcamento_brl)) }, updateMask: 'amount_micros' }],
      });
    },
  },
  {
    name: 'google_adicionar_negativas',
    platform: 'google',
    risk: 'write',
    description: 'Adiciona palavras-chave negativas a uma campanha do Google Ads.',
    params: {
      customer_id: { type: 'string', desc: 'ID da conta de anúncio', required: true },
      campaign_id: { type: 'string', desc: 'ID da campanha', required: true },
      termos: { type: 'string[]', desc: 'Termos a negativar', required: true },
      tipo_correspondencia: { type: 'string', enum: ['EXACT', 'PHRASE', 'BROAD'], desc: 'Tipo de correspondência (padrão PHRASE)' },
    },
    summarize: (a) => `Google: negativar ${a.termos.length} termo(s) na campanha ${a.campaign_id}: ${a.termos.join(', ')} [${a.tipo_correspondencia || 'PHRASE'}]`,
    handler: async ({ customer_id, campaign_id, termos, tipo_correspondencia = 'PHRASE' }) =>
      call(customer_id, 'campaignCriteria:mutate', {
        operations: termos.map((t) => ({
          create: { campaign: campRn(customer_id, campaign_id), negative: true, keyword: { text: t, matchType: tipo_correspondencia } },
        })),
      }),
  },
  {
    name: 'google_restringir_redes',
    platform: 'google',
    risk: 'write',
    description: 'Liga ou desliga a rede de pesquisa parceira e a rede de display em uma campanha de pesquisa. Para deixar só Pesquisa, use parceiros=false e display=false.',
    params: {
      customer_id: { type: 'string', desc: 'ID da conta de anúncio', required: true },
      campaign_id: { type: 'string', desc: 'ID da campanha', required: true },
      parceiros: { type: 'boolean', desc: 'Manter sites parceiros de pesquisa?', required: true },
      display: { type: 'boolean', desc: 'Manter rede de display?', required: true },
    },
    summarize: (a) => `Google: campanha ${a.campaign_id} → sites parceiros ${a.parceiros ? 'LIGADO' : 'DESLIGADO'}, rede de display ${a.display ? 'LIGADA' : 'DESLIGADA'}`,
    handler: async ({ customer_id, campaign_id, parceiros, display }) =>
      call(customer_id, 'campaigns:mutate', {
        operations: [{
          update: { resourceName: campRn(customer_id, campaign_id), networkSettings: { targetSearchNetwork: parceiros, targetContentNetwork: display } },
          updateMask: 'network_settings.target_search_network,network_settings.target_content_network',
        }],
      }),
  },
  {
    name: 'google_criar_campanha_pesquisa',
    platform: 'google',
    risk: 'write',
    description: 'Cria uma campanha de Pesquisa no Google Ads SEMPRE PAUSADA (orçamento + campanha). Depois use google_criar_grupo_com_anuncio e só então ative.',
    params: {
      customer_id: { type: 'string', desc: 'ID da conta de anúncio', required: true },
      nome: { type: 'string', desc: 'Nome da campanha', required: true },
      orcamento_diario_brl: { type: 'number', desc: 'Orçamento diário em reais', required: true },
      estrategia: { type: 'string', enum: ['MAXIMIZE_CONVERSIONS', 'MAXIMIZE_CLICKS'], desc: 'Estratégia de lance', required: true },
      teto_cpc_brl: { type: 'number', desc: 'Teto de CPC em reais (só para MAXIMIZE_CLICKS)' },
    },
    budgetBRL: (a) => a.orcamento_diario_brl,
    summarize: (a) => `Google: CRIAR campanha de pesquisa "${a.nome}" (pausada), R$ ${a.orcamento_diario_brl}/dia, ${a.estrategia}`,
    handler: async (a) => {
      const budget = await call(a.customer_id, 'campaignBudgets:mutate', {
        operations: [{ create: { name: `${a.nome} · orçamento ${Date.now()}`, amountMicros: String(toMicros(a.orcamento_diario_brl)), deliveryMethod: 'STANDARD', explicitlyShared: false } }],
      });
      const budgetRn = budget.results[0].resourceName;
      const campaign = {
        name: a.nome,
        status: 'PAUSED',
        advertisingChannelType: 'SEARCH',
        campaignBudget: budgetRn,
        networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false },
        containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
      };
      if (a.estrategia === 'MAXIMIZE_CONVERSIONS') campaign.maximizeConversions = {};
      else campaign.targetSpend = a.teto_cpc_brl ? { cpcBidCeilingMicros: String(toMicros(a.teto_cpc_brl)) } : {};
      return call(a.customer_id, 'campaigns:mutate', { operations: [{ create: campaign }] });
    },
  },
  {
    name: 'google_criar_grupo_com_anuncio',
    platform: 'google',
    risk: 'write',
    description: 'Cria, dentro de uma campanha, um grupo de anúncios com palavras-chave e um anúncio responsivo de pesquisa (RSA). O anúncio é criado PAUSADO.',
    params: {
      customer_id: { type: 'string', desc: 'ID da conta de anúncio', required: true },
      campaign_id: { type: 'string', desc: 'ID da campanha', required: true },
      nome_grupo: { type: 'string', desc: 'Nome do grupo de anúncios', required: true },
      palavras_exatas: { type: 'string[]', desc: 'Palavras-chave em correspondência exata' },
      palavras_frase: { type: 'string[]', desc: 'Palavras-chave em correspondência de frase' },
      titulos: { type: 'string[]', desc: 'Títulos do RSA (3 a 15, até 30 caracteres cada)', required: true },
      descricoes: { type: 'string[]', desc: 'Descrições do RSA (2 a 4, até 90 caracteres cada)', required: true },
      url_final: { type: 'string', desc: 'URL da página de destino (com UTMs)', required: true },
      cpc_max_brl: { type: 'number', desc: 'CPC máximo do grupo em reais (opcional)' },
    },
    summarize: (a) => `Google: CRIAR grupo "${a.nome_grupo}" na campanha ${a.campaign_id} com ${(a.palavras_exatas || []).length + (a.palavras_frase || []).length} palavra(s) e RSA (${a.titulos.length} títulos, ${a.descricoes.length} descrições) → ${a.url_final}`,
    precheck: async (a) => {
      const bad = [...a.titulos.filter((t) => t.length > 30).map((t) => `título >30: "${t}"`), ...a.descricoes.filter((d) => d.length > 90).map((d) => `descrição >90: "${d}"`)];
      if (a.titulos.length < 3) bad.push('mínimo de 3 títulos');
      if (a.descricoes.length < 2) bad.push('mínimo de 2 descrições');
      return bad.length ? { error: `RSA inválido: ${bad.join('; ')}` } : {};
    },
    handler: async (a) => {
      const ag = await call(a.customer_id, 'adGroups:mutate', {
        operations: [{ create: { name: a.nome_grupo, campaign: campRn(a.customer_id, a.campaign_id), status: 'ENABLED', type: 'SEARCH_STANDARD', ...(a.cpc_max_brl ? { cpcBidMicros: String(toMicros(a.cpc_max_brl)) } : {}) } }],
      });
      const agRn = ag.results[0].resourceName;
      const kws = [
        ...(a.palavras_exatas || []).map((t) => ({ text: t, matchType: 'EXACT' })),
        ...(a.palavras_frase || []).map((t) => ({ text: t, matchType: 'PHRASE' })),
      ];
      if (kws.length) await call(a.customer_id, 'adGroupCriteria:mutate', { operations: kws.map((keyword) => ({ create: { adGroup: agRn, status: 'ENABLED', keyword } })) });
      return call(a.customer_id, 'adGroupAds:mutate', {
        operations: [{
          create: {
            adGroup: agRn,
            status: 'PAUSED',
            ad: {
              finalUrls: [a.url_final],
              responsiveSearchAd: { headlines: a.titulos.map((text) => ({ text })), descriptions: a.descricoes.map((text) => ({ text })) },
            },
          },
        }],
      });
    },
  },
];
