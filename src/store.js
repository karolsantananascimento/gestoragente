import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

// Persistência: Postgres quando DATABASE_URL existe (recomendado, sobrevive a deploys);
// senão arquivo JSON em DATA_DIR. ATENÇÃO: no plano gratuito do Render o disco é efêmero.
const file = () => path.join(config.dataDir, 'store.json');

let state = null;
let pool = null;
let timer = null;
let writing = Promise.resolve();

const normalize = (s) => {
  s.actions ||= [];
  s.audit ||= [];
  s.users ||= [];
  s.invites ||= [];
  s.content ||= [];
  s.brand ||= {};
  s.media ||= {};
  s.settings ||= {};
  return s;
};

function load() {
  if (state) return state;
  try { state = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { state = {}; }
  return (state = normalize(state));
}

async function saveNow() {
  if (pool) {
    const json = JSON.stringify(state);
    writing = writing.then(() =>
      pool.query(
        `insert into app_state (key, value, updated_at) values ('state', $1::jsonb, now())
         on conflict (key) do update set value = excluded.value, updated_at = now()`, [json])
        .catch((e) => console.error('[store] falha ao salvar no Postgres:', e.message)));
    return writing;
  }
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('[store] falha ao salvar:', e.message);
  }
}

function save() {
  if (!pool) return saveNow();
  clearTimeout(timer);
  timer = setTimeout(saveNow, 300); // agrupa gravações seguidas
}

export const store = {
  // Chamar uma vez antes de subir o servidor.
  async init() {
    if (!config.databaseUrl) { load(); return 'arquivo'; }
    const local = /localhost|127\.0\.0\.1/.test(config.databaseUrl);
    pool = new pg.Pool({ connectionString: config.databaseUrl, max: 3, ssl: local ? false : { rejectUnauthorized: false } });
    await pool.query('create table if not exists app_state (key text primary key, value jsonb not null, updated_at timestamptz default now())');
    const r = await pool.query("select value from app_state where key = 'state'");
    state = normalize(r.rows[0]?.value || {});
    return 'postgres';
  },
  async flush() { if (pool) { clearTimeout(timer); await saveNow(); await writing; } },
  mode: () => (pool ? 'postgres' : 'arquivo'),

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

  // --- conteúdo (Hugo → Luiz → aprovação → Mariana) e marca ---
  content: () => load().content,
  getContent: (id) => load().content.find((c) => c.id === id),
  addContent(c) { load().content.unshift(c); save(); return c; },
  updateContent(id, patch) {
    const c = load().content.find((x) => x.id === id);
    if (c) { Object.assign(c, patch); save(); }
    return c;
  },
  saveContent() { save(); },
  settings: () => ({ meta_semanal: 3, ...load().settings }),
  setSettings(p) { Object.assign(load().settings, p); save(); return this.settings(); },
  media: (id) => load().media[id],
  setMedia(id, m) { load().media[id] = m; save(); },
  // Kit da marca: o que foi salvo no painel; se estiver vazio, usa o kit padrão do repositório (src/brandDefault.json).
  brand: () => {
    const b = load().brand;
    if (Object.keys(b).length) return b;
    try { return JSON.parse(fs.readFileSync(fileURLToPath(new URL('./brandDefault.json', import.meta.url)), 'utf8')); } catch { return {}; }
  },
  setBrand(b) { load().brand = b; save(); return b; },
};
