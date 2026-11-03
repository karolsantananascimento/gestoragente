// Gera as artes do Disco (estilo CLARO da direção visual vigente) a partir da planilha src/pautas/disco-novembro-completo.csv.
// Texto exato da planilha, Anton + Inter, círculo verde #78D600, pílula preta. Saída: public/brand/disco-nov/*.jpg e src/artes/disco-novembro.json.
// Uso: NODE_PATH=$(npm root -g) node tools/gerar-artes-disco.mjs   (precisa do Playwright; é só ferramenta de desenvolvimento)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parseCsv } from '../src/planilha.js';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.join(aqui, '..');
const OUT = path.join(raiz, 'public/brand/disco-nov');
// fontes embutidas em base64 (o navegador não carrega file:// a partir de about:blank)
const font = (f) => `data:font/woff2;base64,${fs.readFileSync(path.join(aqui, 'fonts', f)).toString('base64')}`;
const logo = fs.readFileSync(path.join(raiz, 'public/brand/disco-logo-branco-verde.svg'), 'utf8').replace(/fill:white/g, 'fill:rgb(17,17,17)').replace(/width="100%" height="100%"/, 'width="100%" height="100%" preserveAspectRatio="xMinYMin meet"');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- planilha ----------
const rows = parseCsv(fs.readFileSync(path.join(raiz, 'src/pautas/disco-novembro-completo.csv'), 'utf8')).slice(1);
const porId = Object.fromEntries(rows.map((r) => [r[0], { id: r[0], formato: r[2], arte: r[3], legenda: r[4] }]));

// ---------- textos de cada peça (exatos da planilha) ----------
const FEEDS = {
  'NOV-07': { titulo: 'Matrícula não se conquista em janeiro.', kw: 'janeiro', apoio: 'Se constrói o ano todo.', pilula: 'Leia a legenda' },
  'NOV-11': { titulo: 'Marketing que se prova em resultado, não em curtida.', kw: 'resultado', pilula: 'Veja nos destaques' },
  'NOV-15': { titulo: 'Consciência Negra não é uma data. É um compromisso de todos os dias.', kw: 'compromisso', apoio: '20 de novembro, Dia Nacional de Zumbi e da Consciência Negra.' },
  'NOV-17': { titulo: 'Black Friday boa não é a que tem mais desconto. É a que sobra lucro.', kw: 'sobra lucro', pilula: 'Leia a legenda' },
};
const CAPAS = { // reels: capa 9:16 (zonas seguras: ~250 px no topo e ~340 px na base)
  'NOV-06': { titulo: '5 coisas que toda instituição de ensino precisa saber sobre marketing.', kw: 'marketing', kicker: 'Reels' },
  'NOV-10': { titulo: 'Como calcular o retorno do seu marketing.', kw: 'retorno', apoio: 'Em 30 segundos.', kicker: 'Reels' },
  'NOV-14': { titulo: '5 coisas que todo dono de clínica deveria saber sobre marketing.', kw: 'clínica', kicker: 'Reels' },
  'NOV-16': { titulo: 'Minha empresa é pequena. Vale a pena entrar na Black Friday?', kw: 'Black Friday', apoio: 'Vale, mas não do jeito que a maioria faz.', kicker: 'Reels' },
  'NOV-18': { titulo: '3 erros na Black Friday.', kw: 'erros', apoio: 'Os que mais transformam venda em prejuízo.', kicker: 'Reels' },
};
const CARROSSEIS = ['NOV-05', 'NOV-09', 'NOV-13', 'NOV-19'];

// "Capa: a — b" / "2: título — corpo" → lâminas estruturadas
function lerSlides(arte) {
  const linhas = arte.split('\n').map((x) => x.trim()).filter(Boolean);
  return linhas.map((l, i) => {
    const t = l.replace(/^\s*(?:capa|\d+)\s*:\s*/i, '').replace(/^\s*\((?:capa|cta)\)\s*:?\s*/i, '');
    let seg = t.split(' — ').map((x) => x.trim().replace(/(?!^✅)[\p{Extended_Pictographic}\uFE0F]/gu, '').replace(/\s{2,}/g, ' ').trim()).filter((x) => x && !/\[[^\]]*\]/.test(x));
    let kicker = '', titulo = '', corpo = [];
    if (!seg.length) return null;
    if (seg.length === 1) { // sem separadores: primeira frase (ou pergunta) é o título; o resto, corpo (na capa vira a pílula)
      const m = seg[0].match(/^(.+?[.?!])\s+(.+)$/s);
      if (m) { titulo = m[1]; corpo = [m[2]]; } else titulo = seg[0];
    } else if (i > 0 && seg.length >= 2 && seg[0].length <= 16) { kicker = seg[0]; titulo = seg[1]; corpo = seg.slice(2); }
    else { titulo = seg[0]; corpo = seg.slice(1); }
    return { kicker, titulo, corpo };
  }).filter(Boolean);
}

// ---------- HTML ----------
const CSS = `
@font-face{font-family:Anton;src:url(${font('anton-latin-400-normal.woff2')});}
@font-face{font-family:Inter;font-weight:400;src:url(${font('inter-latin-400-normal.woff2')});}
@font-face{font-family:Inter;font-weight:500;src:url(${font('inter-latin-500-normal.woff2')});}
@font-face{font-family:Inter;font-weight:700;src:url(${font('inter-latin-700-normal.woff2')});}
*{box-sizing:border-box;margin:0;padding:0}
body{width:var(--w);height:var(--h);background:#EDEDEA;position:relative;overflow:hidden;font-family:Inter,sans-serif;color:#111}
.papel{position:absolute;inset:0;opacity:.06;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/></filter><rect width='300' height='300' filter='url(%23n)'/></svg>")}
.circ{position:absolute;border-radius:50%;background:#78D600}
.dots{position:absolute;border-radius:50%;overflow:hidden}
.dots::after{content:'';position:absolute;inset:0;background-image:radial-gradient(#111 22%,transparent 24%);background-size:26px 26px;opacity:.16;-webkit-mask-image:linear-gradient(135deg,#000 0%,transparent 60%);mask-image:linear-gradient(135deg,#000 0%,transparent 60%)}
.logo{position:absolute;left:72px;top:64px;width:170px;height:52px}
.cont{position:absolute;right:72px;top:74px;font:500 28px Inter;letter-spacing:.06em;color:#111}
.tit{position:absolute;font-family:Anton;text-transform:uppercase;line-height:.98;letter-spacing:.005em;color:#111}
.v{color:#78D600}
.apoio{position:absolute;font:500 38px/1.3 Inter;color:#111}
.corpo{position:absolute;font:400 40px/1.38 Inter;color:#111}
.corpo p{margin-bottom:24px}.corpo ul{list-style:none}.corpo li{position:relative;padding-left:46px;margin-bottom:20px}
.corpo li::before{content:'';position:absolute;left:0;top:.5em;width:22px;height:22px;border-radius:50%;background:#78D600}
.pil{position:absolute;left:72px;max-width:880px;background:#111;color:#fff;font:700 32px/1.2 Inter;padding:26px 48px;border-radius:999px;display:inline-flex;gap:16px;align-items:center}
.kick{position:absolute;font:700 28px Inter;letter-spacing:.14em;text-transform:uppercase;color:#111}
.kick::before{content:'';display:inline-block;width:18px;height:18px;border-radius:50%;background:#78D600;margin-right:14px;vertical-align:-1px}
.pilares{position:absolute;left:72px;right:72px;display:flex;gap:34px;font:500 22px Inter;letter-spacing:.12em;text-transform:uppercase;color:#111}
.pilares span::before{content:'';display:inline-block;width:12px;height:12px;border-radius:50%;background:#78D600;margin-right:10px}
`;
const PIL = '';
function tituloHtml(texto, kw) { // palavra-chave e ponto final em verde
  let t = esc(texto.trim()); const fim = (t.match(/[.?!]$/) || [''])[0]; if (fim) t = t.slice(0, -1);
  if (kw) { const re = new RegExp(`(${esc(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![\\s\\S]*${esc(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i'); t = t.replace(re, '<span class="v">$1</span>'); }
  else { const i = t.lastIndexOf(' '); t = `${t.slice(0, i + 1)}<span class="v">${t.slice(i + 1)}</span>`; }
  return `${t}<span class="v">${fim || '.'}</span>`;
}
const pilula = (txt, top) => `<div class="pil" style="top:${top}px">${esc(txt)} <span>→</span></div>`;
const html = (w, h, corpo) => `<!doctype html><html><head><meta charset="utf-8"><style>:root{--w:${w}px;--h:${h}px}${CSS}</style></head><body><div class="papel"></div>${corpo}</body></html>`;

function feedHtml(f) {
  const circ = `<div class="circ" style="width:700px;height:700px;right:-190px;bottom:-190px"></div><div class="dots" style="width:700px;height:700px;right:-190px;bottom:-190px"></div>`;
  return html(1080, 1350, `${circ}<div class="logo">${logo}</div>
    <div class="tit" id="t" data-box="72,190,936,${f.apoio ? 520 : 600}" style="left:72px;top:190px;width:936px">${tituloHtml(f.titulo, f.kw)}</div>
    ${f.apoio ? `<div class="apoio" id="ap" style="left:72px;width:430px">${esc(f.apoio)}</div>` : ''}
    ${f.pilula ? pilula(f.pilula, 1110) : ''}${PIL}`);
}
function capaHtml(f) {
  return html(1080, 1920, `<div class="circ" style="width:860px;height:860px;right:-330px;top:1220px"></div><div class="dots" style="width:860px;height:860px;right:-330px;top:1220px"></div>
    <div class="logo" style="top:260px">${logo}</div><div class="cont" style="top:270px">${esc(f.kicker)}</div>
    <div class="tit" id="t" data-box="72,520,936,640" style="left:72px;top:520px;width:936px">${tituloHtml(f.titulo, f.kw)}</div>
    ${f.apoio ? `<div class="apoio" id="ap" style="left:72px;width:520px">${esc(f.apoio)}</div>` : ''}`);
}
function slideHtml(s, i, n, ultima) {
  const cont = `<div class="cont">${String(i + 1).padStart(2, '0')}/${String(n).padStart(2, '0')}</div>`;
  if (i === 0) { // capa
    return html(1080, 1350, `<div class="circ" style="width:700px;height:700px;right:-190px;bottom:-190px"></div><div class="dots" style="width:700px;height:700px;right:-190px;bottom:-190px"></div>
      <div class="logo">${logo}</div>${cont}
      <div class="tit" id="t" data-box="72,190,936,640" style="left:72px;top:190px;width:936px">${tituloHtml(s.titulo, null)}</div>
      ${s.corpo[0] ? pilula(s.corpo[0].replace(/\s*→\s*$/, ''), 1110) : ''}${PIL}`);
  }
  const lista = s.corpo.length > 1 && s.corpo.every((c) => /^✅/.test(c));
  const corpo = lista ? `<ul>${s.corpo.map((c) => `<li>${esc(c.replace(/^✅\s*/, ''))}</li>`).join('')}</ul>` : s.corpo.map((c) => `<p>${esc(c)}</p>`).join('');
  const circ = ultima
    ? `<div class="circ" style="width:620px;height:620px;right:-150px;bottom:-170px"></div><div class="dots" style="width:620px;height:620px;right:-150px;bottom:-170px"></div>`
    : `<div class="circ" style="width:420px;height:420px;right:-110px;bottom:-110px"></div>`;
  const tbox = ultima ? 560 : 400;
  return html(1080, 1350, `${circ}<div class="logo">${logo}</div>${cont}
    ${s.kicker && !/^cta$/i.test(s.kicker) ? `<div class="kick" style="left:72px;top:200px">${esc(s.kicker)}</div>` : ''}
    <div class="tit" id="t" data-box="72,270,936,${tbox}" style="left:72px;top:270px;width:936px">${tituloHtml(s.titulo, null)}</div>
    <div class="corpo" id="c" style="left:72px;width:${ultima ? 760 : 820}px">${corpo}</div>
    ${ultima ? pilula('Chamar no direct', 1110) : ''}`);
}

// ---------- render ----------
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(); const page = await browser.newPage();
const mapa = {}; let total = 0;
async function render(conteudo, w, h, arquivo) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(conteudo, { waitUntil: 'load' }); await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => { // ajusta o tamanho do título à caixa e posiciona o corpo logo abaixo
    const t = document.getElementById('t'); const [, , bw, bh] = t.dataset.box.split(',').map(Number);
    let fs = 200; t.style.fontSize = fs + 'px';
    while ((t.scrollHeight > bh || t.scrollWidth > bw + 2) && fs > 60) { fs -= 4; t.style.fontSize = fs + 'px'; }
    const c = document.getElementById('c'); if (c) c.style.top = (t.offsetTop + t.offsetHeight + 56) + 'px';
    const ap = document.getElementById('ap'); if (ap) ap.style.top = (t.offsetTop + t.offsetHeight + 44) + 'px';
  });
  await page.screenshot({ path: path.join(OUT, arquivo), type: 'jpeg', quality: 92 }); total++;
}
for (const [id, f] of Object.entries(FEEDS)) { await render(feedHtml(f), 1080, 1350, `${id}.jpg`); mapa[id] = [`/brand/disco-nov/${id}.jpg`]; }
for (const [id, f] of Object.entries(CAPAS)) { await render(capaHtml(f), 1080, 1920, `${id}.jpg`); mapa[id] = [`/brand/disco-nov/${id}.jpg`]; }
for (const id of CARROSSEIS) {
  const sl = lerSlides(porId[id].arte); mapa[id] = [];
  for (let i = 0; i < sl.length; i++) { const nome = `${id}-${String(i + 1).padStart(2, '0')}.jpg`; await render(slideHtml(sl[i], i, sl.length, i === sl.length - 1), 1080, 1350, nome); mapa[id].push(`/brand/disco-nov/${nome}`); }
}
await browser.close();
const saida = Object.entries(mapa).map(([id, arquivos]) => ({ origem: `disco-novembro-completo:${id}`, arquivos, nota: 'Arte no estilo claro da Disco (Anton + Inter, círculo verde), texto exato da planilha.' }));
fs.writeFileSync(path.join(raiz, 'src/artes/disco-novembro.json'), JSON.stringify(saida, null, 2) + '\n');
console.log(`${total} imagens geradas em ${OUT}`);
