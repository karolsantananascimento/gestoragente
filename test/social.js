// Testa a publicação no Instagram/Facebook com a API do Meta simulada.
import fs from 'node:fs';
process.env.DATA_DIR = './data/social-test';
process.env.DRY_RUN = 'false';
process.env.META_ACCESS_TOKEN = 'tk'; process.env.META_PAGE_ID = 'P1'; process.env.META_PAGE_ACCESS_TOKEN = 'pt'; process.env.INSTAGRAM_USER_ID = 'IG1';
fs.rmSync('./data/social-test', { recursive: true, force: true });
const { store } = await import('../src/store.js'); await store.init();
const { adapters, diagnostico } = await import('../src/platforms/social.js');

const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url); const body = opts.body ? Object.fromEntries(new URLSearchParams(opts.body)) : {};
  calls.push({ u, body });
  const json = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json' } });
  if (u.startsWith('https://img.exemplo.com')) return new Response('x', { status: u.includes('quebrado') ? 404 : 200 });
  if (/\/IG1\/media$/.test(u)) return json({ id: 'C' + calls.length });
  if (/\/C\d+\?fields=status_code/.test(u)) return json({ status_code: 'FINISHED' });
  if (/\/IG1\/media_publish$/.test(u)) return json({ id: 'POST1' });
  if (/\/me\?fields/.test(u)) return json({ id: '1', name: 'Sistema' });
  if (/\/me\/permissions/.test(u)) return json({ data: [{ permission: 'pages_show_list', status: 'granted' }] });
  if (/\/me\/accounts/.test(u)) return json({ data: [{ id: 'P9', name: 'Operizy', instagram_business_account: { id: 'IG9', username: 'operizy' } }] });
  return json({ error: { message: 'inesperado ' + u } }, 400);
};
let fails = 0; const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FALHA'} ${m}`); if (!c) fails++; };
const item = (o) => ({ cliente_id: 'disco', legenda: 'Oi', arte_url: 'https://img.exemplo.com/a.jpg', formato: 'feed', ...o });

let r = await adapters.instagram.publicar(item());
ok(r.id === 'POST1' && !r.nota, 'feed: cria container e publica');
ok(calls.some((c) => c.body.image_url && c.body.caption === 'Oi'), 'feed envia imagem e legenda');

calls.length = 0;
r = await adapters.instagram.publicar(item({ formato: 'carrossel', arte_urls: ['https://img.exemplo.com/1.jpg', 'https://img.exemplo.com/2.jpg'] }));
const kids = calls.filter((c) => c.body.is_carousel_item === 'true').length;
ok(kids === 2 && calls.some((c) => c.body.media_type === 'CAROUSEL' && c.body.children.split(',').length === 2), 'carrossel: 2 filhos + container pai');

r = await adapters.instagram.publicar(item({ formato: 'reels' }));
ok(/Reels precisa de vídeo/.test(r.nota), 'reels só com imagem: publica como feed e avisa');

calls.length = 0;
await adapters.instagram.publicar(item({ formato: 'reels', arte_url: 'https://img.exemplo.com/v.mp4' }));
ok(calls.some((c) => c.body.media_type === 'REELS' && c.body.video_url), 'reels com vídeo: media_type REELS');

let msg = ''; try { await adapters.instagram.publicar(item({ arte_url: 'https://img.exemplo.com/quebrado.jpg' })); } catch (e) { msg = e.message; }
ok(/precisa ser público/.test(msg), 'link da arte quebrado: erro claro antes de chamar o Meta');

const d = await diagnostico('disco');
ok(d.token.ok && d.paginas[0]?.ig?.id === 'IG9' && d.permissoes.faltam.includes('instagram_content_publish'), 'diagnóstico lista páginas/IG e permissões que faltam');
fs.rmSync('./data/social-test', { recursive: true, force: true });
if (fails) { console.log(`${fails} falha(s)`); process.exit(1); }
console.log('social ok'); process.exit(0);
