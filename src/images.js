import crypto from 'node:crypto';
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
    'Estilo obrigatório da marca: fundo preto (#0B0B0B), alto contraste, fotografia ou ilustração editorial, formas orbitais/circulares e textura halftone, composição limpa com bastante espaço vazio para o título.',
    cores ? `Paleta: ${cores}. Use UM acento por imagem.` : '',
    'NÃO escreva texto, letras, números, logotipos ou marcas d\'água na imagem (o texto é aplicado depois no Canva). Sem rostos de pessoas reais ou celebridades. Sem elementos de outras marcas.',
  ].filter(Boolean).join('\n');
}

export async function gerarImagem({ prompt, formato = 'retrato' }) {
  if (!config.openaiKey) throw new NotConfigured('OPENAI_API_KEY não configurada no servidor (Render → Environment).');
  if (!String(prompt || '').trim()) return { error: 'Descreva a imagem (prompt).' };
  const origin = config.publicUrl;
  if (!origin) return { error: 'PUBLIC_URL não configurada; sem ela não há link público para a imagem.' };

  const hoje = new Date().toISOString().slice(0, 10);
  const usadas = store.audit().filter((e) => e.type === 'imagem_gerada' && e.at.startsWith(hoje)).length;
  if (usadas >= config.imageDailyCap) return { error: `Teto diário de ${config.imageDailyCap} imagens atingido (IMAGE_DAILY_CAP). Tente amanhã ou peça à administradora para aumentar.` };

  const body = { model: config.openaiImageModel, prompt: brandPrompt(prompt, store.brand()), size: SIZES[formato] || SIZES.retrato, n: 1, quality: config.openaiImageQuality, output_format: 'jpeg', output_compression: 88 };
  if (config.dryRun) return { status: 'simulado', aviso: 'DRY_RUN ligado: nenhuma imagem foi gerada nem cobrada.', pedido: { ...body, prompt: body.prompt.slice(0, 200) + '…' } };

  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.openaiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(170_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { error: `OpenAI recusou o pedido (HTTP ${r.status}): ${j.error?.message || 'sem detalhe'}` };
  const b64 = j.data?.[0]?.b64_json;
  if (!b64) return { error: 'A OpenAI não devolveu imagem.' };
  const id = crypto.randomBytes(16).toString('hex');
  store.setMedia(id, { type: 'image/jpeg', data: b64, at: new Date().toISOString() });
  store.log({ type: 'imagem_gerada', id, modelo: config.openaiImageModel });
  return { status: 'ok', imagem_url: `${origin}/media/${id}`, formato: body.size, proximo_passo: 'Envie essa imagem ao Canva (upload-asset-from-url) e use como fundo do design; aplique título (Anton), logo e CTA no Canva.' };
}
