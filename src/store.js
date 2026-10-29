import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Persistência simples em arquivo JSON (fila de aprovações, auditoria, usuários e convites).
// ATENÇÃO: no plano gratuito do Render o disco é efêmero e o arquivo some a cada reinício/deploy.
// Para manter equipe, fila e histórico, use o plano Starter com disco em DATA_DIR (ou migre para Postgres).
const file = () => path.join(config.dataDir, 'store.json');

let state = null;

function load() {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    state = {};
  }
  state.actions ||= [];
  state.audit ||= [];
  state.users ||= [];
  state.invites ||= [];
  return state;
}

function save() {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('[store] falha ao salvar:', e.message);
  }
}

export const store = {
  actions: () => load().actions,
  audit: () => load().audit,
  addAction(a) { load().actions.unshift(a); save(); return a; },
  getAction: (id) => load().actions.find((a) => a.id === id),
  updateAction(id, patch) {
    const a = load().actions.find((x) => x.id === id);
    if (a) { Object.assign(a, patch); save(); }
    return a;
  },
  log(entry) {
    const s = load();
    s.audit.unshift({ at: new Date().toISOString(), ...entry });
    s.audit = s.audit.slice(0, 1000);
    save();
  },

  // --- usuários e convites ---
  users: () => load().users,
  invites: () => load().invites,
  addUser(u) { load().users.push(u); save(); return u; },
  updateUser(email, patch) {
    const u = load().users.find((x) => x.email === email);
    if (u) { Object.assign(u, patch); save(); }
    return u;
  },
  removeUser(email) { const s = load(); s.users = s.users.filter((u) => u.email !== email); save(); },
  addInvite(i) { load().invites.unshift(i); save(); return i; },
  updateInvite(id, patch) {
    const i = load().invites.find((x) => x.id === id);
    if (i) { Object.assign(i, patch); save(); }
    return i;
  },
};
