import { config } from './config.js';
import { anthropic, marcarIA, iaComProblema, iaStatus } from './agent.js';
import { buscarInteresses } from './platforms/meta.js';

// A pessoa descreve o perfil do público numa caixa de texto; aqui isso vira idade, gênero e interesses REAIS do Meta
// (cada termo sugerido é buscado no Meta e só volta o que existe, com o id e o tamanho estimado).
const SYS = 'Você ajuda a montar a segmentação de anúncios do Meta no Brasil. A pessoa descreve o perfil do público que quer alcançar. Devolva a faixa de idade, o gênero e de 4 a 8 TERMOS de interesse curtos, em português, que costumam existir como interesses de segmentação do Meta (ex.: "Estética", "Harmonização facial", "Skin care", "Cuidados com a pele"). Pense em comportamentos de consumo e temas ligados ao que a pessoa descreveu. Não invente números: se a pessoa não citou idade ou gênero, omita.';

const ferramenta = {
  name: 'definir_publico',
  description: 'Define a segmentação sugerida para o público descrito.',
  input_schema: {
    type: 'object',
    properties: {
      idade_min: { type: 'number', description: 'Idade mínima (13 a 65), só se citada ou claramente implícita' },
      idade_max: { type: 'number', description: 'Idade máxima (13 a 65), só se citada ou claramente implícita' },
      genero: { type: 'string', enum: ['todos', 'masculino', 'feminino'] },
      interesses: { type: 'array', items: { type: 'string' }, description: 'Termos de interesse curtos' },
    },
    required: ['interesses'],
  },
};

// Sem IA (sem chave ou sem crédito): extrai o que dá do próprio texto.
function heuristica(t) {
  const f = /mulher|feminin|elas\b/i.test(t), m = /homem|homens|masculin|eles\b/i.test(t);
  const idade = /(\d{2})\s*(?:a|à|-|–|até|e)\s*(\d{2})/.exec(t);
  const interesses = t.replace(/\d{2}\s*(?:a|à|-|–|até|e)\s*\d{2}\s*anos?/gi, ' ').split(/[,;\n.]+|\s+e\s+/).map((x) => x.replace(/\b(mulheres?|homens?|pessoas|público|que|de|para|buscam|querem|interessad[oa]s? em)\b/gi, ' ').replace(/\s+/g, ' ').trim()).filter((x) => x.length >= 4 && x.length <= 40).slice(0, 8);
  return { genero: f && !m ? 'feminino' : m && !f ? 'masculino' : undefined, idade_min: idade ? Number(idade[1]) : undefined, idade_max: idade ? Number(idade[2]) : undefined, interesses };
}

export async function sugerirPublico(descricao) {
  const texto = String(descricao || '').trim().slice(0, 1500);
  if (texto.length < 5) return { error: 'Descreva o perfil do público (ex.: mulheres de 30 a 45 anos que se cuidam e buscam procedimentos estéticos).' };
  let base = null, origem = 'texto', aviso = '';
  if (config.anthropicKey && !iaComProblema()) {
    try {
      const r = await anthropic().messages.create({ model: config.model, max_tokens: 600, system: SYS, tools: [ferramenta], tool_choice: { type: 'tool', name: 'definir_publico' }, messages: [{ role: 'user', content: texto }] });
      base = r.content.find((b) => b.type === 'tool_use')?.input || null; if (base) origem = 'ia'; marcarIA(null);
    } catch (e) { marcarIA(e); aviso = `IA indisponível (${iaStatus.erro}). Usei só as palavras do seu texto.`; }
  } else if (config.anthropicKey) aviso = `IA indisponível (${iaStatus.erro}). Usei só as palavras do seu texto.`;
  else aviso = 'Sem ANTHROPIC_API_KEY: usei só as palavras do seu texto.';
  if (!base) base = heuristica(texto);

  const termos = [...new Set((base.interesses || []).map((x) => String(x).trim()).filter(Boolean))].slice(0, 8);
  const achados = await Promise.allSettled(termos.map((t) => buscarInteresses(t)));
  const erro = achados.find((x) => x.status === 'rejected');
  if (erro && achados.every((x) => x.status === 'rejected')) return { error: `Não consegui consultar os interesses no Meta: ${erro.reason?.message || erro.reason}` };
  const vistos = new Set(); const interesses = [];
  achados.forEach((x, i) => { if (x.status !== 'fulfilled') return; for (const it of x.value.slice(0, 3)) if (!vistos.has(it.id)) { vistos.add(it.id); interesses.push({ ...it, termo: termos[i] }); } });
  let imin = Number(base.idade_min) || undefined, imax = Number(base.idade_max) || undefined;
  if (imin) imin = Math.min(65, Math.max(13, imin)); if (imax) imax = Math.min(65, Math.max(13, imax));
  if (imin && imax && imin > imax) [imin, imax] = [imax, imin];
  return { origem, aviso, idade_min: imin, idade_max: imax, genero: ['masculino', 'feminino', 'todos'].includes(base.genero) ? base.genero : undefined, interesses };
}
