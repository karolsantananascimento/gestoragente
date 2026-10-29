import { googleTools } from './platforms/google.js';
import { metaTools } from './platforms/meta.js';
import { linkedinTools } from './platforms/linkedin.js';

// Ferramentas de plataforma. Formato de cada uma:
// { name, platform, risk: 'read'|'write', description, params,
//   summarize(args)  -> texto curto do que será feito (mostrado na aprovação),
//   budgetBRL?(args) -> orçamento diário envolvido, para validar o teto,
//   isActivation?(args) -> true se a ação liga/ativa algo que gasta,
//   precheck?(args)  -> { error?, warn? } validações dependentes de dados da conta,
//   handler(args)    -> executa na plataforma }
export const platformTools = [...googleTools, ...metaTools, ...linkedinTools];

export const getPlatformTool = (name) => platformTools.find((t) => t.name === name);
