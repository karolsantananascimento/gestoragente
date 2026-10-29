// Testa o fluxo Hugo → Luiz → aprovação humana → Mariana, sem rede (fetch simulado).
import fs from 'node:fs';
process.env.DATA_DIR = './data/content-test';
process.env.DRY_RUN = 'false';
process.env.META_ACCESS_TOKEN = 'tk';
process.env.META_PAGE_ID = 'P1';
process.env.META_PAGE_ACCESS_TOKEN = 'pt';
process.env.INSTAGRAM_USER_ID = 'IG1';
process.env.OPENAI_API_KEY = 'sk-teste';
process.env.IMAGE_DAILY_CAP = '2';
process.env.PUBLIC_URL = 'https://app.exemplo.com';
fs.rmSync('./data/content-test', { recursive: true, force: true });

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), body: String(opts.body || '') });
  const u = String(url);
  if (u.startsWith('https://cdn.exemplo.com')) return new Response(Buffer.from('89504e47', 'hex'), { status: 200, headers: { 'content-type': 'image/png' } });
  if (u.includes('api.openai.com/v1/images')) return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('jpg').toString('base64') }] }), { status: 200, headers: { 'content-type': 'application/json' } });
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
  let q = (await callTool('time_proximas_tarefas', { semanas: 2, cliente: 'Disco' })).squads[0];
  ok(q.meta_semanal === 2 && q.hugo.semanas.length >= 1 && q.hugo.semanas[0].datas_sugeridas.length > 0, 'time_proximas_tarefas diz ao Hugo quantos posts faltam e em que datas');
  const w0 = q.hugo.semanas[0];
  for (const d of w0.datas_sugeridas) await callTool('hugo_criar_pauta', { cliente: 'Disco', titulo: 'Auto ' + d, legenda: 'l', briefing_arte: 'b', canais: ['instagram'], data_publicacao: d });
  const q2 = (await callTool('time_proximas_tarefas', { semanas: 2, cliente: 'Disco' })).squads[0];
  ok(!q2.hugo.semanas.some((w) => w.semana_de === w0.semana_de), 'depois de criar as pautas sugeridas a semana fica completa (sem passar da meta)');
  ok(q2.luiz.pendentes.length === w0.datas_sugeridas.length, 'as pautas aparecem na fila do Luiz');

  // Hugo cria pela ferramenta
  let r = await callTool('hugo_criar_pauta', { cliente: 'Disco', titulo: 'Lançamento', legenda: 'Legenda #um', briefing_arte: 'Fundo roxo, texto curto', canais: ['instagram', 'facebook', 'linkedin'], data_publicacao: future }, 'mcp');
  ok(r.status === 'ok' && r.conteudo.status === 'em_arte', 'Hugo cria a pauta e ela nasce em "em_arte"');
  const id = r.conteudo.id;

  r = await callTool('hugo_criar_pauta', { cliente: 'Disco', titulo: 'x', legenda: 'y', briefing_arte: 'z', canais: ['orkut'], data_publicacao: future });
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

  // Luiz gera imagem com o ChatGPT (OpenAI), com teto diário
  const g = await callTool('luiz_gerar_imagem', { prompt: 'orbe verde sobre fundo preto', formato: 'retrato' }, 'mcp');
  ok(g.status === 'ok' && /^https:\/\/app\.exemplo\.com\/media\/[a-f0-9]{32}$/.test(g.imagem_url), 'luiz_gerar_imagem devolve link público da imagem');
  const oa = calls.find((x) => x.url.includes('api.openai.com'));
  ok(oa && JSON.parse(oa.body).size === '1024x1536' && /NÃO escreva texto/.test(JSON.parse(oa.body).prompt), 'pedido à OpenAI leva formato e regras da marca (sem texto na imagem)');
  const full = await callTool('luiz_gerar_imagem', { prompt: 'post lista', modo: 'arte_completa', texto: '5 SINAIS PARA RENOVAR SEU SITE' }, 'mcp');
  ok(full.status === 'ok' && full.referencias_usadas >= 1 && calls.some((x) => x.url.endsWith('/images/edits')), 'arte_completa envia as referências visuais da marca ao endpoint de edição');
  ok((await callTool('luiz_gerar_imagem', { prompt: 'sem texto', modo: 'arte_completa' }, 'mcp')).error?.includes('texto'), 'arte_completa exige o texto exato');
  ok((await callTool('luiz_gerar_imagem', { prompt: 'y' }, 'mcp')).error?.includes('Teto diário'), 'teto diário de imagens é respeitado');

  // data sem fuso = Recife
  ok(c.parseWhen('2026-11-03T10:00').toISOString() === '2026-11-03T13:00:00.000Z', 'datas sem fuso valem em horário de Recife (UTC-3)');

  // sem data não aprova
  const n = c.createItem({ titulo: 'a', legenda: 'b', briefing_arte: 'c', canais: 'instagram' }, 'x').item;
  await c.submitArt(n.id, { arte_url: 'https://x.com/a.png' }, 'luiz');
  ok((await c.approveItem(n.id, 'adm')).error?.includes('data'), 'não aprova sem data de publicação');

  // Pedidos escritos no painel
  ok(c.createRequest({ texto: 'curto' }, 'u@x.com').error, 'pedido muito curto é recusado');
  ok(c.createRequest({ texto: 'Post sobre site lento para a Disco', canais: 'orkut' }, 'u@x.com').error, 'pedido com canal inválido é recusado');
  const rq = c.createRequest({ texto: 'Post sobre site lento para a Disco', canais: 'instagram' }, 'u@x.com').pedido;
  const tasks = (await callTool('time_proximas_tarefas', { cliente: 'Disco' }, 'mcp')).squads[0];
  ok(tasks.pedidos_da_usuaria?.pedidos?.some((p) => p.pedido_id === rq.id), 'pedido aparece nas tarefas do time');
  const np = await callTool('hugo_criar_pauta', { cliente: 'Disco', titulo: 'Site lento', legenda: 'l', briefing_arte: 'b', canais: ['instagram'], data_publicacao: '2030-01-01', pedido_id: rq.id }, 'mcp');
  ok(np.status === 'ok' && c.listRequests('aberto').length === 0 && c.listRequests('atendido')[0]?.item_id === np.conteudo.id, 'criar pauta com pedido_id fecha o pedido');
  const rq2 = c.createRequest({ texto: 'Outro post para cancelar depois' }, 'u@x.com').pedido;
  ok(c.cancelRequest(rq2.id, 'u@x.com').pedido.status === 'cancelado', 'pedido pode ser cancelado');
  // ajuste de criativo antes da aprovação
  ok(c.requestChanges(np.conteudo.id, '', 'u@x.com').error, 'ajuste exige descrição');
  const aj = c.requestChanges(np.conteudo.id, 'trocar a foto', 'u@x.com');
  ok(aj.item?.status === 'ajustes' && aj.item.feedback === 'trocar a foto', 'ajuste pode ser pedido logo na etapa em arte');
  ok(c.requestChanges(np.conteudo.id, 'título menor', 'u@x.com').item.feedback === 'trocar a foto | título menor', 'ajustes pendentes se acumulam');

  // Aprovação escolhendo contas e publicando na hora
  const qa = c.createItem({ titulo: 'agora', legenda: 'l', briefing_arte: 'b', canais: 'instagram, facebook' }, 'x').item;
  await c.submitArt(qa.id, { arte_url: 'https://x.com/a.png' }, 'luiz');
  ok((await c.approveItem(qa.id, 'adm', { canais: ['orkut'] })).error, 'aprovação recusa conta inválida');
  ok((await c.approveItem(qa.id, 'adm', { canais: [], modo: 'agora' })).error, 'aprovação exige ao menos uma conta');
  const before = calls.length;
  const rq3 = await c.approveItem(qa.id, 'adm', { canais: ['instagram'], modo: 'agora' });
  ok(rq3.item?.canais.join() === 'instagram' && rq3.item.status === 'publicado' && rq3.item.canais_status.instagram.status === 'publicado', 'publicar agora publica só nas contas escolhidas, sem exigir data');
  ok(calls.slice(before).some((x) => x.url.endsWith('/IG1/media_publish')) && !calls.slice(before).some((x) => x.url.includes('/photos')), 'só o Instagram recebeu a publicação');

  // Squads por cliente
  const nomes = store.clientes().map((x) => `${x.nome}:${x.meta_semanal}`).join('|');
  ok(nomes === 'Disco:2|Michie Farfan:2|Operizy:7|Senhorita Moça:3|Lumiere:2|ContraFluxo Pratas:2', 'os 6 clientes nascem com a meta semanal combinada');
  ok(c.planoSemanas(2, 'Operizy')[1].datas_sugeridas.length === 7, 'Operizy (1 por dia) ganha 7 datas sugeridas por semana');
  const sq = (await callTool('time_proximas_tarefas', {}, 'mcp')).squads;
  ok(sq.length === 6 && sq.find((x) => x.cliente === 'Lumiere').aguardando_identidade && !sq.find((x) => x.cliente === 'Lumiere').hugo, 'cliente sem kit completo não recebe tarefas de criação');
  const bloq = await callTool('hugo_criar_pauta', { cliente: 'Lumiere', titulo: 't', legenda: 'l', briefing_arte: 'b', canais: ['instagram'], data_publicacao: '2030-01-01' }, 'mcp');
  ok(bloq.status === 'erro' && /incompleto/.test(bloq.erro), 'Hugo recusa criar pauta para cliente com kit incompleto');
  const m = store.cliente('Michie Farfan');
  Object.assign(m.marca, { identidade: 'Marca X', tom_de_voz: 'caloroso', estilo_visual: 'claro e minimalista', estilo_comunicacao: 'frases curtas' });
  ok((await callTool('marca_ver', { cliente: 'Michie Farfan' }, 'mcp')).estilo_visual === 'claro e minimalista', 'marca_ver devolve o kit do cliente pedido, não o da Disco');
  const pm = await callTool('hugo_criar_pauta', { cliente: 'Michie Farfan', titulo: 'Post Michie', legenda: 'l', briefing_arte: 'b', canais: ['instagram'], data_publicacao: '2030-01-01' }, 'mcp');
  ok(pm.status === 'ok' && pm.conteudo.cliente === 'Michie Farfan', 'pauta nasce na área do cliente');
  ok((c.listItems)('em_arte', 'Michie Farfan').length === 1 && !(c.listItems)(null, 'Michie Farfan').some((x) => x.cliente_id !== 'michie-farfan'), 'a área do cliente só lista as pautas dele');
  await c.submitArt(pm.conteudo.id, { arte_url: 'https://x.com/m.png' }, 'luiz');
  const antes = calls.length;
  const am = await c.approveItem(pm.conteudo.id, 'adm', { canais: ['instagram'], modo: 'agora' });
  ok(am.item.canais_status.instagram.status === 'sem_integracao' && !calls.slice(antes).some((x) => x.url.includes('/media')), 'cliente sem conta própria NUNCA publica no Instagram da Disco');
  m.contas = { ig_user_id: '777', fb_page_id: '' };
  const pm2 = c.createItem({ cliente: 'Michie Farfan', titulo: 'Post 2', legenda: 'l', briefing_arte: 'b', canais: 'instagram', data_publicacao: '2030-01-01' }, 'hugo').item;
  await c.submitArt(pm2.id, { arte_url: 'https://x.com/m2.png' }, 'luiz');
  const antes2 = calls.length;
  await c.approveItem(pm2.id, 'adm', { canais: ['instagram'], modo: 'agora' });
  ok(calls.slice(antes2).some((x) => x.url.includes('/777/media')), 'com conta própria cadastrada, publica no Instagram do cliente');
} catch (e) { console.error('ERRO NO TESTE:', e); fails++; }
fs.rmSync('./data/content-test', { recursive: true, force: true });
console.log(fails ? `\n${fails} falha(s)` : '\nTodos os testes passaram');
process.exit(fails ? 1 : 0);
