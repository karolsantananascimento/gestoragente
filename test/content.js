// Testa o fluxo Hugo → Luiz → aprovação humana → Mariana, sem rede (fetch simulado).
import fs from 'node:fs';
process.env.DATA_DIR = './data/content-test';
process.env.DRY_RUN = 'false';
process.env.META_ACCESS_TOKEN = 'tk';
process.env.META_PAGE_ID = 'P1';
process.env.META_PAGE_ACCESS_TOKEN = 'pt';
process.env.INSTAGRAM_USER_ID = 'IG1';
process.env.PUBLIC_URL = 'https://app.exemplo.com';
fs.rmSync('./data/content-test', { recursive: true, force: true });

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), body: String(opts.body || '') });
  const u = String(url);
  if (u.startsWith('https://cdn.exemplo.com')) return new Response(Buffer.from('89504e47', 'hex'), { status: 200, headers: { 'content-type': 'image/png' } });
  const body = u.endsWith('/photos') ? { id: 'ph1', post_id: 'P1_99' } : u.endsWith('/media') ? { id: 'cont1' } : { id: 'media9' };
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
};

const { store } = await import('../src/store.js');
const c = await import('../src/content.js');
const { callTool, allTools } = await import('../src/tools.js');

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FALHA'} ${msg}`); if (!cond) fails++; };
const future = new Date(Date.now() + 3 * 86400e3).toISOString();

try {
  // kit da marca padrão (Disco) chega ao Luiz
  const mk = await callTool('marca_ver', {});
  ok(mk.nome === 'Disco' && /#78D600/.test(mk.cores) && /ANTON/i.test(mk.fontes) && /storytelling/i.test(mk.objetivo_conteudo) && /a gente/.test(mk.tom_de_voz) && mk.logo_url === 'https://app.exemplo.com/brand/disco-logo-branco-verde.svg', 'marca_ver entrega o kit Disco (cores, fontes, estilo, logo) ao Luiz');

  // fila de trabalho autônoma: Hugo vê as semanas sem pauta
  let q = await callTool('time_proximas_tarefas', { semanas: 2 });
  ok(q.meta_semanal === 3 && q.hugo.semanas.length >= 1 && q.hugo.semanas[0].datas_sugeridas.length > 0, 'time_proximas_tarefas diz ao Hugo quantos posts faltam e em que datas');
  const w0 = q.hugo.semanas[0];
  for (const d of w0.datas_sugeridas) await callTool('hugo_criar_pauta', { titulo: 'Auto ' + d, legenda: 'l', briefing_arte: 'b', canais: ['instagram'], data_publicacao: d });
  const q2 = await callTool('time_proximas_tarefas', { semanas: 2 });
  ok(!q2.hugo.semanas.some((w) => w.semana_de === w0.semana_de), 'depois de criar as pautas sugeridas a semana fica completa (sem passar da meta)');
  ok(q2.luiz.pendentes.length === w0.datas_sugeridas.length, 'as pautas aparecem na fila do Luiz');

  // Hugo cria pela ferramenta
  let r = await callTool('hugo_criar_pauta', { titulo: 'Lançamento', legenda: 'Legenda #um', briefing_arte: 'Fundo roxo, texto curto', canais: ['instagram', 'facebook', 'linkedin'], data_publicacao: future }, 'mcp');
  ok(r.status === 'ok' && r.conteudo.status === 'em_arte', 'Hugo cria a pauta e ela nasce em "em_arte"');
  const id = r.conteudo.id;

  r = await callTool('hugo_criar_pauta', { titulo: 'x', legenda: 'y', briefing_arte: 'z', canais: ['orkut'], data_publicacao: future });
  ok(r.status === 'erro', 'canal inexistente é recusado');

  // Mariana não agenda sem aprovação
  r = await callTool('mariana_agendar', { id });
  ok(r.status === 'erro' && /aprovado/.test(r.erro), 'Mariana recusa conteúdo não aprovado por humano');
  ok((await c.approveItem(id, 'adm@x.com')).error, 'não dá para aprovar antes de existir arte');

  // Luiz entrega
  r = await callTool('luiz_registrar_arte', { id, arte_url: 'http://inseguro/arte.png' });
  ok(r.status === 'erro', 'link de arte sem https é recusado');
  r = await callTool('luiz_registrar_arte', { id, arte_url: 'https://cdn.exemplo.com/arte.png' });
  ok(r.conteudo.status === 'aguardando_aprovacao', 'Luiz entrega e o conteúdo vai para aprovação humana');

  // pedir ajustes e reentregar
  c.requestChanges(id, 'logo maior', 'adm@x.com');
  ok(store.getContent(id).status === 'ajustes', 'administradora pede ajustes');
  r = await callTool('luiz_registrar_arte', { id, arte_url: 'https://cdn.exemplo.com/arte2.png' });
  ok(r.conteudo.status === 'aguardando_aprovacao', 'Luiz refaz e volta para aprovação');

  ok(/^https:\/\/app\.exemplo\.com\/media\/[a-f0-9]{32}$/.test(store.getContent(id).arte_url) && store.getContent(id).arte_origem.includes('arte2'), 'a arte é copiada e passa a ter link próprio e estável (links do Canva expiram)');

  // nenhuma ferramenta de IA aprova conteúdo
  ok(!allTools.some((t) => /aprov/.test(t.name) && /conteudo|post|pauta/.test(t.name)), 'não existe ferramenta de IA para aprovar conteúdo');

  // aprovação humana → Mariana agenda
  const a = await c.approveItem(id, 'adm@x.com');
  const it = a.item;
  ok(it.status === 'agendado', 'aprovação humana dispara o agendamento');
  ok(it.canais_status.facebook.status === 'agendado' && it.canais_status.facebook.externalId === 'P1_99', 'Facebook agendado dentro da rede');
  ok(it.canais_status.instagram.status === 'na_fila', 'Instagram fica na fila do agendador');
  ok(it.canais_status.linkedin.status === 'sem_integracao', 'LinkedIn sem integração é dito com clareza');
  const fb = calls.find((x) => x.url.endsWith('/P1/photos'));
  ok(fb && fb.body.includes('published=false') && fb.body.includes('scheduled_publish_time='), 'chamada do Facebook usa published=false + scheduled_publish_time');
  ok(!calls.some((x) => x.url.endsWith('/IG1/media_publish')), 'Instagram ainda não foi publicado antes da hora');

  // chega a hora
  store.updateContent(id, { data_publicacao: new Date(Date.now() - 60000).toISOString() });
  await c.tick();
  const done = store.getContent(id);
  ok(calls.some((x) => x.url.endsWith('/IG1/media_publish')), 'na hora marcada o agendador publica no Instagram');
  ok(done.canais_status.instagram.status === 'publicado' && done.status === 'publicado', 'conteúdo termina como publicado');

  // data sem fuso = Recife
  ok(c.parseWhen('2026-11-03T10:00').toISOString() === '2026-11-03T13:00:00.000Z', 'datas sem fuso valem em horário de Recife (UTC-3)');

  // sem data não aprova
  const n = c.createItem({ titulo: 'a', legenda: 'b', briefing_arte: 'c', canais: 'instagram' }, 'x').item;
  await c.submitArt(n.id, { arte_url: 'https://x.com/a.png' }, 'luiz');
  ok((await c.approveItem(n.id, 'adm')).error?.includes('data'), 'não aprova sem data de publicação');
} catch (e) { console.error('ERRO NO TESTE:', e); fails++; }
fs.rmSync('./data/content-test', { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\nTodos os testes passaram');
process.exit(fails ? 1 : 0);
