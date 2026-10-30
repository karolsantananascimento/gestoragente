import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { store } from './store.js';
import { httpJson } from './http.js';
import { parseCsv } from './planilha.js';
import * as wa from './platforms/whatsapp.js';

// Felipe Macedo — SDR (pré-vendas) com IA. Modelo: SDR conversacional BANT/SPIN (como 11x Alice, Artisan Ava, HubSpot Breeze, salesbots do Kommo):
// recebe lead de campanha → primeiro contato (template aprovado) → conversa curta e uma pergunta por vez → qualifica → entrega ao humano.
// Regras fixas: só fala com quem tem consentimento, respeita "PARAR", nunca inventa preço/promessa, avisa que é assistente virtual se perguntado,
// mensagens ativas só em horário comercial, disparos em massa só depois de aprovação de administrador.

const here = path.dirname(fileURLToPath(import.meta.url));
const prompt = () => { try { return fs.readFileSync(path.join(here, '..', 'prompts', 'felipe.md'), 'utf8'); } catch { return ''; } };
const agora = () => new Date().toISOString();
const uid = () => crypto.randomBytes(6).toString('hex');
const trunc = (s, n) => String(s ?? '').slice(0, n);
const HORAS = (n) => n * 3600e3;
export const STATUS = { novo: 'Novo', contatado: 'Contatado', em_conversa: 'Em conversa', qualificado: 'Qualificado', desqualificado: 'Desqualificado', humano: 'Com humano', sem_resposta: 'Sem resposta', optout: 'Pediu para parar' };
const OPTOUT = /^\s*(parar|pare|sair|stop|cancelar|descadastrar|remover|n[aã]o quero( mais)?( receber)?( mensagens?)?|me (tire|remova|exclua)|chega)\W*$/i;
const FIM_OK = ['qualificado', 'desqualificado', 'optout'];

// ---------- Utilidades ----------
export function normalizarTelefone(raw) {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return null;
  d = d.replace(/^00/, '').replace(/^0+(?=\d{10,11}$)/, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  if (d.startsWith('55') && (d.length < 12 || d.length > 13)) return null;
  return d.length >= 11 && d.length <= 15 ? d : null;
}
const primeiroNome = (n) => trunc(String(n || '').trim().split(/\s+/)[0], 40) || '';
const dentroDoHorario = (cfg, d = new Date()) => {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'America/Recife' }).format(d));
  const dow = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'America/Recife' }).format(d);
  if (dow === 'Sun') return false;
  return h >= cfg.horario_inicio && h < cfg.horario_fim;
};
const hojeRecife = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);

// ---------- Configuração por cliente ----------
const PADRAO = {
  ativo: false, empresa: '', oferta: '', apresentacao: '', publico: '', criterios: '',
  perguntas: ['Qual é o principal desafio que você quer resolver hoje?', 'Para quando você pretende resolver isso?', 'Você é quem decide ou mais alguém participa da decisão?'],
  horario_inicio: 8, horario_fim: 20, template: '', max_respostas_dia: 30, followup_horas: [4, 20], proximo_passo: 'Um especialista da nossa equipe vai continuar com você por aqui.',
};
export function getConfig(clienteRef) {
  const c = store.cliente(clienteRef) || store.cliente();
  const salvo = store.vendas().config[c.id] || {};
  return { ...PADRAO, empresa: c.nome, ...salvo, cliente_id: c.id, cliente: c.nome };
}
export function salvarConfig(clienteRef, patch = {}) {
  const c = store.cliente(clienteRef); if (!c) return { error: 'Cliente não encontrado.' };
  const at = store.vendas().config[c.id] || {};
  const n = { ...at };
  for (const k of ['empresa', 'oferta', 'apresentacao', 'publico', 'criterios', 'template', 'proximo_passo']) if (patch[k] !== undefined) n[k] = trunc(patch[k], 1500);
  if (patch.ativo !== undefined) n.ativo = !!patch.ativo;
  if (Array.isArray(patch.perguntas)) n.perguntas = patch.perguntas.map((x) => trunc(x, 300).trim()).filter(Boolean).slice(0, 6);
  for (const k of ['horario_inicio', 'horario_fim']) if (patch[k] !== undefined) n[k] = Math.min(Math.max(parseInt(patch[k], 10) || 0, 0), 24);
  if (patch.max_respostas_dia !== undefined) n.max_respostas_dia = Math.min(Math.max(parseInt(patch.max_respostas_dia, 10) || 30, 1), 200);
  if (Array.isArray(patch.followup_horas)) n.followup_horas = patch.followup_horas.map(Number).filter((x) => x > 0 && x < 24).slice(0, 2);
  store.vendas().config[c.id] = n; store.saveVendas();
  return { config: getConfig(c.id) };
}
const clientePadraoVendas = () => {
  const ref = config.vendas.clientePadrao;
  return store.cliente(ref) || store.clientes().find((c) => store.vendas().config[c.id]?.ativo) || store.cliente();
};

// ---------- Leads ----------
export const listarLeads = (f = {}) => store.vendas().leads
  .filter((l) => (!f.cliente || l.cliente_id === store.cliente(f.cliente)?.id) && (!f.status || l.status === f.status) && (!f.origem || l.origem === f.origem))
  .sort((a, b) => String(b.atualizado_em).localeCompare(String(a.atualizado_em)));
export const getLead = (id) => store.vendas().leads.find((l) => l.id === id);
const resumo = (l) => ({ id: l.id, cliente_id: l.cliente_id, nome: l.nome, telefone: l.telefone, email: l.email, origem: l.origem, campanha: l.campanha, status: l.status, status_texto: STATUS[l.status], score: l.score, consentimento: l.consentimento, humano: !!l.humano, qualificacao: l.qualificacao, resumo: l.resumo, criado_em: l.criado_em, atualizado_em: l.atualizado_em, ultima: l.mensagens.at(-1) ? { de: l.mensagens.at(-1).de, texto: trunc(l.mensagens.at(-1).texto, 120), at: l.mensagens.at(-1).at } : null, total_mensagens: l.mensagens.length });
export const viewLead = resumo;

export function addLead(d = {}, by = 'sistema') {
  const cli = store.cliente(d.cliente) || clientePadraoVendas();
  const tel = normalizarTelefone(d.telefone);
  if (!tel) return { error: 'Telefone inválido (use DDD + número).' };
  const existente = store.vendas().leads.find((l) => l.cliente_id === cli.id && l.telefone === tel);
  if (existente) {
    for (const k of ['nome', 'email', 'campanha']) if (!existente[k] && d[k]) existente[k] = trunc(d[k], 120);
    if (d.consentimento === true) existente.consentimento = true;
    store.saveVendas();
    return { lead: existente, duplicado: true };
  }
  const l = {
    id: uid(), cliente_id: cli.id, nome: trunc(d.nome, 120), telefone: tel, email: trunc(d.email, 160), origem: trunc(d.origem || 'manual', 40), campanha: trunc(d.campanha, 160),
    consentimento: d.consentimento === true, status: 'novo', score: 0, qualificacao: {}, resumo: '', humano: false, etapa: 0, followups: 0,
    mensagens: [], criado_em: agora(), atualizado_em: agora(), por: by, respostas_dia: { dia: '', n: 0 },
  };
  store.vendas().leads.push(l);
  store.saveVendas();
  store.log({ type: 'lead_novo', cliente: cli.nome, origem: l.origem, by });
  return { lead: l };
}

// CSV de uma lista do CRM. Colunas aceitas: nome, telefone/celular/whatsapp, email, campanha. Só entra com consentimento declarado.
export function importarCsv(clienteRef, csv, { consentimento = false, origem = 'crm', by = 'painel' } = {}) {
  const rows = parseCsv(csv).filter((r) => r.some((c) => String(c).trim()));
  if (rows.length < 2) return { error: 'O CSV precisa ter cabeçalho e ao menos uma linha.' };
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const cab = rows[0].map(norm);
  const idx = (...nomes) => cab.findIndex((c) => nomes.some((n) => c === n || c.includes(n)));
  const iN = idx('nome', 'name'), iT = idx('telefone', 'celular', 'whatsapp', 'phone', 'fone'), iE = idx('email', 'e-mail'), iC = idx('campanha');
  if (iT < 0) return { error: 'Não achei a coluna de telefone (telefone, celular ou whatsapp).' };
  let novos = 0, duplicados = 0, invalidos = 0;
  for (const r of rows.slice(1)) {
    const res = addLead({ cliente: clienteRef, nome: r[iN], telefone: r[iT], email: iE >= 0 ? r[iE] : '', campanha: iC >= 0 ? r[iC] : '', origem, consentimento: !!consentimento }, by);
    if (res.error) invalidos++; else if (res.duplicado) duplicados++; else novos++;
  }
  return { novos, duplicados, invalidos, consentimento: !!consentimento };
}

// ---------- Envio ----------
function registrar(l, de, texto, extra = {}) {
  l.mensagens.push({ de, texto: trunc(texto, 4000), at: agora(), ...extra });
  if (l.mensagens.length > 100) l.mensagens.splice(0, l.mensagens.length - 100);
  l.atualizado_em = agora();
}
const dentroDaJanela = (l) => !!l.ultima_entrada && Date.now() - new Date(l.ultima_entrada).getTime() < HORAS(24);

async function enviarTexto(l, texto, de = 'felipe') {
  if (l.status === 'optout') return { error: 'Lead pediu para parar.' };
  if (!dentroDaJanela(l)) return { error: 'Fora da janela de 24h do WhatsApp: só é possível enviar um template aprovado.' };
  if (config.dryRun) { registrar(l, de, texto, { simulado: true }); store.saveVendas(); return { ok: true, simulado: true }; }
  try { const r = await wa.enviarTexto(l.telefone, texto); registrar(l, de, texto, { wa_id: r?.messages?.[0]?.id }); store.saveVendas(); return { ok: true }; }
  catch (e) { registrar(l, 'sistema', `Falha ao enviar: ${trunc(e.message, 200)}`, { erro: true }); store.saveVendas(); return { error: e.message }; }
}
function contaTemplatesHoje() {
  const v = store.vendas(); const hoje = hojeRecife();
  v.contador ||= { dia: '', n: 0 };
  if (v.contador.dia !== hoje) v.contador = { dia: hoje, n: 0 };
  return v.contador;
}
export const limiteDisparosRestante = () => Math.max(0, config.vendas.maxDisparosDia - contaTemplatesHoje().n);

// Primeiro contato (ou disparo): template aprovado pela Meta, que é o único formato permitido fora da janela de 24h.
export async function enviarTemplateLead(l, { template, motivo = 'primeiro_contato' } = {}) {
  const cfg = getConfig(l.cliente_id);
  const nome = template || cfg.template || config.whatsapp.template;
  if (!nome) return { error: 'Nenhum template aprovado configurado (WHATSAPP_TEMPLATE ou o campo Template no painel).' };
  if (l.consentimento !== true) return { error: 'Lead sem consentimento registrado.' };
  if (['optout', 'humano'].includes(l.status)) return { error: `Lead está como "${STATUS[l.status]}".` };
  const c = contaTemplatesHoje();
  if (c.n >= config.vendas.maxDisparosDia) return { error: `Limite diário de ${config.vendas.maxDisparosDia} templates atingido.` };
  const params = [primeiroNome(l.nome) || 'tudo bem', cfg.empresa];
  try {
    if (!config.dryRun) await wa.enviarTemplate(l.telefone, nome, params, config.whatsapp.templateLang);
    c.n++;
    registrar(l, 'felipe', `[template ${nome}] Olá ${params[0]}, aqui é o Felipe da ${cfg.empresa}.`, { template: nome, motivo, simulado: config.dryRun || undefined });
    if (l.status === 'novo') l.status = 'contatado';
    l.contatado_em = agora();
    store.saveVendas();
    return { ok: true };
  } catch (e) { registrar(l, 'sistema', `Falha no template: ${trunc(e.message, 200)}`, { erro: true }); l.falhas = (l.falhas || 0) + 1; store.saveVendas(); return { error: e.message }; }
}

// ---------- Conversa ----------
const emFila = new Map();
const serializar = (id, fn) => { const p = (emFila.get(id) || Promise.resolve()).catch(() => {}).then(fn); emFila.set(id, p); p.finally(() => { if (emFila.get(id) === p) emFila.delete(id); }).catch(() => {}); return p; };

export function receberMensagem({ id, de, nome, texto, tipo = 'text', at } = {}) {
  const tel = normalizarTelefone(de);
  if (!tel) return Promise.resolve({ ignorado: true });
  const v = store.vendas(); v.vistos ||= [];
  if (id) { if (v.vistos.includes(id)) return Promise.resolve({ duplicada: true }); v.vistos.push(id); if (v.vistos.length > 500) v.vistos.splice(0, v.vistos.length - 500); }
  let l = v.leads.filter((x) => x.telefone === tel).sort((a, b) => String(b.contatado_em || b.criado_em).localeCompare(String(a.contatado_em || a.criado_em)))[0];
  if (!l) {
    const r = addLead({ telefone: tel, nome, origem: 'whatsapp', consentimento: true }, 'whatsapp'); // quem escreve primeiro está iniciando a conversa
    l = r.lead;
  }
  if (!l.nome && nome) l.nome = trunc(nome, 120);
  return serializar(l.id, () => processarEntrada(l, { id, texto: texto || '', tipo, at }));
}

async function processarEntrada(l, { id, texto, tipo, at }) {
  l.ultima_entrada = at || agora(); l.followups = 0; l.consentimento = true;
  registrar(l, 'lead', texto || `[${tipo}]`, { wa_id: id });
  if (id && !config.dryRun && wa.configurado()) wa.marcarLida(id);
  if (OPTOUT.test(texto)) {
    l.status = 'optout'; store.saveVendas();
    store.log({ type: 'lead_optout', lead: l.id });
    await enviarTexto(l, 'Pronto, não envio mais mensagens. Se mudar de ideia, é só escrever por aqui. 🙂');
    return { optout: true };
  }
  if (l.status === 'optout') l.status = 'em_conversa'; // voltou a escrever por conta própria
  if (l.humano || l.status === 'humano') { store.saveVendas(); return { humano: true }; }
  const cfg = getConfig(l.cliente_id);
  const hoje = hojeRecife(); if (l.respostas_dia?.dia !== hoje) l.respostas_dia = { dia: hoje, n: 0 };
  if (l.respostas_dia.n >= cfg.max_respostas_dia) { passarAoHumano(l, 'limite diário de respostas atingido'); return { limite: true }; }
  if (tipo !== 'text' && tipo !== 'button' && tipo !== 'interactive') {
    store.saveVendas();
    await enviarTexto(l, 'Por aqui consigo ler só mensagens de texto. Pode me escrever em texto, por favor? 🙂');
    return { midia: true };
  }
  l.respostas_dia.n++;
  if (l.status === 'novo' || l.status === 'contatado' || l.status === 'sem_resposta') l.status = 'em_conversa';
  let resp;
  try { resp = await responderComIA(l, cfg); } catch (e) { resp = null; l.ia_erro = trunc(e.message, 200); }
  if (!resp) resp = responderRoteiro(l, cfg);
  if (resp.texto) await enviarTexto(l, resp.texto);
  store.saveVendas();
  return { respondido: !!resp.texto, status: l.status };
}

function passarAoHumano(l, motivo) {
  l.status = 'humano'; l.humano = true; l.motivo_humano = trunc(motivo, 200);
  registrar(l, 'sistema', `Felipe passou para um humano: ${motivo}`);
  store.log({ type: 'lead_humano', lead: l.id, motivo });
  store.saveVendas();
}
function qualificar(l, status, score, resumo) {
  if (status && STATUS[status]) l.status = status;
  if (Number.isFinite(score)) l.score = Math.min(100, Math.max(0, Math.round(score)));
  if (resumo) l.resumo = trunc(resumo, 600);
  if (status === 'qualificado') { l.qualificado_em = agora(); store.log({ type: 'lead_qualificado', lead: l.id, score: l.score }); }
}

// Roteiro de reserva (sem IA ou sem crédito): faz as perguntas configuradas, uma por vez, e entrega ao humano.
function responderRoteiro(l, cfg) {
  const perguntas = cfg.perguntas;
  const ult = l.mensagens.filter((m) => m.de === 'lead').at(-1)?.texto || '';
  l.qualificacao.respostas ||= [];
  if (l.etapa > 0 && l.etapa <= perguntas.length) l.qualificacao.respostas.push({ pergunta: perguntas[l.etapa - 1], resposta: trunc(ult, 300) });
  if (l.etapa === 0) {
    l.etapa = 1;
    const ola = `Olá${primeiroNome(l.nome) ? ', ' + primeiroNome(l.nome) : ''}! Aqui é o Felipe, assistente virtual da ${cfg.empresa}. ${cfg.apresentacao ? cfg.apresentacao + ' ' : ''}Posso te fazer ${perguntas.length === 1 ? 'uma pergunta rápida' : perguntas.length + ' perguntas rápidas'} para entender como ajudar?\n\n${perguntas[0]}`;
    return { texto: ola };
  }
  if (l.etapa < perguntas.length) { const p = perguntas[l.etapa]; l.etapa++; return { texto: p }; }
  if (l.etapa === perguntas.length) {
    l.etapa++;
    qualificar(l, 'qualificado', 60, l.qualificacao.respostas.map((r) => `${r.pergunta} → ${r.resposta}`).join(' | '));
    return { texto: `Obrigado pelas respostas! ${cfg.proximo_passo}` };
  }
  if (!l.humano) l.humano = false;
  return { texto: 'Anotado! Nossa equipe já tem suas informações e continua com você por aqui.' };
}

// IA: conversa com autonomia, uma pergunta por vez, com ferramentas para registrar a qualificação e transferir.
const FERRAMENTAS = [
  { name: 'atualizar_lead', description: 'Registra o que você descobriu sobre o lead. Chame sempre que aprender algo novo. status: em_conversa, qualificado (tem necessidade real, prazo e quem decide, ou pediu falar com a equipe) ou desqualificado (sem fit claro).',
    input_schema: { type: 'object', properties: { necessidade: { type: 'string' }, orcamento: { type: 'string' }, prazo: { type: 'string' }, decisor: { type: 'string' }, interesse: { type: 'string' }, score: { type: 'number', description: '0 a 100: chance de virar cliente' }, status: { type: 'string', enum: ['em_conversa', 'qualificado', 'desqualificado'] }, resumo: { type: 'string', description: 'Resumo de 1-3 frases para o vendedor humano' } } } },
  { name: 'transferir_humano', description: 'Passa a conversa para uma pessoa (pedido de falar com humano, reclamação, assunto jurídico/financeiro sensível, lead irritado ou pergunta que você não pode responder).',
    input_schema: { type: 'object', properties: { motivo: { type: 'string' } }, required: ['motivo'] } },
];
function contextoMarca(cfg) {
  const m = store.cliente(cfg.cliente_id)?.marca || {};
  return [`Empresa: ${cfg.empresa}`, cfg.oferta && `O que vendemos: ${cfg.oferta}`, cfg.publico && `Público: ${cfg.publico}`, cfg.criterios && `Critérios para qualificar: ${cfg.criterios}`, cfg.apresentacao && `Apresentação: ${cfg.apresentacao}`, m.tom_de_voz && `Tom de voz da marca: ${trunc(m.tom_de_voz, 500)}`, m.proibido && `Nunca diga: ${trunc(m.proibido, 300)}`, `Perguntas de qualificação sugeridas: ${cfg.perguntas.join(' / ')}`, `Próximo passo quando qualificado: ${cfg.proximo_passo}`].filter(Boolean).join('\n');
}
async function responderComIA(l, cfg) {
  if (!config.anthropicKey) return null;
  const { anthropic, iaComProblema, marcarIA } = await import('./agent.js');
  if (iaComProblema()) return null;
  const hist = l.mensagens.filter((m) => ['lead', 'felipe', 'humano'].includes(m.de) && !m.erro).slice(-24).map((m) => ({ role: m.de === 'lead' ? 'user' : 'assistant', content: trunc(m.texto, 1200) }));
  const msgs = []; // alterna papéis e começa com 'user'
  for (const m of hist) { const u = msgs.at(-1); if (u && u.role === m.role) u.content += '\n' + m.content; else msgs.push({ ...m }); }
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length) return null;
  const sys = `${prompt()}\n\n---\nHoje é ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Recife', dateStyle: 'full' })}.\nDados do lead: nome="${trunc(l.nome, 60)}", origem=${l.origem}${l.campanha ? `, campanha="${trunc(l.campanha, 80)}"` : ''}. Já sabemos: ${JSON.stringify(l.qualificacao)}.\n\n${contextoMarca(cfg)}`;
  let texto = '';
  try {
    for (let t = 0; t < 4; t++) {
      const res = await anthropic().messages.create({ model: config.model, max_tokens: 700, system: sys, tools: FERRAMENTAS, messages: msgs });
      const uso = res.content.filter((b) => b.type === 'tool_use');
      texto = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim() || texto;
      if (res.stop_reason !== 'tool_use' || !uso.length) break;
      msgs.push({ role: 'assistant', content: res.content });
      const results = [];
      for (const u of uso) {
        const i = u.input || {};
        if (u.name === 'atualizar_lead') {
          for (const k of ['necessidade', 'orcamento', 'prazo', 'decisor', 'interesse']) if (i[k]) l.qualificacao[k] = trunc(i[k], 300);
          qualificar(l, i.status, Number(i.score), i.resumo);
          results.push({ type: 'tool_result', tool_use_id: u.id, content: 'Registrado.' });
        } else if (u.name === 'transferir_humano') {
          passarAoHumano(l, i.motivo || 'solicitado'); results.push({ type: 'tool_result', tool_use_id: u.id, content: 'Transferido. Despeça-se em uma frase.' });
        } else results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: 'Ferramenta desconhecida.' });
      }
      msgs.push({ role: 'user', content: results });
    }
    marcarIA(null);
  } catch (e) { marcarIA(e); throw e; }
  texto = trunc(texto.replace(/\*\*/g, '*'), 900);
  if (!texto) return null;
  return { texto };
}

// ---------- Ações do painel ----------
export async function responderManual(id, texto, by) {
  const l = getLead(id); if (!l) return { error: 'Lead não encontrado.' };
  if (!String(texto || '').trim()) return { error: 'Escreva a mensagem.' };
  if (l.status !== 'humano') { l.humano = true; l.status = 'humano'; }
  const r = await enviarTexto(l, trunc(texto, 1500), 'humano');
  return r.error ? r : { lead: l };
}
export function definirHumano(id, humano, by) {
  const l = getLead(id); if (!l) return { error: 'Lead não encontrado.' };
  l.humano = !!humano;
  l.status = humano ? 'humano' : (l.qualificado_em ? 'qualificado' : l.mensagens.some((m) => m.de === 'lead') ? 'em_conversa' : 'contatado');
  registrar(l, 'sistema', humano ? `${by} assumiu a conversa.` : `${by} devolveu a conversa ao Felipe.`);
  store.saveVendas(); return { lead: l };
}
export function marcarStatus(id, status, by) {
  const l = getLead(id); if (!l || !STATUS[status]) return { error: 'Lead ou status inválido.' };
  l.status = status; if (status === 'optout') l.humano = false; registrar(l, 'sistema', `${by} marcou como "${STATUS[status]}".`); store.saveVendas(); return { lead: l };
}
export async function contatarAgora(id) {
  const l = getLead(id); if (!l) return { error: 'Lead não encontrado.' };
  return enviarTemplateLead(l);
}

// ---------- Disparos para listas do CRM (com aprovação) ----------
function elegiveis(cliente_id, filtro = {}) {
  return store.vendas().leads.filter((l) => l.cliente_id === cliente_id && l.consentimento === true && !['optout', 'humano', 'qualificado', 'desqualificado'].includes(l.status)
    && (!filtro.status || l.status === filtro.status) && (!filtro.origem || l.origem === filtro.origem) && (!filtro.campanha || l.campanha === filtro.campanha));
}
export function proporDisparo({ cliente, nome, filtro = {}, template, by }) {
  const cli = store.cliente(cliente); if (!cli) return { error: 'Cliente não encontrado.' };
  const tpl = template || getConfig(cli.id).template || config.whatsapp.template;
  if (!tpl) return { error: 'Informe o template aprovado pela Meta (ou configure WHATSAPP_TEMPLATE).' };
  const ids = elegiveis(cli.id, filtro).filter((l) => l.status === 'novo' || filtro.status).map((l) => l.id);
  if (!ids.length) return { error: 'Nenhum lead elegível (precisa ter consentimento e não ter pedido para parar).' };
  const d = { id: uid(), cliente_id: cli.id, nome: trunc(nome || `Disparo ${new Date().toLocaleDateString('pt-BR')}`, 80), filtro, template: trunc(tpl, 80), ids, enviados: 0, falhas: 0, estado: 'pendente', por: by, criado_em: agora() };
  store.vendas().disparos.unshift(d); store.saveVendas();
  store.log({ type: 'disparo_proposto', cliente: cli.nome, total: ids.length, by });
  return { disparo: d };
}
export function decidirDisparo(id, aprovar, by) {
  const d = store.vendas().disparos.find((x) => x.id === id); if (!d) return { error: 'Disparo não encontrado.' };
  if (d.estado !== 'pendente' && !(aprovar === false && d.estado === 'aprovado')) return { error: `Disparo já está "${d.estado}".` };
  d.estado = aprovar ? 'aprovado' : 'cancelado'; d.decidido_por = by; d.decidido_em = agora();
  store.log({ type: aprovar ? 'disparo_aprovado' : 'disparo_cancelado', id, by }); store.saveVendas(); return { disparo: d };
}

// ---------- Ciclo automático (a cada minuto) ----------
export async function tick() {
  if (!config.dryRun && !wa.configurado()) return { parado: 'whatsapp não configurado' };
  const v = store.vendas(); let feitos = 0;
  // 1) disparos aprovados
  for (const d of v.disparos.filter((x) => ['aprovado', 'enviando'].includes(x.estado))) {
    const cfg = getConfig(d.cliente_id);
    if (!dentroDoHorario(cfg)) continue;
    d.estado = 'enviando';
    for (const lid of d.ids.slice(0, 40)) {
      const l = getLead(lid); d.ids = d.ids.filter((x) => x !== lid);
      if (!l || l.consentimento !== true || ['optout', 'humano'].includes(l.status)) continue;
      const r = await enviarTemplateLead(l, { template: d.template, motivo: 'disparo' });
      if (r.ok) d.enviados++; else { d.falhas++; if (/Limite diário/.test(r.error || '')) { d.ids.unshift(lid); d.pausado = 'limite diário'; break; } }
      feitos++; await new Promise((r2) => setTimeout(r2, config.dryRun ? 0 : 1200));
    }
    if (!d.ids.length) { d.estado = 'concluido'; d.concluido_em = agora(); }
    store.saveVendas();
  }
  // 2) primeiro contato de leads de campanha (cliente ativo, horário comercial)
  for (const l of v.leads.filter((x) => x.status === 'novo' && x.consentimento === true && (x.falhas || 0) < 3 && x.origem !== 'whatsapp' && x.origem !== 'crm')) {
    const cfg = getConfig(l.cliente_id);
    if (!cfg.ativo || !dentroDoHorario(cfg)) continue;
    if (limiteDisparosRestante() <= 0 || feitos >= 15) break;
    await enviarTemplateLead(l); feitos++;
  }
  // 3) follow-up (só dentro da janela de 24h, no máximo 2 toques) e encerramento
  for (const l of v.leads.filter((x) => ['em_conversa'].includes(x.status) && !x.humano && x.ultima_entrada)) {
    const cfg = getConfig(l.cliente_id); if (!cfg.ativo) continue;
    const ult = l.mensagens.at(-1); if (!ult || ult.de !== 'felipe') continue;
    const horas = cfg.followup_horas[l.followups]; if (!horas) { if (l.followups >= cfg.followup_horas.length && Date.now() - new Date(ult.at).getTime() > HORAS(24)) { l.status = 'sem_resposta'; store.saveVendas(); } continue; }
    if (Date.now() - new Date(ult.at).getTime() < HORAS(horas) || !dentroDaJanela(l) || !dentroDoHorario(cfg)) continue;
    l.followups++;
    await enviarTexto(l, `${primeiroNome(l.nome) ? primeiroNome(l.nome) + ', ' : ''}ficou alguma dúvida? Se preferir, posso continuar mais tarde. 🙂`); feitos++;
  }
  return { feitos };
}

// ---------- Leads de campanha (Meta Lead Ads) ----------
export async function buscarLeadMeta(leadgenId) {
  const token = config.social?.fbPageToken || config.meta.token;
  const r = await httpJson(`https://graph.facebook.com/${config.meta.version}/${encodeURIComponent(leadgenId)}?fields=field_data,campaign_name,ad_name,created_time&access_token=${encodeURIComponent(token)}`);
  const f = Object.fromEntries((r.field_data || []).map((x) => [String(x.name).toLowerCase(), (x.values || [])[0]]));
  return { nome: f.full_name || f.nome || [f.first_name, f.last_name].filter(Boolean).join(' '), telefone: f.phone_number || f.telefone || f.whatsapp || f.phone, email: f.email, campanha: r.campaign_name || r.ad_name || '' };
}
export async function receberLeadsMeta(body) {
  let n = 0;
  for (const e of body?.entry || []) for (const c of e.changes || []) {
    if (c.field !== 'leadgen' || !c.value?.leadgen_id) continue;
    try { const d = await buscarLeadMeta(c.value.leadgen_id); const r = addLead({ ...d, origem: 'meta_lead_ads', consentimento: true }, 'meta'); if (r.lead && !r.duplicado) n++; }
    catch (err) { store.log({ type: 'lead_meta_erro', erro: trunc(err.message, 200) }); }
  }
  return { novos: n };
}
export function receberLeadGenerico(d = {}) {
  const lista = Array.isArray(d) ? d : [d];
  let novos = 0, erros = 0;
  for (const x of lista.slice(0, 200)) {
    const r = addLead({ cliente: x.cliente, nome: x.nome || x.name, telefone: x.telefone || x.phone || x.whatsapp || x.celular, email: x.email, campanha: x.campanha || x.campaign, origem: trunc(x.origem || x.source || 'webhook', 40), consentimento: x.consentimento !== false }, 'webhook');
    if (r.error) erros++; else if (!r.duplicado) novos++;
  }
  return { novos, erros };
}

export function painel(clienteRef) {
  const cli = store.cliente(clienteRef); const leads = store.vendas().leads.filter((l) => l.cliente_id === cli.id);
  const cont = (s) => leads.filter((l) => l.status === s).length;
  const base = config.publicUrl || '';
  return {
    cliente: { id: cli.id, nome: cli.nome },
    conexao: { whatsapp: wa.configurado(), template: !!(getConfig(cli.id).template || config.whatsapp.template), assinatura: !!config.whatsapp.appSecret, verify: !!config.whatsapp.verifyToken, hook_key: !!config.vendas.hookKey, ia: !!config.anthropicKey, modo: config.dryRun ? 'simulação' : 'real' },
    urls: { whatsapp: `${base}/hooks/whatsapp`, meta_leads: `${base}/hooks/meta-leads`, leads: `${base}/hooks/lead` },
    kpis: { total: leads.length, novos: cont('novo'), em_conversa: cont('em_conversa') + cont('contatado'), qualificados: cont('qualificado'), humano: cont('humano'), desqualificados: cont('desqualificado'), optout: cont('optout'), templates_hoje: contaTemplatesHoje().n, limite_dia: config.vendas.maxDisparosDia },
    config: getConfig(cli.id),
    disparos: store.vendas().disparos.filter((d) => d.cliente_id === cli.id).slice(0, 10).map((d) => ({ ...d, ids: undefined, restantes: d.ids.length })),
  };
}
