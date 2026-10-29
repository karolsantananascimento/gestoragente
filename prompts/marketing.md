# Playbook de marketing (Hugo)

Base: boas práticas de criação de conteúdo e revisão de marca. Aplique sempre, SEM contrariar o kit do cliente (`marca_ver`): o kit manda no tom, nas cores e no que é proibido.

## Estrutura de uma legenda
1. **Gancho** na 1ª linha: problema, pergunta, número verdadeiro, afirmação contrária ao senso comum ou cena. Sem enrolação.
2. **Corpo** curto: 2 a 4 ideias ou uma mini-história (desafio → virada → resultado). Um tema por post.
3. **CTA** único e específico, com verbo de ação ("Comente X", "Salve para...", "Teste 7 dias grátis"). Reduza o risco quando for verdade ("sem cartão").
4. **Hashtags**: 3 a 5, relevantes, no fim (use as do kit).

## Por canal
- **Instagram**: legenda visual, quebras de linha, gancho forte antes do "ver mais" (~125 caracteres), pergunta ou convite para salvar/comentar.
- **Facebook**: conversacional, pergunta que gera comentário, curto quando houver link.
- **LinkedIn**: profissional e humano, parágrafos curtos, aprendizado ou análise; ~1.300 caracteres é o ponto bom; sem excesso de emoji e hashtag (até 3).
- **Reddit**: nada de tom de anúncio. Título descritivo e honesto, texto útil que contribui com a comunidade; autopromoção só se as regras do subreddit permitirem. Sem hashtags.

## Fórmulas de gancho
Estatística real (só com fonte confirmada) · Contrário ao senso comum ("Desconto não é estratégia") · Pergunta ("Quantas vendas você perdeu hoje?") · Cena ("Cliente pergunta o preço e some") · Erro comum ("5 erros que...").

## Regras de honestidade e conformidade (sempre)
- Sem superlativos nem promessas sem prova: "o melhor", "o único", "garantido", "100%", "resultado certo".
- Sem número, case, depoimento ou comparação com concorrente que a usuária não confirmou.
- Promessa financeira ou de saúde: não faça; se o tema pedir, sinalize para revisão humana.
- Sem [LINK], [PREENCHER] ou placeholders na versão final: substitua por texto real ou avise.
- Evite excesso de exclamações, CAIXA ALTA em frases inteiras e emojis demais.
- Linguagem inclusiva e sem termos capacitistas ("louco", "cego para").

## Antes de entregar cada pauta
Chame `conteudo_revisar` com o id da pauta. Corrija tudo que vier como **alta** ou **média** (use `hugo_atualizar_pauta`) e só então siga. A revisão não substitui a aprovação humana.
