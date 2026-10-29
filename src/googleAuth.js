import crypto from 'node:crypto';
import { config } from './config.js';

// Verifica o ID token do "Entrar com Google" (Google Identity Services) localmente:
// assinatura RS256 contra as chaves públicas do Google + emissor, público (client id), validade e e-mail verificado.
let certCache = { keys: [], exp: 0 };
async function fetchGoogleKeys() {
  if (Date.now() < certCache.exp && certCache.keys.length) return certCache.keys;
  const r = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!r.ok) throw new Error('Não foi possível obter as chaves do Google.');
  const j = await r.json();
  certCache = { keys: j.keys || [], exp: Date.now() + 3600 * 1000 };
  return certCache.keys;
}

const parse = (b64) => JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));

export async function verifyGoogleIdToken(credential, { clientId = config.googleLoginClientId, getKeys = fetchGoogleKeys, now = Date.now() } = {}) {
  if (!clientId) throw new Error('Login com Google não está configurado.');
  const parts = String(credential || '').split('.');
  if (parts.length !== 3) throw new Error('Credencial do Google inválida.');
  const [h, p, s] = parts;

  let header, claims;
  try { header = parse(h); claims = parse(p); } catch { throw new Error('Credencial do Google inválida.'); }
  if (header.alg !== 'RS256') throw new Error('Algoritmo de assinatura não aceito.');

  const jwk = (await getKeys()).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('Chave de assinatura desconhecida.');
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const valid = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'));
  if (!valid) throw new Error('Assinatura inválida.');

  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) throw new Error('Emissor inválido.');
  if (claims.aud !== clientId) throw new Error('Credencial emitida para outro aplicativo.');
  if (!claims.exp || claims.exp * 1000 < now) throw new Error('Credencial expirada. Tente de novo.');
  if (!(claims.email_verified === true || claims.email_verified === 'true')) throw new Error('O e-mail da conta Google não está verificado.');
  if (!claims.email) throw new Error('A conta Google não informou e-mail.');

  return { email: String(claims.email).trim().toLowerCase(), name: claims.name || '' };
}
