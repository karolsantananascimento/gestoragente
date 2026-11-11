import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Vídeos de criativo: ficam num arquivo temporário (nunca no banco), só até subirem ao Meta.
export const MAX_VIDEO = 100 * 1024 * 1024; // 100 MB
export const TIPOS_VIDEO = ['video/mp4', 'video/quicktime'];
const PREFIXO = 'gestoragente-video-';
const caminho = (id) => path.join(os.tmpdir(), `${PREFIXO}${id}`);
export const idValido = (id) => /^[a-f0-9]{32}$/.test(String(id || ''));

export const videoExiste = (id) => idValido(id) && fs.existsSync(caminho(id));
export const videoTamanho = (id) => fs.statSync(caminho(id)).size;
export const videoCaminho = caminho;
export function apagarVideo(id) { try { fs.unlinkSync(caminho(id)); return true; } catch { return false; } }

// Grava o corpo da requisição em disco, em stream (sem carregar o vídeo na memória) e respeitando o limite de tamanho.
export async function salvarVideo(req) {
  const id = crypto.randomBytes(16).toString('hex'); const alvo = caminho(id); let total = 0;
  const limite = new Transform({ transform(chunk, _e, cb) { total += chunk.length; cb(total > MAX_VIDEO ? new Error('O vídeo passa de 100 MB. Comprima ou corte antes de enviar.') : null, chunk); } });
  try { await pipeline(req, limite, fs.createWriteStream(alvo)); }
  catch (e) { try { fs.unlinkSync(alvo); } catch {} throw e; }
  if (!total) { try { fs.unlinkSync(alvo); } catch {} throw new Error('Arquivo vazio.'); }
  return { id, bytes: total };
}

// Vídeos enviados e nunca usados somem em 48 h.
export function limparVideos(maxMs) {
  let n = 0;
  try {
    for (const f of fs.readdirSync(os.tmpdir())) {
      if (!f.startsWith(PREFIXO)) continue;
      const p = path.join(os.tmpdir(), f);
      try { if (Date.now() - fs.statSync(p).mtimeMs > maxMs) { fs.unlinkSync(p); n++; } } catch {}
    }
  } catch {}
  return n;
}
