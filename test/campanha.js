// Fluxo completo de campanha no Meta (campanha → conjunto → criativo → anúncio, tudo pausado) com a API simulada.
import fs from 'node:fs';
process.env.DATA_DIR = './data/campanha-test'; process.env.DRY_RUN = 'false';
process.env.META_ACCESS_TOKEN = 'tk'; process.env.META_AD_ACCOUNT_ID = 'act_1'; process.env.MAX_DAILY_BUDGET_BRL = '100';
process.env.META_PAGE_ID = 'pg1'; process.env.INSTAGRAM_USER_ID = 'ig1';
fs.rmSync('./data/campanha-test', { recursive: true, force: true });
const calls = []; let falhaCriativo = false;
const j = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url); calls.push({ u, m: opts.method || 'GET', body: opts.body });
  if (/\/pg1\?fields=name/.test(u)) return j({ name: 'Disco Mídia' });
  if (/\/777\?fields=name,status/.test(u)) return j({ name: 'Disco | Leads', status: 'PAUSED', daily_budget: '4000' });
  if (/\/777\/adsets/.test(u)) return j({ data: [{ id: 's1', status: 'PAUSED' }] });
  if (/\/777\/ads/.test(u)) return j({ data: [{ id: 'a1', status: 'PAUSED' }, { id: 'a2', status: 'ACTIVE' }] });
  if (opts.method === 'POST') {
    if (/act_1\/campaigns/.test(u)) return j({ id: '777' });
    if (/act_1\/adsets/.test(u)) return j({ id: 's1' });
    if (/act_1\/adcreatives/.test(u)) return falhaCriativo ? j({ error: { message: 'Imagem inválida' } }, 400) : j({ id: 'c1' });
    if (/act_1\/ads/.test(u)) return j({ id: 'a1' });
    return j({ success: true });
  }
  return j({});
};
const { store } = await import('../src/store.js'); await store.init();
const { proposeAction, approveAction } = await import('../src/guardrails.js');
const { getPlatformTool } = await import('../src/registry.js');
let fails = 0; const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FALHA'} ${m}`); if (!c) fails++; };
const T = getPlatformTool('meta_subir_campanha_completa');
const base = { nome: 'Disco | Leads', objetivo: 'OUTCOME_TRAFFIC', orcamento_diario_brl: 40, texto_principal: 'Texto do anúncio', imagem_url: 'https://app.exemplo.com/media/abc', url_destino: 'https://disco.com', cliente: 'Disco' };

let r = await proposeAction(T, { ...base, objetivo: 'OUTCOME_LEADS' }, 't');
ok(r.status === 'bloqueado' && /pixel/i.test(r.motivos.join(' ')), 'Leads no site sem pixel é bloqueado com explicação');
r = await proposeAction(T, { ...base, imagem_url: 'http://x.com/a.jpg' }, 't');
ok(r.status === 'bloqueado' && /https/.test(r.motivos.join(' ')), 'imagem sem https é bloqueada');
r = await proposeAction(T, { ...base, orcamento_diario_brl: 500 }, 't');
ok(r.status === 'bloqueado' && /teto/.test(r.motivos.join(' ')), 'orçamento acima do teto diário é bloqueado');
r = await proposeAction(T, { ...base, idade_min: 10 }, 't');
ok(r.status === 'bloqueado', 'idade fora de 13–65 é bloqueada');
r = await proposeAction(T, { ...base, objetivo: 'OUTCOME_ENGAGEMENT' }, 't');
ok(r.status === 'bloqueado' && /não é suportado/.test(r.motivos.join(' ')), 'objetivo fora do fluxo é recusado');

const antes = calls.filter((c) => c.m === 'POST').length;
r = await proposeAction(T, { ...base, genero: 'feminino', idade_min: 25, idade_max: 45, termina_em: '2030-01-01T23:59:00-03:00' }, 't');
ok(r.status === 'pendente_aprovacao' && /PAUSADO/.test(r.resumo) && /Disco Mídia/.test(r.avisos.join(' ')), 'proposta resume o fluxo e mostra a página que será usada');
ok(calls.filter((c) => c.m === 'POST').length === antes, 'nada é escrito no Meta antes da aprovação');
const ap = await approveAction(r.id, 'admin');
ok(ap.status === 'executado' && ap.resultado.campanha_id === '777' && ap.resultado.anuncio_id === 'a1', 'aprovar cria campanha, conjunto, criativo e anúncio');
const posts = calls.filter((c) => c.m === 'POST').slice(antes);
const f = (i) => new URLSearchParams(posts[i].body);
ok(posts.length === 4 && /campaigns$/.test(posts[0].u) && /adsets$/.test(posts[1].u) && /adcreatives$/.test(posts[2].u) && /\/ads$/.test(posts[3].u), 'ordem: campanha → conjunto → criativo → anúncio');
ok(f(0).get('status') === 'PAUSED' && f(0).get('daily_budget') === '4000' && f(1).get('status') === 'PAUSED' && f(3).get('status') === 'PAUSED', 'tudo nasce PAUSADO e o orçamento vai na campanha (R$ 40 = 4000)');
const tg = JSON.parse(f(1).get('targeting'));
ok(tg.age_min === 25 && tg.age_max === 45 && tg.genders[0] === 2 && tg.geo_locations.countries[0] === 'BR' && f(1).get('optimization_goal') === 'LINK_CLICKS' && f(1).get('end_time'), 'público, meta de otimização e término no conjunto');
const spec = JSON.parse(f(2).get('object_story_spec'));
ok(spec.page_id === 'pg1' && spec.instagram_user_id === 'ig1' && spec.link_data.picture === base.imagem_url && spec.link_data.call_to_action.type === 'LEARN_MORE', 'criativo usa a página, o Instagram, a imagem e o CTA');
ok(JSON.parse(f(3).get('creative')).creative_id === 'c1' && f(3).get('adset_id') === 's1', 'anúncio liga o criativo ao conjunto');

// Leads no site com pixel
r = await proposeAction(T, { ...base, objetivo: 'OUTCOME_LEADS', pixel_id: 'px9' }, 't'); await approveAction(r.id, 'admin');
const lp = calls.filter((c) => c.m === 'POST' && /adsets$/.test(c.u)).pop();
ok(new URLSearchParams(lp.body).get('optimization_goal') === 'OFFSITE_CONVERSIONS' && /px9/.test(new URLSearchParams(lp.body).get('promoted_object')) && /LEAD/.test(new URLSearchParams(lp.body).get('promoted_object')), 'Leads no site otimiza por conversão com o pixel');
// WhatsApp
r = await proposeAction(T, { ...base, objetivo: 'OUTCOME_LEADS', destino: 'whatsapp', url_destino: undefined }, 't'); await approveAction(r.id, 'admin');
const wp = calls.filter((c) => c.m === 'POST' && /adsets$/.test(c.u)).pop(); const wc = calls.filter((c) => c.m === 'POST' && /adcreatives$/.test(c.u)).pop();
ok(new URLSearchParams(wp.body).get('destination_type') === 'WHATSAPP' && JSON.parse(new URLSearchParams(wc.body).get('object_story_spec')).link_data.call_to_action.type === 'WHATSAPP_MESSAGE', 'destino WhatsApp usa conversas e CTA de WhatsApp');

// falha no meio: informa o que já foi criado e não ativa nada
falhaCriativo = true;
r = await proposeAction(T, base, 't'); const bad = await approveAction(r.id, 'admin');
ok(bad.status === 'falhou' && /criativo/.test(bad.erro) && /campanha 777/.test(bad.erro) && /nada foi ativado/.test(bad.erro), 'falha no criativo informa o que já foi criado (pausado)');
falhaCriativo = false;

// ativação
const A = getPlatformTool('meta_ativar_estrutura');
const mark = calls.length;
r = await proposeAction(A, { id: '777' }, 't');
ok(r.status === 'pendente_aprovacao' && /1 conjunto/.test(r.avisos.join(' ')) && /1 anúncio/.test(r.avisos.join(' ')), 'ativação mostra o que será ligado');
ok(!calls.slice(mark).some((c) => c.m === 'POST'), 'ativar não escreve antes da aprovação');
const at = await approveAction(r.id, 'admin');
const ps = calls.slice(mark).filter((c) => c.m === 'POST');
ok(at.status === 'executado' && ps.length === 3 && ps.every((c) => /status=ACTIVE/.test(c.body)) && /\/a1$/.test(ps[2].u) && !ps.some((c) => /\/a2$/.test(c.u)), 'ativa campanha + conjunto + só os anúncios pausados');
fs.rmSync('./data/campanha-test', { recursive: true, force: true });
console.log(fails ? `${fails} falha(s)` : 'campanha ok'); process.exit(fails ? 1 : 0);
