import crypto from 'node:crypto';
import { config } from './config.js';
import { store } from './store.js';
import { httpJson } from './http.js';

export const ROLES = ['admin', 'member'];
export const norm = (e) => String(e || '').trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;
const SESSION_TTL_MS = 12 * 3600 * 1000;

const safeEq = (a, b) => {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// --- senhas (scrypt) ---
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return `s1$${salt.toString('hex')}$${h.toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  const [v, s, h] = String(stored || '').split('$');
  if (v !== 's1' || !s || !h) return false;
  const calc = crypto.scryptSync(String(pw), Buffer.from(s, 'hex'), 64);
  const exp = Buffer.from(h, 'hex');
  return calc.length === exp.length && crypto.timingSafeEqual(calc, exp);
}

// --- usuários ---
export function getUser(email) {
  const e = norm(email);
  const stored = store.users().find((u) => u.email === e);
  if (stored) return { email: e, role: e === config.adminEmail ? 'admin' : stored.role, createdAt: stored.createdAt, lastLoginAt: stored.lastLoginAt };
  if (e === config.adminEmail) return { email: e, role: 'admin', virtual: true };
  return null;
}

export function authenticate(email, password) {
  const e = norm(email);
  const stored = store.users().find((u) => u.email === e);
  let ok = false;
  if (stored?.passwordHash) ok = verifyPassword(password, stored.passwordHash);
  else if (e === config.adminEmail && config.appPassword) ok = safeEq(password, config.appPassword);
  if (!ok) return null;
  const now = new Date().toISOString();
  if (stored) store.updateUser(e, { lastLoginAt: now });
  return getUser(e);
}

export function loginByVerifiedEmail(email) {
  const e = norm(email);
  const user = getUser(e);
  if (!user) return null;
  if (store.users().some((u) => u.email === e)) store.updateUser(e, { lastLoginAt: new Date().toISOString() });
  return user;
}

export function listUsers() {
  const list = store.users().map((u) => ({
    email: u.email,
    role: u.email === config.adminEmail ? 'admin' : u.role,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt || null,
    owner: u.email === config.adminEmail,
  }));
  if (!list.some((u) => u.email === config.adminEmail)) {
    list.unshift({ email: config.adminEmail, role: 'admin', createdAt: null, lastLoginAt: null, owner: true });
  }
  return list;
}

export function removeUser(email, by) {
  const e = norm(email);
  if (e === config.adminEmail) return { error: 'A conta administradora principal não pode ser removida.' };
  if (e === norm(by)) return { error: 'Você não pode remover a si mesma.' };
  if (!store.users().some((u) => u.email === e)) return { error: 'Usuário não encontrado.' };
  store.removeUser(e);
  store.log({ type: 'user_removed', email: e, by });
  return { ok: true };
}

export function changePassword(email, current, next) {
  const e = norm(email);
  if (!authenticate(e, current)) return { error: 'Senha atual incorreta.' };
  if (String(next || '').length < 8) return { error: 'A nova senha precisa ter ao menos 8 caracteres.' };
  const hash = hashPassword(next);
  if (store.users().some((u) => u.email === e)) store.updateUser(e, { passwordHash: hash });
  else store.addUser({ email: e, role: 'admin', passwordHash: hash, createdAt: new Date().toISOString() });
  store.log({ type: 'password_changed', email: e });
  return { ok: true };
}

// --- sessões (token assinado, 12h) ---
const sign = (payload) => crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');

export function signSession(user) {
  const payload = Buffer.from(JSON.stringify({ e: user.email, x: Date.now() + SESSION_TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function readSession(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig || !safeEq(sig, sign(payload))) return null;
  try {
    const { e, x } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!x || Date.now() > x) return null;
    return getUser(e); // papel e existência revalidados a cada requisição
  } catch {
    return null;
  }
}

// --- convites ---
export function createInvite({ email, role = 'member', by }) {
  const e = norm(email);
  if (!EMAIL_RE.test(e)) return { error: 'E-mail inválido.' };
  if (!ROLES.includes(role)) return { error: 'Papel inválido.' };
  if (getUser(e) && !getUser(e).virtual) return { error: 'Este e-mail já tem acesso.' };
  if (e === config.adminEmail) return { error: 'Este e-mail já é o administrador principal.' };
  for (const i of store.invites()) if (i.email === e && i.status === 'pending') store.updateInvite(i.id, { status: 'revoked' });
  const token = crypto.randomBytes(24).toString('base64url');
  const invite = store.addInvite({
    id: crypto.randomUUID().slice(0, 8),
    email: e, role, by: norm(by),
    tokenHash: sha256(token),
    status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
  });
  store.log({ type: 'invite_created', email: e, role, by });
  return { invite, token };
}

const findInvite = (token) => {
  const h = sha256(String(token || ''));
  const i = store.invites().find((x) => x.tokenHash === h);
  if (!i || i.status !== 'pending' || Date.now() > Date.parse(i.expiresAt)) return null;
  return i;
};

export function inviteInfo(token) {
  const i = findInvite(token);
  return i ? { email: i.email, role: i.role, by: i.by } : null;
}

export function acceptInvite(token, password, verifiedEmail) {
  const i = findInvite(token);
  if (!i) return { error: 'Convite inválido, expirado ou já usado.' };
  if (verifiedEmail) {
    // Entrada pelo Google: o e-mail da conta precisa ser exatamente o do convite.
    if (norm(verifiedEmail) !== i.email) return { error: `Este convite é para ${i.email}. Entre com essa conta Google.` };
  } else if (String(password || '').length < 8) {
    return { error: 'A senha precisa ter ao menos 8 caracteres.' };
  }
  if (store.users().some((u) => u.email === i.email)) return { error: 'Este e-mail já tem acesso.' };
  store.addUser({
    email: i.email, role: i.role,
    ...(verifiedEmail ? { auth: 'google' } : { passwordHash: hashPassword(password) }),
    createdAt: new Date().toISOString(), invitedBy: i.by,
  });
  store.updateInvite(i.id, { status: 'accepted', acceptedAt: new Date().toISOString() });
  store.log({ type: 'invite_accepted', email: i.email, role: i.role, via: verifiedEmail ? 'google' : 'senha' });
  return { user: getUser(i.email) };
}

export function revokeInvite(id, by) {
  const i = store.invites().find((x) => x.id === id);
  if (!i || i.status !== 'pending') return { error: 'Convite não encontrado.' };
  store.updateInvite(id, { status: 'revoked' });
  store.log({ type: 'invite_revoked', email: i.email, by });
  return { ok: true };
}

export const pendingInvites = () =>
  store.invites()
    .filter((i) => i.status === 'pending' && Date.now() <= Date.parse(i.expiresAt))
    .map(({ tokenHash, ...rest }) => rest);

// --- e-mail do convite (opcional, via Resend) ---
export async function sendInviteEmail({ to, link, by, role }) {
  if (!config.resendKey || !config.mailFrom) return { sent: false, reason: 'Envio de e-mail não configurado (RESEND_API_KEY e MAIL_FROM).' };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  try {
    await httpJson('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.resendKey}` },
      body: {
        from: config.mailFrom,
        to: [to],
        subject: 'Convite para o Agente de Tráfego',
        html: `<p>${esc(by)} convidou você para o Agente de Tráfego como <b>${role === 'admin' ? 'administrador' : 'colaborador'}</b>.</p><p><a href="${esc(link)}">Criar minha senha e entrar</a></p><p>O convite vale por 7 dias.</p>`,
      },
    });
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e.message };
  }
}
