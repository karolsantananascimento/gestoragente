import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { store } from './store.js';
import { NotConfigured } from './http.js';

const SIZES = { retrato: '1024x1536', quadrado: '1024x1024', paisagem: '1536x1024' };

// Estilo fixo da Disco, anexado a todo pedido, para as imagens saírem no padrão da marca.
function brandPrompt(prompt, b = {}) {
  const cores = Array.isArray(b.cores) ? b.cores.join(', ') : (b.cores || '');
  return [
    prompt.trim(),
    '',
    'Estilo obrigatório da marca Disco: fotografia preto e branco de alto contraste e granulada, arquitetura brutalista/concreto, esferas de pedra, cubo de vidro ou objeto em recorte sobre fundo preto (#0B0B0B), iluminação dramática, composição limpa com bastante espaço vazio para o título. Os círculos coloridos e o halftone são aplicados depois no Canva.',
    cores ? `Paleta: ${cores}. Não pinte a imagem com essas cores: mantenha P&B.` : '',
    'NÃO escreva texto, letras, números, logotipos ou marcas d\'água na imagem (o texto é aplicado depois no Canva). Sem rostos de pessoas reais ou celebridades. Sem elementos de outras marcas.',
  ].filter(Boolean).join('\n');
}

const here = path.dirname(fileURLToPath(import.meta.url));

// Imagens de referência da marca (padrão visual aprovado), enviadas junto no modo arte_completa.
function referencias(b = {}) {
  const out = [];
  for (const u of (Array.isArray(b.referencias_visuais) ? b.referencias_visuais : []).slice(0, 3)) {
    if (!u.startsWith('/brand/')) continue;
    try { out.push({ name: path.basename(u), buf: fs.readFileSync(path.join(here, '..', 'public', u)) }); } catch {}
  }
  return out;
}

function promptCompleto(prompt, texto, b = {}) {
  return [
    prompt.trim(),
    '',
    'Crie uma arte final de redes sociais da marca Disco copiando FIELMENTE o padrão visual das imagens de referência anexas (mesma tipografia condensada pesada nos títulos, mesma paleta preto/verde #78D600/laranja #FAA51C/violeta #A56BE0, recortes P&B de concreto e esferas de pedra sobre círculos chapados, halftone, linhas técnicas finas, ícones de linha, CTA em pílula com seta). Não copie o conteúdo das referências, só o estilo e a estrutura.',
    b.modelo_lista_numerada ? `Estrutura quando for lista numerada: ${b.modelo_lista_numerada}` : '',
    'O texto da arte deve ser EXATAMENTE este, em português, sem erros, sem acrescentar nem trocar palavras:',
    texto.trim(),
    'Nenhuma outra frase, nenhum logotipo de outra marca, sem rostos de pessoas reais.',
  ].filter(Boolean).join('\n');
}

export async function gerarImagem({ prompt, formato = 'retrato', modo = 'fundo', texto = '' }) {
  if (!config.openaiKey) throw new NotConfigured('OPENAI_API_KEY não configurada no servidor (Render → Environment).');
  if (!String(prompt || '').trim()) return { error: 'Descreva a imagem (prompt).' };
  const completo = modo === 'arte_completa';
  if (completo && !String(texto || '').trim()) return { error: 'No modo arte_completa informe o texto exato da arte (parâmetro texto).' };
  const origin = config.publicUrl;
  if (!origin) return { error: 'PUBLIC_URL não configurada; sem ela não há link público para a imagem.' };

  const hoje = new Date().toISOString().slice(0, 10);
  const usadas = store.audit().filter((e) => e.type === 'imagem_gerada' && e.at.startsWith(hoje)).length;
  if (usadas >= config.imageDailyCap) return { error: `Teto diário de ${config.imageDailyCap} imagens atingido (IMAGE_DAILY_CAP). Tente amanhã ou peça à administradora para aumentar.` };

  const brand = store.brand();
  const refs = completo ? referencias(brand) : [];
  const size = config.openaiImageSizes[formato] || SIZES[formato] || SIZES.retrato;
  const body = { model: config.openaiImageModel, prompt: completo ? promptCompleto(prompt, texto, brand) : brandPrompt(prompt, brand), size, n: 1, quality: completo ? config.openaiImageQualityFinal : config.openaiImageQuality, output_format: 'jpeg', output_compression: 90 };
  if (config.dryRun) return { status: 'simulado', aviso: 'DRY_RUN ligado: nenhuma imagem foi gerada nem cobrada.', pedido: { ...body, prompt: body.prompt.slice(0, 200) + '…' } };

  let r;
  if (refs.length) {
    // Com referências: endpoint de edição, que aceita imagens de exemplo.
    const fd = new FormData();
    for (const [k, v] of Object.entries(body)) fd.append(k, String(v));
    for (const f of refs) fd.append('image[]', new Blob([f.buf], { type: 'image/png' }), f.name);
    r = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { authorization: `Bearer ${config.openaiKey}` }, body: fd, signal: AbortSignal.timeout(280_000) });
  } else {
    r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.openaiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(170_000),
    });
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { error: `OpenAI recusou o pedido (HTTP ${r.status}): ${j.error?.message || 'sem detalhe'}` };
  const b64 = j.data?.[0]?.b64_json;
  if (!b64) return { error: 'A OpenAI não devolveu imagem.' };
  const id = crypto.randomBytes(16).toString('hex');
  store.setMedia(id, { type: 'image/jpeg', data: b64, at: new Date().toISOString() });
  store.log({ type: 'imagem_gerada', id, modelo: config.openaiImageModel });
  return { status: 'ok', imagem_url: `${origin}/media/${id}`, formato: body.size, modo, referencias_usadas: refs.length, proximo_passo: completo ? 'Confira cada palavra da arte. Se estiver correta, registre com luiz_registrar_arte usando imagem_url (ela já é um link estável do sistema). Se houver erro de texto, gere de novo ou corrija no Canva.' : 'Envie essa imagem ao Canva (upload-asset-from-url) e use como fundo do design; aplique título (Anton), logo e CTA no Canva.' };
}
