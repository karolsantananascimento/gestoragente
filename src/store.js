import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Persistência simples em arquivo JSON (fila de aprovações + auditoria).
// Em produção no Render, use um disco persistente em DATA_DIR ou migre para Postgres.
const file = () => path.join(config.dataDir, 'store.json');

let state = null;

function load() {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    state = { actions: [], audit: [] };
  }
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
};
