// Teste de fumaça das travas de segurança, em modo simulação e sem credenciais reais.
process.env.DRY_RUN = 'true';
process.env.DATA_DIR = './data/test';
process.env.MAX_DAILY_BUDGET_BRL = '300';
process.env.MAX_ACTIVATIONS_PER_DAY = '2';
process.env.APPROVAL_PIN = '4242';

import fs from 'node:fs';
fs.rmSync('./data/test', { recursive: true, force: true });

const { callTool, allTools } = await import('../src/tools.js');
const { approveAction } = await import('../src/guardrails.js');

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FALHA'} ${msg}`); if (!cond) fails++; };

// 1. Leitura sem credencial → erro claro, sem quebrar
let r = await callTool('google_listar_campanhas', { customer_id: '123-456-7890' });
ok(r.status === 'nao_configurado', 'leitura sem credenciais retorna "nao_configurado"');

r = await callTool('meta_listar_contas');
ok(r.status === 'nao_configurado' && /META_ACCESS_TOKEN/.test(r.erro), 'Meta sem token informa exatamente o que falta');
r = await callTool('meta_listar_campanhas', {});
ok(r.status === 'nao_configurado', 'Meta sem token não quebra ao listar campanhas');

// 2. Escrita vira proposta pendente, nunca executa direto
r = await callTool('google_pausar_ativar_campanha', { customer_id: '1234567890', campaign_id: '99', status: 'PAUSED' });
ok(r.status === 'pendente_aprovacao' && r.id, 'pausar campanha vira proposta pendente');
const idPausa = r.id;

// 3. Teto de orçamento bloqueia
r = await callTool('google_criar_campanha_pesquisa', { customer_id: '1234567890', nome: 'Teste', orcamento_diario_brl: 5000, estrategia: 'MAXIMIZE_CONVERSIONS' });
ok(r.status === 'bloqueado', 'orçamento acima do teto é bloqueado');

// 4. Orçamento dentro do teto vira proposta
r = await callTool('google_criar_campanha_pesquisa', { customer_id: '1234567890', nome: 'Teste', orcamento_diario_brl: 100, estrategia: 'MAXIMIZE_CONVERSIONS' });
ok(r.status === 'pendente_aprovacao', 'criar campanha dentro do teto vira proposta');

// 5. RSA inválido é barrado antes da fila
r = await callTool('google_criar_grupo_com_anuncio', {
  customer_id: '1234567890', campaign_id: '1', nome_grupo: 'G', titulos: ['a'.repeat(31), 'b', 'c'], descricoes: ['d', 'e'], url_final: 'https://x.com',
});
ok(r.status === 'bloqueado', 'título com mais de 30 caracteres é bloqueado');

// 6. Aprovar em dry-run simula e não toca na rede
r = await approveAction(idPausa, 'teste');
ok(r.status === 'simulado', 'aprovação em DRY_RUN apenas simula');

// 7. Não aprova duas vezes
r = await approveAction(idPausa, 'teste');
ok(r.status === 'erro', 'ação já executada não roda de novo');

// 8. Limite de ativações por dia (2)
for (let i = 0; i < 3; i++) {
  const p = await callTool('meta_pausar_ativar', { id: `10${i}`, status: 'ACTIVE' });
  if (p.status === 'pendente_aprovacao') await approveAction(p.id, 'teste');
}
r = await callTool('meta_pausar_ativar', { id: '999', status: 'ACTIVE' });
ok(r.status === 'bloqueado', 'terceira ativação do dia é bloqueada');

// 9. PIN do MCP
r = await callTool('aprovar_acao', { id: 'x', pin: 'errado' });
ok(r.erro === 'PIN incorreto.', 'PIN errado é recusado');

// 10. Chat não enxerga aprovar_acao
const { agentTools } = await import('../src/tools.js');
ok(!agentTools.some((t) => t.name === 'aprovar_acao'), 'agente do chat não tem a ferramenta aprovar_acao');
ok(allTools.some((t) => t.name === 'aprovar_acao'), 'MCP expõe aprovar_acao');

console.log(fails ? `\n${fails} falha(s)` : '\nTodos os testes passaram');
process.exit(fails ? 1 : 0);
