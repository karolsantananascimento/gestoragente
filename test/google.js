// Testa a verificação do ID token do Google com um par de chaves RSA gerado localmente (sem rede).
import crypto from 'node:crypto';
import { verifyGoogleIdToken } from '../src/googleAuth.js';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const getKeys = async () => [jwk];
const CLIENT = '123-abc.apps.googleusercontent.com';
const NOW = Date.now();

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(claims = {}, { kid = 'k1', key = privateKey } = {}) {
  const h = b64({ alg: 'RS256', kid, typ: 'JWT' });
  const p = b64({ iss: 'https://accounts.google.com', aud: CLIENT, exp: Math.floor(NOW / 1000) + 3600, email: 'Knasck@Gmail.com', email_verified: true, name: 'K', ...claims });
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key).toString('base64url');
  return `${h}.${p}.${sig}`;
}
const opts = { clientId: CLIENT, getKeys, now: NOW };

let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FALHA'} ${m}`); if (!c) fails++; };
const rejects = async (t, o, m) => { try { await verifyGoogleIdToken(t, o); ok(false, m); } catch { ok(true, m); } };

const g = await verifyGoogleIdToken(token(), opts);
ok(g.email === 'knasck@gmail.com', 'token válido é aceito e o e-mail é normalizado');
await rejects(token({ aud: 'outro-app.apps.googleusercontent.com' }), opts, 'token emitido para outro aplicativo é recusado');
await rejects(token({ exp: Math.floor(NOW / 1000) - 10 }), opts, 'token expirado é recusado');
await rejects(token({ email_verified: false }), opts, 'e-mail não verificado é recusado');
await rejects(token({ iss: 'https://evil.example.com' }), opts, 'emissor falso é recusado');
await rejects(token({}, { key: crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey }), opts, 'assinatura de outra chave é recusada');
await rejects(token({}, { kid: 'desconhecida' }), opts, 'chave desconhecida é recusada');
const t = token(); const [h, p, s] = t.split('.');
const adulterado = `${h}.${b64({ ...JSON.parse(Buffer.from(p, 'base64url')), email: 'invasor@x.com' })}.${s}`;
await rejects(adulterado, opts, 'conteúdo adulterado é recusado');
await rejects('lixo', opts, 'texto qualquer é recusado');
await rejects(token(), { ...opts, clientId: '' }, 'sem GOOGLE_LOGIN_CLIENT_ID configurado, recusa');

console.log(fails ? `\n${fails} falha(s)` : '\nTodos os testes passaram');
process.exit(fails ? 1 : 0);
