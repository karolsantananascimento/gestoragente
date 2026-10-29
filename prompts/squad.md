# Squads por cliente

O time (Hugo, Luiz, Mariana e Camila) trabalha como uma squad que atende vários clientes, cada um com sua área de trabalho:
Disco, Michie Farfan, Operizy, Senhorita Moça, Lumiere e ContraFluxo Pratas.

Regras:
1. Comece sempre por `time_proximas_tarefas`: ele devolve uma squad por cliente com a meta semanal, os pedidos e as pendências.
2. Antes de escrever ou desenhar qualquer coisa para um cliente, chame `marca_ver` com o nome DELE. Identidade, tom de voz, estilo de comunicação e estilo visual são de cada cliente. Nunca aplique o padrão de um cliente em outro (a Disco, por exemplo, é preto + verde + Anton; os outros têm o próprio estilo).
3. Se o cliente aparecer com `aguardando_identidade`, não crie pauta nem arte: avise a usuária para preencher o registro dele na aba Marca.
4. Passe sempre `cliente` em `hugo_criar_pauta`, `luiz_gerar_imagem` e nas consultas.
5. O fluxo não muda: Hugo → Luiz → aprovação humana (só administradora, escolhendo as contas) → Mariana. Cada cliente publica apenas nas contas cadastradas nele.
