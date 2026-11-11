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

const SEED_CLIENTS = [
  ['disco', 'Disco', 2], ['michie-farfan', 'Michie Farfan', 2], ['operizy', 'Operizy', 7],
  ['senhorita-moca', 'Senhorita Moça', 3], ['lumiere', 'Lumiere', 2], ['contrafluxo-pratas', 'ContraFluxo Pratas', 2],
];
const defaultBrand = () => { try { return JSON.parse(fs.readFileSync(fileURLToPath(new URL('./brandDefault.json', import.meta.url)), 'utf8')); } catch { return {}; } };

// Kits de marca entregues junto com o código (src/kits/<id-do-cliente>.json). Só preenchem campos vazios: o que a administradora editar no painel nunca é sobrescrito.
const kitPadrao = (id) => { try { return JSON.parse(fs.readFileSync(fileURLToPath(new URL(`./kits/${id}.json`, import.meta.url)), 'utf8')); } catch { return null; } };

const normalize = (s) => {
  s.actions ||= [];
  s.audit ||= [];
  s.users ||= [];
  s.invites ||= [];
  s.content ||= [];
  s.brand ||= {};
  s.media ||= {};
  s.settings ||= {};
  s.seeded ||= [];
  s.pedidos ||= [];
  s.integracoes ||= {};
  s.vendas ||= { leads: [], config: {}, disparos: [] };
  s.vendas.leads ||= []; s.vendas.config ||= {}; s.vendas.disparos ||= [];
  // Áreas de trabalho por cliente. O kit/pautas que existiam antes pertencem à Disco (cliente padrão).
  if (!Array.isArray(s.clientes) || !s.clientes.length) {
    s.clientes = SEED_CLIENTS.map(([id, nome, meta]) => ({
      id, nome, meta_semanal: meta, padrao: id === 'disco', contas: {}, criado_em: new Date().toISOString(),
      marca: id === 'disco' ? (Object.keys(s.brand).length ? s.brand : defaultBrand()) : { nome },
    }));
  }
  for (const c of s.clientes) {
    const kit = kitPadrao(c.id);
    if (kit) { c.marca ||= {}; for (const [k, v] of Object.entries(kit)) if (!c.marca[k] || (k === 'nome' && Object.keys(c.marca).length === 1)) c.marca[k] = v; }
  }
  for (const c of s.content) if (!c.cliente_id) c.cliente_id = 'disco';
  for (const p of s.pedidos) if (!p.cliente_id) p.cliente_id = 'disco';
  return s;
};

function load() {
  if (state) return state;
  try { state = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { state = {}; }
  return (state = normalize(state));
}

// Gravação no Postgres: no máximo UMA em andamento. Se houver novas mudanças enquanto grava, regrava uma vez ao final
// com o estado mais recente. (Antes cada gravação ficava na fila com uma cópia de ~11 MB do estado: com o banco lento
// as cópias se acumulavam e o servidor estourava a memória.)
let inflight = false;
let dirty = false;
async function saveNow() {
  if (pool) {
    dirty = true;
    if (inflight) return writing;
    inflight = true;
    writing = (async () => {
      try {
        while (dirty) {
          dirty = false;
          try {
            await pool.query(
              `insert into app_state (key, value, updated_at) values ('state', $1::jsonb, now())
               on conflict (key) do update set value = excluded.value, updated_at = now()`, [JSON.stringify(state)]);
          } catch (e) { console.error('[store] falha ao salvar no Postgres:', e.message); }
        }
      } finally { inflight = false; }
    })();
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
  timer = setTimeout(saveNow, 1500); // agrupa gravações seguidas
}

export const store = {
  // Chamar uma vez antes de subir o servidor.
  async init() {
    if (!config.databaseUrl) { load(); return 'arquivo'; }
    const local = /localhost|127\.0\.0\.1/.test(config.databaseUrl);
    pool = new pg.Pool({ connectionString: config.databaseUrl, max: 3, ssl: local ? false : { rejectUnauthorized: false } });
    // Conexão ociosa derrubada pelo banco (reinício, pausa, manutenção) emite 'error' no pool; sem este handler o Node encerra o processo.
    pool.on('error', (e) => console.error('[store] conexão ociosa com o Postgres encerrada:', e.message));
    // Banco pausado/reiniciando (ex.: Supabase gratuito pausa por inatividade): tenta de novo por ~3 min antes de desistir.
    // Não cai para arquivo local de propósito: o painel apareceria vazio e as gravações seguintes não iriam para o banco.
    let r;
    for (let tentativa = 1; ; tentativa++) {
      try {
        await pool.query('create table if not exists app_state (key text primary key, value jsonb not null, updated_at timestamptz default now())');
        r = await pool.query("select value from app_state where key = 'state'");
        break;
      } catch (e) {
        if (tentativa >= 18) throw e;
        console.error(`[store] banco indisponível (${e.message}); nova tentativa ${tentativa}/18 em 10s`);
        await new Promise((ok) => setTimeout(ok, 10_000));
      }
    }
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
  removeContent(ids) { const s = load(); const set = new Set(ids); s.content = s.content.filter((c) => !set.has(c.id)); save(); return set.size; },
  saveContent() { save(); },
  settings: () => ({ meta_semanal: 3, ...load().settings }),
  setSettings(p) { Object.assign(load().settings, p); save(); return this.settings(); },
  seeded: () => load().seeded,
  markSeeded(id) { load().seeded.push(id); save(); },
  pedidos: () => load().pedidos,
  addPedido(x) { load().pedidos.unshift(x); load().pedidos = load().pedidos.slice(0, 200); save(); return x; },
  updatePedido(id, patch) { const x = load().pedidos.find((p) => p.id === id); if (x) { Object.assign(x, patch); save(); } return x; },
  media: (id) => load().media[id],
  setMedia(id, m) { load().media[id] = m; save(); },
  // Kit da marca: o que foi salvo no painel; se estiver vazio, usa o kit padrão do repositório (src/brandDefault.json).
  clientes: () => load().clientes,
  cliente: (idOuNome) => {
    const k = String(idOuNome || '').trim().toLowerCase();
    if (!k) return load().clientes.find((c) => c.padrao) || load().clientes[0];
    const slug = (x) => String(x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return load().clientes.find((c) => c.id === k || slug(c.nome) === slug(k) || slug(c.id) === slug(k));
  },
  addCliente(c) { load().clientes.push(c); save(); return c; },
  saveClientes() { save(); },
  vendas() { return load().vendas; },
  saveVendas() { save(); },
  integ(k) { return load().integracoes[k] || null; },
  setInteg(k, v) { const i = load().integracoes; if (v) i[k] = v; else delete i[k]; save(); },
  // Kit de marca do cliente (sem argumento = cliente padrão).
  brand: (idOuNome) => (store.cliente(idOuNome)?.marca) || {},
  setBrand(b, idOuNome) { const c = store.cliente(idOuNome); if (c) { c.marca = b; save(); } return b; },
};
