import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { platformStatus, socialStatus } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const promptOf = (id) => {
  try { return fs.readFileSync(path.join(here, '..', 'prompts', `${id}.md`), 'utf8'); } catch { return ''; }
};

// O time. Para mudar a função de alguém, edite aqui e o arquivo prompts/<id>.md.
export const AGENTS = [
  {
    id: 'camila', nome: 'Camila', cargo: 'Gestora de tráfego', emoji: '📈',
    funcao: 'Cria, analisa e otimiza campanhas de Google Ads e Meta Ads. Toda mudança passa por aprovação humana.',
    entrega: 'Propostas de campanhas e otimizações na fila de aprovações',
    ferramentas: 'google_*, meta_* (e linkedin_* em beta)',
    integracoes: () => { const p = platformStatus(); return [{ nome: 'Google Ads', ok: p.google }, { nome: 'Meta Ads', ok: p.meta }]; },
  },
  {
    id: 'hugo', nome: 'Hugo', cargo: 'Planejamento de conteúdo (IA)', emoji: '🗓️',
    funcao: 'Monta a pauta de conteúdos: para cada post, escreve a legenda e o briefing da arte, define canais e data.',
    entrega: 'Pautas na etapa "Em arte" (legenda + briefing)',
    ferramentas: 'hugo_criar_pauta, conteudo_revisar, marca_ver, conteudo_listar',
    integracoes: () => [{ nome: 'Kit da marca', ok: true }],
  },
  {
    id: 'luiz', nome: 'Luiz', cargo: 'Designer (IA)', emoji: '🎨',
    funcao: 'Recebe o briefing do criativo e cria a arte dentro dos padrões da marca. Registra o link da arte pronta.',
    entrega: 'Arte pronta, que sobe para aprovação humana',
    ferramentas: 'luiz_registrar_arte, marca_ver, conteudo_listar',
    integracoes: () => [{ nome: 'Canva (pelo conector do Claude)', ok: null }],
  },
  {
    id: 'mariana', nome: 'Mariana', cargo: 'Agendamento (IA)', emoji: '📣',
    funcao: 'Depois da aprovação humana, agenda cada post no canal certo, na data do cronograma.',
    entrega: 'Posts agendados/publicados em Instagram, Facebook, LinkedIn e TikTok',
    ferramentas: 'mariana_agendar, mariana_cronograma',
    integracoes: () => {
      const s = socialStatus();
      return [
        { nome: 'Instagram', ok: s.instagram }, { nome: 'Facebook', ok: s.facebook },
        { nome: 'LinkedIn', ok: false, nota: 'em breve' }, { nome: 'TikTok', ok: false, nota: 'em breve' },
      ];
    },
  },
  {
    id: 'felipe', nome: 'Felipe Macedo', cargo: 'Vendedor / SDR (IA)', emoji: '💼',
    funcao: 'Recebe leads das campanhas, responde no WhatsApp, aborda listas do CRM (com consentimento e aprovação) e pré-qualifica conversando, passando os bons leads para a equipe.',
    entrega: 'Leads qualificados com resumo, score e conversa completa',
    ferramentas: 'felipe_listar_leads, felipe_ver_conversa',
    integracoes: () => { const p = platformStatus(); return [{ nome: 'WhatsApp Business', ok: !!p.whatsapp }]; },
  },
];

export const teamInfo = () => AGENTS.map(({ integracoes, ...a }) => ({ ...a, integracoes: integracoes() }));
