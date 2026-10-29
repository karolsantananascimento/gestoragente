import { callTool } from './tools.js';
import { getPlatformTool } from './registry.js';
import { proposeAction } from './guardrails.js';
import { config } from './config.js';

// Comandos de tráfego na caixa de diálogo (sem IA): pausar, ativar e ajustar orçamento de campanhas do Meta.
// Nada executa direto: cada comando vira uma PROPOSTA que um administrador aprova com um clique (os tetos de segurança valem).
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const num = (s) => Number(String(s).replace(/\./g, '').replace(',', '.'));
const brl = (v) => `R$ ${Number(v).toFixed(2).replace('.', ',')}`;

function intent(t) {
  const n = norm(t);
  const campanha = /\b(campanha|campanhas|conjunto|anuncio|adset|ad set|id)\b|\b\d{8,}\b/.test(n);
  let m;
  if ((m = n.match(/\b(aumentar|aumente|subir|suba|elevar|eleve|reduzir|reduza|diminuir|diminua|baixar|baixe|cortar|corte)\b.*?\b(\d+(?:[.,]\d+)?)\s*%/))) return { tipo: 'pct', sinal: /^(reduz|dimin|baix|cort)/.test(m[1]) ? -1 : 1, pct: num(m[2]) };
  if (/\b(orcamento|budget|verba)\b/.test(n) && (m = n.match(/\b(?:para|pra|=|em|de)\s*(?:r\$\s*)?(\d+(?:[.,]\d+)?)\b(?!\s*%)/g))) { const v = n.match(/(?:para|pra|=)\s*(?:r\$\s*)?(\d+(?:[.,]\d+)?)(?!\s*%)/); if (v) return { tipo: 'orcamento', valor: num(v[1]) }; }
  if (campanha && /\b(pausar|pause|pare|parar|desligar|desligue)\b/.test(n)) return { tipo: 'status', status: 'PAUSED' };
  if (campanha && /\b(ativar|ative|reativar|reative|ligar|ligue|retomar|retome)\b/.test(n)) return { tipo: 'status', status: 'ACTIVE' };
  return null;
}
// Trecho que identifica a campanha: entre aspas, ou depois da palavra "campanha"/"conjunto" até um conector.
function alvoDe(t) {
  const q = String(t).match(/["“'‘]([^"”'’]{2,80})["”'’]/); if (q) return { nome: q[1].trim() };
  const id = String(t).match(/\b(\d{8,})\b/); if (id) return { id: id[1] };
  const m = norm(t).match(/\b(?:campanha|conjunto|anuncio)\s+(?:de\s+|da\s+|do\s+)?(.+?)(?:\s+(?:para|pra|em|por|de|com|em)\s+(?:r\$|\d|ate)|\s+(?:para|pra)\b|\s+\d+\s*%|$)/);
  return m ? { nome: m[1].trim() } : null;
}

async function contas() {
  if (config.meta.adAccountId) return [config.meta.adAccountId];
  const r = await callTool('meta_listar_contas', {}, 'chat');
  return Array.isArray(r) ? r.map((a) => a.id) : [];
}
async function acharCampanhas(nome) {
  const alvo = norm(nome); const achadas = [];
  for (const acc of (await contas()).slice(0, 6)) {
    const r = await callTool('meta_listar_campanhas', { ad_account_id: acc }, 'chat');
    if (!Array.isArray(r)) continue;
    for (const c of r) if (norm(c.nome).includes(alvo)) achadas.push({ ...c, conta: acc });
  }
  return achadas;
}

export async function runTrafego({ texto, by }) {
  const it = intent(texto);
  if (!it) return { handled: false };
  if (!config.meta.token) return { handled: true, reply: 'O Meta Ads não está conectado (falta META_ACCESS_TOKEN no Render).' };
  const alvo = alvoDe(texto);
  if (!alvo) return { handled: true, reply: 'Qual campanha? Informe o nome entre aspas, por exemplo: pausar campanha "Leads Black Friday". Veja os nomes com o botão "Campanhas do Meta".' };
  let camp;
  if (alvo.id) camp = { id: alvo.id, nome: alvo.id };
  else {
    const achadas = await acharCampanhas(alvo.nome);
    if (!achadas.length) return { handled: true, reply: `Não achei nenhuma campanha com "${alvo.nome}" no nome. Use o botão "Campanhas do Meta" para ver os nomes exatos.` };
    if (achadas.length > 1) return { handled: true, reply: `Achei ${achadas.length} campanhas com "${alvo.nome}". Seja mais específico, ou use o ID:\n` + achadas.slice(0, 8).map((c) => `• ${c.nome} (${c.id}) · ${c.status}${c.orcamento_dia_brl ? ` · ${brl(c.orcamento_dia_brl)}/dia` : ''}`).join('\n') };
    camp = achadas[0];
  }
  let tool, args, intro;
  if (it.tipo === 'status') {
    tool = 'meta_pausar_ativar'; args = { id: camp.id, status: it.status };
    if (camp.status === it.status) return { handled: true, reply: `"${camp.nome}" já está ${it.status === 'PAUSED' ? 'pausada' : 'ativa'}.` };
    intro = `${it.status === 'PAUSED' ? 'Pausar' : 'Ativar'} "${camp.nome}"`;
  } else {
    let novo = it.valor;
    if (it.tipo === 'pct') {
      const atual = camp.orcamento_dia_brl ?? (await callTool('meta_listar_campanhas', { ad_account_id: camp.conta }, 'chat').then((r) => (Array.isArray(r) ? r.find((c) => c.id === camp.id)?.orcamento_dia_brl : null)).catch(() => null));
      if (!atual) return { handled: true, reply: `"${camp.nome}" não tem orçamento diário na campanha (pode estar nos conjuntos). Informe o valor, por exemplo: orçamento da campanha "${camp.nome}" para 50, ou use o ID do conjunto.` };
      novo = Math.round(atual * (1 + it.sinal * it.pct / 100) * 100) / 100;
    }
    tool = 'meta_ajustar_orcamento'; args = { id: camp.id, novo_orcamento_brl: novo };
    intro = `Orçamento diário de "${camp.nome}" → ${brl(novo)}`;
  }
  const r = await proposeAction(getPlatformTool(tool), args, `chat:${by}`);
  if (r.status === 'bloqueado') return { handled: true, reply: `Bloqueado pelos tetos de segurança: ${r.motivos.join(' ')}` };
  return { handled: true, acao: { id: r.id, resumo: r.resumo, avisos: r.avisos, modo: r.modo }, reply: `${intro}. Proposta #${r.id} criada${config.dryRun ? ' (modo simulação: nada será alterado na conta)' : ''}.${r.avisos?.length ? '\n' + r.avisos.join('\n') : ''}\nUm administrador precisa aprovar para executar no Meta.` };
}
