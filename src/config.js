const num = (v, d) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);

export const config = {
  port: num(process.env.PORT, 3000),
  // Seguro por padrão: só sai do modo simulação com DRY_RUN=false explícito
  dryRun: process.env.DRY_RUN !== 'false',
  appPassword: process.env.APP_PASSWORD || '',
  // Conta administradora principal. Entra com este e-mail + APP_PASSWORD até definir a própria senha no painel.
  adminEmail: (process.env.ADMIN_EMAIL || 'knasck@gmail.com').trim().toLowerCase(),
  // Assina as sessões. Se não definido, deriva de APP_PASSWORD + MCP_TOKEN (sessões sobrevivem a reinícios).
  sessionSecret: process.env.SESSION_SECRET || `derived:${process.env.APP_PASSWORD || ''}:${process.env.MCP_TOKEN || ''}`,
  publicUrl: (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, ''),
  // Envio opcional de e-mail de convite (Resend). Sem isso, o painel mostra o link para você copiar.
  resendKey: process.env.RESEND_API_KEY || '',
  mailFrom: process.env.MAIL_FROM || '',
  // "Entrar com Google": Client ID OAuth (tipo Web). Não é segredo. Sem ele, o botão não aparece.
  googleLoginClientId: (process.env.GOOGLE_LOGIN_CLIENT_ID || '').trim(),
  // Quando o Google estiver funcionando, defina DISABLE_PASSWORD_LOGIN=true para aceitar só Google.
  disablePasswordLogin: process.env.DISABLE_PASSWORD_LOGIN === 'true',
  mcpToken: process.env.MCP_TOKEN || '',
  approvalPin: process.env.APPROVAL_PIN || '',
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  dataDir: process.env.DATA_DIR || './data',
  // Opcional: Postgres para os dados não se perderem em reinícios (Render, Supabase, Neon...).
  databaseUrl: process.env.DATABASE_URL || '',
  openaiKey: process.env.OPENAI_API_KEY || '',
  openaiImageModel: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
  openaiImageQuality: process.env.OPENAI_IMAGE_QUALITY || 'medium',
  openaiImageQualityFinal: process.env.OPENAI_IMAGE_QUALITY_FINAL || 'high',
  openaiImageSizes: { retrato: process.env.OPENAI_SIZE_RETRATO || '', quadrado: '', paisagem: '' },
  imageDailyCap: Number(process.env.IMAGE_DAILY_CAP || 20),
  // Redes sociais (Mariana). Todas opcionais; sem credencial o canal fica como "sem integração".
  social: {
    fbPageId: process.env.META_PAGE_ID || '',
    fbPageToken: process.env.META_PAGE_ACCESS_TOKEN || '',
    igUserId: process.env.INSTAGRAM_USER_ID || '',
    linkedinToken: process.env.LINKEDIN_ACCESS_TOKEN || '',
    linkedinAuthor: process.env.LINKEDIN_AUTHOR_URN || '', // urn:li:organization:123 ou urn:li:person:abc
    tiktokToken: process.env.TIKTOK_ACCESS_TOKEN || '',
  },
  reddit: { clientId: process.env.REDDIT_CLIENT_ID || '', clientSecret: process.env.REDDIT_CLIENT_SECRET || '', userAgent: process.env.REDDIT_USER_AGENT || 'web:gestoragente:1.0 (by /u/' + (process.env.REDDIT_USERNAME || 'gestoragente') + ')' },
  caps: {
    maxDailyBudgetBRL: num(process.env.MAX_DAILY_BUDGET_BRL, 300),
    maxBudgetIncreasePct: num(process.env.MAX_BUDGET_INCREASE_PCT, 20),
    maxActivationsPerDay: num(process.env.MAX_ACTIVATIONS_PER_DAY, 5),
  },
  google: {
    developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
    clientId: process.env.GOOGLE_ADS_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET || '',
    refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN || '',
    loginCustomerId: (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/-/g, ''),
    version: process.env.GOOGLE_ADS_API_VERSION || 'v21',
  },
  meta: {
    token: process.env.META_ACCESS_TOKEN || '',
    adAccountId: process.env.META_AD_ACCOUNT_ID || '',
    version: process.env.META_API_VERSION || 'v23.0',
  },
  linkedin: {
    token: process.env.LINKEDIN_ACCESS_TOKEN || '',
    adAccountId: process.env.LINKEDIN_AD_ACCOUNT_ID || '',
    version: process.env.LINKEDIN_API_VERSION || '202510',
  },
};

export function socialStatus() {
  const s = config.social;
  return {
    facebook: !!(s.fbPageId && s.fbPageToken),
    instagram: !!(s.igUserId && (s.fbPageToken || config.meta.token)),
    linkedin: !!(s.linkedinToken && s.linkedinAuthor),
    tiktok: false, // exige app aprovado pelo TikTok; ainda não implementado
  };
}

export function platformStatus() {
  const g = config.google, m = config.meta, l = config.linkedin;
  return {
    google: !!(g.developerToken && g.clientId && g.clientSecret && g.refreshToken),
    meta: !!m.token,
    linkedin: !!(l.token && l.adAccountId),
  };
}
