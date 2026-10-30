// Felipe Macedo (SDR): telefone, dedupe, assinatura, opt-out, roteiro sem IA, IA simulada, disparo com aprovação.
import fs from 'node:fs';
import crypto from 'node:crypto';
process.env.DATA_DIR = './data/vendas-test';
process.env.DRY_RUN = 'false';
process.env.WHATSAPP_TOKEN = 'wt'; process.env.WHATSAPP_PHONE_ID = 'PH1'; process.env.WHATSAPP_APP_SECRET = 'segredo-teste'; process.env.WHATSAPP_VERIFY_TOKEN = 'vt'; process.env.WHATSAPP_TEMPLATE = 'boas_vindas';
process.env.VENDAS_MAX_DISPAROS_DIA = '3';
fs.rmSync('./data/vendas-test', { recursive: true, force: true });
let fails = 0; const ok = (c, m) => { console.log(c ? 'ok   ' : 'FALHA', m); if (!c) fails++; };
const enviados = []; let passoIA = 0; let iaModo = 'off';
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url); const j = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
  if (u.includes('graph.facebook.com') && u.endsWith('/messages')) { const b = JSON.parse(opts.body); if (b.status === 'read') return j({ success: true }); enviados.push(b); return j({ messages: [{ id: 'wamid.' + enviados.length }] }); }
  if (u.includes('api.anthropic.com')) {
    const base = { id: 'm', type: 'message', role: 'assistant', model: 'x', usage: { input_tokens: 1, output_tokens: 1 } };
    if (iaModo === 'credito') return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } }), { status: 400, headers: { 'content-type': 'application/json' } });
    passoIA++;
    if (passoIA % 2 === 1) return j({ ...base, stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't' + passoIA, name: 'atualizar_lead', input: { necessidade: 'loja virtual', prazo: 'este mês', score: 72, status: 'qualificado', resumo: 'Quer loja virtual este mês.' } }] });
    return j({ ...base, stop_reason: 'end_turn', content: [{ type: 'text', text: 'Perfeito! Vou pedir para a equipe te chamar ainda hoje.' }] });
  }
  return j({});
};
const v = await import('../src/vendas.js'); const wa = await import('../src/platforms/whatsapp.js');
const { config } = await import('../src/config.js'); const { store } = await import('../src/store.js');
await store.init();

ok(v.normalizarTelefone('(81) 99999-1234') === '5581999991234' && v.normalizarTelefone('+55 81 3333-1234') === '558133331234' && v.normalizarTelefone('123') === null, 'telefone BR é normalizado');
const a = v.addLead({ nome: 'Ana Souza', telefone: '81 99999-1234', origem: 'meta_lead_ads', consentimento: true }); const b = v.addLead({ telefone: '5581999991234', email: 'ana@x.com', consentimento: true });
ok(a.lead && b.duplicado && b.lead.id === a.lead.id && b.lead.email === 'ana@x.com', 'mesmo telefone não duplica e completa os dados');

// webhook: assinatura e verificação
const raw = Buffer.from('{"a":1}'); const sig = 'sha256=' + crypto.createHmac('sha256', 'segredo-teste').update(raw).digest('hex');
ok(wa.assinaturaValida(raw, sig) && !wa.assinaturaValida(raw, 'sha256=00') && !wa.assinaturaValida(raw, undefined), 'assinatura do webhook é conferida');
ok(wa.verificarChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'vt', 'hub.challenge': '42' }) === '42' && wa.verificarChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'x', 'hub.challenge': '42' }) === null, 'verificação do webhook exige o token');
const ms = wa.extrairMensagens({ entry: [{ changes: [{ value: { contacts: [{ wa_id: '5581999991234', profile: { name: 'Ana' } }], messages: [{ id: 'w1', from: '5581999991234', type: 'text', text: { body: 'oi' }, timestamp: '1700000000' }] } }] }] });
ok(ms.length === 1 && ms[0].texto === 'oi' && ms[0].nome === 'Ana', 'mensagem recebida é extraída do payload');

// primeiro contato por template (só com consentimento) + limite diário
const r1 = await v.contatarAgora(a.lead.id);
ok(r1.ok && enviados.at(-1).type === 'template' && enviados.at(-1).template.name === 'boas_vindas' && a.lead.status === 'contatado', 'primeiro contato usa template aprovado');
const semC = v.addLead({ nome: 'Sem', telefone: '81988887777', origem: 'crm' }).lead;
ok((await v.contatarAgora(semC.id)).error?.includes('consentimento'), 'lead sem consentimento nunca recebe mensagem');

// resposta sem IA → roteiro de perguntas até qualificar
config.anthropicKey = '';
await v.receberMensagem({ id: 'w1', de: '5581999991234', nome: 'Ana', texto: 'oi, vi o anúncio' });
ok(/assistente virtual/.test(enviados.at(-1).text.body) && a.lead.status === 'em_conversa', 'roteiro: apresenta-se como assistente virtual e faz a 1ª pergunta');
const n0 = enviados.length;
await v.receberMensagem({ id: 'w1', de: '5581999991234', texto: 'oi, vi o anúncio' });
ok(enviados.length === n0, 'mensagem repetida (mesmo id) é ignorada');
await v.receberMensagem({ id: 'w2', de: '5581999991234', texto: 'preciso de loja virtual' });
await v.receberMensagem({ id: 'w3', de: '5581999991234', texto: 'este mês' });
await v.receberMensagem({ id: 'w4', de: '5581999991234', texto: 'eu decido' });
ok(a.lead.status === 'qualificado' && a.lead.score >= 60 && /loja virtual/.test(a.lead.resumo), 'roteiro: ao fim das perguntas o lead fica qualificado com resumo');

// humano assumiu: o Felipe só registra
v.definirHumano(a.lead.id, true, 'adm'); const n1 = enviados.length;
await v.receberMensagem({ id: 'w5', de: '5581999991234', texto: 'e o preço?' });
ok(enviados.length === n1 && a.lead.mensagens.at(-1).texto === 'e o preço?', 'com humano na conversa o Felipe não responde');

// IA simulada
const c2 = v.addLead({ nome: 'Caio', telefone: '81977776666', origem: 'meta_lead_ads', consentimento: true }).lead;
config.anthropicKey = 'sk-ant-teste'; iaModo = 'ok';
await v.receberMensagem({ id: 'w6', de: '5581977776666', texto: 'Quero uma loja virtual ainda este mês' });
ok(c2.status === 'qualificado' && c2.score === 72 && /equipe/.test(enviados.at(-1).text.body), 'IA: registra a qualificação com a ferramenta e responde');

// IA sem crédito → cai no roteiro
const { iaStatus } = await import('../src/agent.js'); iaStatus.erro = ''; iaModo = 'credito';
const c3 = v.addLead({ nome: 'Duda', telefone: '81966665555', origem: 'meta_lead_ads', consentimento: true }).lead;
await v.receberMensagem({ id: 'w7', de: '5581966665555', texto: 'olá' });
ok(/assistente virtual/.test(enviados.at(-1).text.body), 'IA sem crédito: usa o roteiro de reserva');
config.anthropicKey = '';

// opt-out
await v.receberMensagem({ id: 'w8', de: '5581966665555', texto: 'PARAR' });
ok(c3.status === 'optout' && (await v.contatarAgora(c3.id)).error, 'PARAR encerra e bloqueia novos envios');

// importação CRM + disparo com aprovação e teto diário
const csv = 'nome,celular\nA,81911110001\nB,81911110002\nC,81911110003\nD,abc\n';
const imp = v.importarCsv('disco', csv, { consentimento: true });
ok(imp.novos === 3 && imp.invalidos === 1, 'CSV do CRM importa válidos e recusa inválidos');
const d = v.proporDisparo({ cliente: 'disco', filtro: { origem: 'crm' }, by: 'u' }).disparo;
ok(d && d.ids.length === 3 && d.estado === 'pendente', 'disparo nasce pendente (precisa de aprovação)');
const nA = enviados.length; await v.tick(); ok(enviados.length === nA, 'disparo pendente não envia nada');
v.salvarConfig('disco', { ativo: true, horario_inicio: 0, horario_fim: 24 });
v.decidirDisparo(d.id, true, 'adm');
const t0 = enviados.length; await v.tick();
const hojeN = enviados.slice(t0).filter((x) => x.type === 'template').length;
ok(hojeN >= 1 && hojeN <= 3, `disparo aprovado envia respeitando o teto diário (${hojeN})`);
ok(v.limiteDisparosRestante() === 0 || hojeN < 3, 'contador diário é atualizado');
console.log(fails ? `\n${fails} FALHA(S)` : '\nvendas: tudo certo');
process.exit(fails ? 1 : 0);
