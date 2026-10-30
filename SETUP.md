# Agente de Tráfego · Guia de setup

Agente que cria e otimiza campanhas (Google, Meta, LinkedIn) a partir de texto. Funciona de dois jeitos ao mesmo tempo:

- **Chat web** (`https://SEU-SERVICO.onrender.com`): conversa + painel de aprovação.
- **Servidor MCP** (`https://SEU-SERVICO.onrender.com/mcp`): conecte no Claude como conector personalizado e peça no próprio Claude.

## Acesso e equipe

- **Administradora principal:** `knasck@gmail.com` (variável `ADMIN_EMAIL`). Entra com esse e-mail + a `APP_PASSWORD` e pode trocar a senha no botão **Senha**. Não pode ser removida.
- **Convites:** botão **Equipe** → informe o e-mail e o papel → o painel gera um link válido por 7 dias (copie e envie). Se configurar `RESEND_API_KEY` e `MAIL_FROM`, o e-mail é enviado automaticamente.
- **Papéis:** *Colaborador* conversa com o agente e propõe ações. *Administrador* também aprova/rejeita ações, vê a auditoria e gerencia a equipe.
- **Atenção:** no plano gratuito do Render o disco é efêmero, então colaboradores, fila e histórico somem a cada reinício ou deploy. Para manter a equipe, use o plano Starter com disco (`render.yaml`). Enquanto isso, a administradora sempre consegue entrar com `APP_PASSWORD`.

## Entrar com Google

1. Google Cloud Console → **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth** → tipo **Aplicativo da Web**.
2. Em **Origens JavaScript autorizadas**, adicione a URL do painel (ex.: `https://gestoragente.onrender.com`). Não precisa de URI de redirecionamento.
3. Copie o **ID do cliente** (termina em `.apps.googleusercontent.com`; não é segredo) e coloque em `GOOGLE_LOGIN_CLIENT_ID` no Render.
4. Pronto: aparece o botão **Continuar com Google**. Entra quem tem acesso (administradora ou convidado). Convidados também podem aceitar o convite pelo Google, desde que a conta seja a do e-mail convidado.
5. Quando estiver tudo funcionando, defina `DISABLE_PASSWORD_LOGIN=true` para aceitar **somente** Google. Faça isso só depois de testar o seu login, para não se trancar para fora.

## Segurança em camadas

1. **DRY_RUN=true por padrão**: simula tudo, não toca nas contas.
2. **Toda escrita vira proposta pendente.** Só executa depois da sua aprovação (botão no painel, ou `aprovar_acao` + PIN no MCP).
3. **Tetos no código**: orçamento diário máximo, aumento máximo por ação (+20%), máximo de ativações por dia. Revalidados na hora de executar.
4. **Nunca exclui**: só pausa.
5. **Campanhas nascem pausadas.** Ativar é outra ação, com outra aprovação.
6. **Auditoria** de tudo em `/api/audit`.

## Ordem de execução

### 1. Testar localmente (5 min)
```bash
cp .env.example .env     # preencha APP_PASSWORD, MCP_TOKEN, APPROVAL_PIN
npm install
npm test                 # travas de segurança
export $(grep -v '^#' .env | xargs) && npm start
```
Abra http://localhost:3000.

### 2. Subir no GitHub
```bash
git init && git add . && git commit -m "traffic agent"
# crie um repositório privado no GitHub e:
git remote add origin git@github.com:SEU_USUARIO/traffic-agent.git
git push -u origin main
```

### 3. Deploy no Render
Dashboard Render → **New → Blueprint** → escolha o repositório (usa o `render.yaml`). Preencha os segredos pedidos:
`APP_PASSWORD`, `MCP_TOKEN`, `APPROVAL_PIN`, `ANTHROPIC_API_KEY` (as de plataforma pode deixar em branco por enquanto).

URL final: `https://traffic-agent.onrender.com` (se o nome estiver ocupado, o Render adiciona um sufixo).

### 4. Conectar no Claude (MCP)
Claude → Configurações → Conectores → **Adicionar conector personalizado**:
- URL: `https://SEU-SERVICO.onrender.com/mcp`
- Autenticação: cabeçalho `Authorization: Bearer <MCP_TOKEN>` (se a sua versão do Claude só aceitar OAuth, use o chat web, ou coloque um proxy de autenticação na frente).

### 5. Credenciais das plataformas (a parte mais demorada, comece cedo)

**Google Ads**
1. Conta MCC → Ferramentas → Central de API → solicite o **developer token** (nível básico leva alguns dias).
2. Google Cloud → crie projeto, ative *Google Ads API*, crie credencial OAuth (tipo "App para computador") → `CLIENT_ID` e `CLIENT_SECRET`.
3. Gere o **refresh token** pelo OAuth Playground com o escopo `https://www.googleapis.com/auth/adwords`.
4. `GOOGLE_ADS_LOGIN_CUSTOMER_ID` = ID da MCC (só números).
5. Confirme a versão vigente da API e ajuste `GOOGLE_ADS_API_VERSION`.

**Meta Ads** (basta o token; o ID da conta o agente descobre com `meta_listar_contas`)
1. developers.facebook.com → crie app (tipo Business) → adicione **Marketing API**.
2. Business Manager → Usuários do sistema → crie um usuário **Admin** → atribua a conta de anúncio → gere token com `ads_management` e `ads_read` (token de longa duração).
3. `META_AD_ACCOUNT_ID` no formato `act_123...`.

**LinkedIn Ads**
1. developers.linkedin.com → crie app, solicite **Advertising API / Marketing Developer Platform** (aprovação manual).
2. Gere token OAuth com `r_ads`, `rw_ads`, `r_ads_reporting`. Anote o ID da conta de anúncio.

### 6. Validar em SIMULAÇÃO com dados reais
Com `DRY_RUN=true` e credenciais preenchidas, as **leituras são reais** (listar campanhas, termos, desempenho) e as **escritas são simuladas**. Teste:
- "Lista as campanhas da conta 123-456-7890 dos últimos 7 dias"
- "Mostra os termos de pesquisa que gastaram sem converter"
- "Propõe negativas para a campanha X" → aprove no painel e veja o resultado simulado

### 7. Ir para o modo real (só depois do passo 6)
1. Reduza os tetos (`MAX_DAILY_BUDGET_BRL`) para um valor baixo no início.
2. Em uma conta de teste, coloque `DRY_RUN=false` e rode **uma** ação de baixo risco (adicionar uma negativa).
3. Confira na própria plataforma que a mudança aconteceu.
4. Aumente a confiança aos poucos.

## Limitações conhecidas (leia antes de usar em produção)

- **As chamadas às APIs não foram testadas contra contas reais**; foi testada a estrutura, as travas e o fluxo de aprovação em simulação. Valide cada ferramenta de escrita na sua conta de teste antes de confiar nela. Os pontos mais sensíveis a mudanças de versão são `google_criar_*`, `meta_criar_campanha` e tudo do LinkedIn.
- Criação de conjuntos/anúncios do **Meta** e de campanhas no **LinkedIn** ainda não existe (só leitura, pausa/ativação e, no Meta, criar campanha e ajustar orçamento). É a próxima fase.
- A fila de aprovação usa arquivo em disco. Funciona em 1 instância; para escalar, migre para Postgres.
- O MCP usa Bearer token fixo. Para uso por mais pessoas, implemente OAuth.

## Evoluções sugeridas
1. Rotina diária (cron do Render) que chama o agente, gera relatório e deixa propostas na fila.
2. Alertas de saldo e anomalia (CPA, gasto) por e-mail/WhatsApp.
3. Criação completa no Meta (conjunto + criativo) e LinkedIn.
4. Edite `prompts/master.md` com a sua metodologia: é o que faz o agente pensar como você.


## O time (Camila, Hugo, Luiz e Mariana)

- **Camila** · gestora de tráfego (Google e Meta Ads) — as ferramentas `google_*` e `meta_*`.
- **Hugo** · pauta de conteúdo (legenda + briefing da arte) — `hugo_criar_pauta`.
- **Luiz** · designer, segue o kit da aba **Marca** — `luiz_registrar_arte`.
- **Mariana** · agenda depois da aprovação — `mariana_agendar`, `mariana_cronograma`.

Fluxo: Hugo → Luiz → **botão Aprovar (só administrador, aba Conteúdo)** → Mariana. Nenhuma ferramenta de IA aprova conteúdo.

Integrações da Mariana (variáveis no Render, todas opcionais):
- Facebook: `META_PAGE_ID` + `META_PAGE_ACCESS_TOKEN` (permissões pages_manage_posts, pages_read_engagement). Agendado dentro do Facebook.
- Instagram: `INSTAGRAM_USER_ID` (conta profissional ligada à página). O servidor publica na hora marcada.
- LinkedIn e TikTok: espaço reservado, ainda não implementado. Aparecem como "sem integração" e você publica manualmente.
- A arte precisa ser um link público https (JPG/PNG).

Persistência: sem `DATABASE_URL` os dados ficam em arquivo e somem a cada reinício no plano gratuito. Com `DATABASE_URL` (Postgres) equipe, conteúdo e marca ficam salvos.


## Imagens com ChatGPT (Luiz)
1. Crie uma chave em platform.openai.com (API keys) e cadastre **somente no Render → Environment** como `OPENAI_API_KEY`. Nunca cole a chave no chat nem no GitHub.
2. Opcional: `OPENAI_IMAGE_MODEL` (padrão `gpt-image-1`), `OPENAI_IMAGE_QUALITY` (`low`, `medium`, `high`; padrão `medium`) e `IMAGE_DAILY_CAP` (teto de imagens por dia; padrão 20).
3. O Luiz usa a ferramenta `luiz_gerar_imagem` para criar o fundo/ilustração (sem texto), envia ao Canva e compõe título em Anton, logo e CTA lá. Com `DRY_RUN=true` nada é gerado nem cobrado.
4. `modo: arte_completa` gera a arte final com texto, usando as imagens de referência da marca (`public/brand/ref/`). Qualidade padrão `high` (`OPENAI_IMAGE_QUALITY_FINAL`). Tamanho: 1024x1536 por padrão; se a sua conta tiver modelo com proporção 4:5, defina `OPENAI_SIZE_RETRATO` (ex.: 1024x1280). O Instagram só aceita feed entre 4:5 e 1.91:1, então confira o formato antes de aprovar.

## Execução automática do time (opcional, recomendada)
Defina `ANTHROPIC_API_KEY` no Render. Com ela o Hugo cria as pautas sozinho: na hora de cada pedido (caixa de diálogo ou "Pedir ao time"), no botão "Rodar agora" e todo dia às 07h (Recife) para completar a meta semanal de cada cliente (`AUTO_TEAM_DAILY=false` desliga a rotina diária). Só roda para clientes com kit de marca completo. A arte continua com o Luiz no Canva (conector do Claude).

## Reddit (publicação)
1. Em reddit.com/prefs/apps crie um app do tipo **web app**, com redirect uri `https://SEU-DOMINIO/api/reddit/callback`.
2. No Render defina `REDDIT_CLIENT_ID` (abaixo do nome do app) e `REDDIT_CLIENT_SECRET`. Opcional: `REDDIT_USER_AGENT`.
3. No painel (Marca → Publicação) informe o subreddit do cliente e clique em **Conectar Reddit**: você autoriza no site do Reddit e o sistema guarda só o token de acesso (nunca a senha).
4. Use **Verificar Reddit** para conferir conta e subreddit. Posts são de texto (título + legenda + link da arte) e só saem depois da aprovação humana.
Atenção: o Reddit exige aprovação de acesso à API para apps novos e cada subreddit tem regras (autopromoção, flair, frequência). Contas que postam material promocional em excesso levam ban.

## LinkedIn (publicação)
1. Em linkedin.com/developers crie um app (vinculado a uma página da empresa), peça o produto **Compartilhar no LinkedIn** (escopo w_member_social) e, na aba Auth, adicione o redirect `https://SEU-DOMINIO/api/linkedin/callback`.
2. No Render defina `LINKEDIN_CLIENT_ID` e `LINKEDIN_CLIENT_SECRET`.
3. No painel (Marca → Publicação) clique em **Conectar LinkedIn**, autorize, depois em **Usar meu perfil** no cliente que vai publicar e em **Salvar marca**. Cada cliente só publica com o autor cadastrado.
4. O token vale cerca de 60 dias: o painel avisa e basta reconectar. Para publicar numa **página** é preciso o produto de páginas (w_organization_social, aprovação do LinkedIn) e informar o URN `urn:li:organization:ID`.


## Subir campanhas pelo painel (Meta)
Na aba Tráfego, "Nova campanha" cria campanha, conjunto, criativo e anúncio, tudo pausado, com uma única aprovação. Requisitos: token do Meta com `ads_management`, a página do Facebook do cliente cadastrada na aba Marca (ou META_PAGE_ID para a Disco) e, para Leads/Vendas no site, o pixel (campo no formulário ou variável opcional `META_PIXEL_ID`). O destino WhatsApp exige um número do WhatsApp Business conectado à página.

## Felipe Macedo (vendedor / SDR com IA no WhatsApp)

Aba **💼 Vendas**. Felipe recebe leads (Lead Ads da Meta, formulários/CRM por webhook, lista importada em CSV), faz o primeiro contato por **template aprovado**, responde no WhatsApp, pré-qualifica (necessidade, prazo, decisor) e passa os qualificados para a equipe com resumo e score. Modelo: SDR conversacional BANT/SPIN (como 11x Alice, Artisan Ava, HubSpot Breeze). Sem crédito/chave da Anthropic ele usa um roteiro de perguntas configurável.

**Variáveis no Render (você mesma define; nunca cole tokens no chat):**
- `WHATSAPP_TOKEN` (token permanente do usuário do sistema), `WHATSAPP_PHONE_ID` (ID do número na WhatsApp Cloud API)
- `WHATSAPP_VERIFY_TOKEN` (texto que você inventa; igual ao informado no webhook da Meta)
- `WHATSAPP_APP_SECRET` (ou `META_APP_SECRET`): chave secreta do app, usada para validar a assinatura. Sem ela, os webhooks são recusados.
- `WHATSAPP_TEMPLATE` (nome do template de abertura **aprovado pela Meta**, categoria Marketing/Utility, com 2 variáveis: {{1}} nome, {{2}} empresa) e, se preciso, `WHATSAPP_TEMPLATE_LANG` (padrão pt_BR)
- `VENDAS_HOOK_KEY` (chave do webhook genérico), opcional `VENDAS_MAX_DISPAROS_DIA` (padrão 50) e `VENDAS_CLIENTE_PADRAO`

**Webhooks (Meta for Developers → app → WhatsApp → Configuration):**
- Mensagens: `https://SEU-APP/hooks/whatsapp` (campo `messages`)
- Lead Ads: `https://SEU-APP/hooks/meta-leads` (assine `leadgen` na página; o token da página precisa de `leads_retrieval`)
- Qualquer formulário/CRM: `POST https://SEU-APP/hooks/lead?key=VENDAS_HOOK_KEY` com `{nome, telefone, email, campanha, cliente}`

**Regras embutidas:** só fala com quem tem consentimento (lead de formulário ou quem escreveu primeiro; listas do CRM exigem marcar a confirmação LGPD); "PARAR" encerra e bloqueia; avisa que é assistente virtual; não inventa preço; contato ativo só das 8h às 20h (Recife, sem domingo; configurável); fora das 24h do WhatsApp só template; no máximo 2 follow-ups; disparo em massa só depois de aprovação de um administrador e dentro do limite diário; quando um humano assume, Felipe só registra.

### Instagram Direct e Messenger (Facebook) no Felipe
- Webhook: `https://SEU-APP/hooks/meta-dm` (mesmo `WHATSAPP_VERIFY_TOKEN` e `WHATSAPP_APP_SECRET`). No app da Meta, produto **Messenger/Instagram**, assine os campos `messages` da Página (objeto *page*) e da conta do Instagram (objeto *instagram*).
- Usa `META_PAGE_ACCESS_TOKEN` (token da Página, com `pages_messaging` e `instagram_manage_messages`; em produção a Meta exige App Review dessas permissões).
- Regras da Meta: o Felipe só responde quem escreveu primeiro e em até 24h. Não existe DM ativo a frio. Quem comenta/clica num anúncio "Enviar mensagem" entra aqui.
- **LinkedIn:** a LinkedIn não oferece API aberta de mensagens (só para parceiros aprovados), e automatizar DM por fora viola os termos e leva a banimento. Leads de formulário do LinkedIn entram por `POST /hooks/lead` (via Zapier/CRM, `origem: "linkedin"`) e são abordados por WhatsApp.

Botão **🔗 Vincular Instagram/Facebook** (aba Vendas): assina a Página do `META_PAGE_ACCESS_TOKEN` para entregar as DMs ao app e mostra a Página e o @ do Instagram encontrados. Se `META_APP_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` e `PUBLIC_URL` (https) estiverem no Render, ele também cadastra o webhook `/hooks/meta-dm` no app (objetos page e instagram).
