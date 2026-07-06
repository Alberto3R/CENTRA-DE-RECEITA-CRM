# Fusão HEAD comercIAl → WACRM — Handoff de implementação

> Estado: **código escrito (typecheck limpo, testes passando) E migrations
> 001–041 APLICADAS** no projeto Supabase head-comercial (`wnxyvjxfvsatmxpyhdkf`)
> via MCP, com advisors de segurança verificados (sem RLS faltando nas tabelas
> novas). Falta só configurar os segredos de app (Anthropic/Stripe/Resend) e
> apontar o deploy para este projeto.

## ✅ Migrations aplicadas (head-comercial)

Aplicadas em ordem via MCP: base 001–034 (schema CRM completo do WACRM, com
`accounts`/`is_account_member`/RLS por conta) + AI 035–041 (sellers, ai_documents,
ai_analyses, ai_scripts, ai_objections+pgvector, **ai_pdis**, account_sales_config,
**ai_usage_events**, usage_counters, subscriptions). Verificação: 14/14 tabelas do
produto unificado presentes; `account_sales_config` backfillada (preset 3R por
conta); pgvector ok; advisors sem RLS-missing nas tabelas novas.

### `.env` do app (apontar para o head-comercial)
```bash
NEXT_PUBLIC_SUPABASE_URL=https://wnxyvjxfvsatmxpyhdkf.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_UhHtxMIwuAqUAJ9NtgKadQ_LnCEgw8v
# SUPABASE_SERVICE_ROLE_KEY — pegue em Project Settings → API (secreto, não commitar)
```

## ✅ Opção B escolhida — backend único = projeto `head-comercial`

Destino: projeto Supabase **head-comercial** (`wnxyvjxfvsatmxpyhdkf`, sa-east-1).
Ele será o backend único do produto unificado (CRM + IA).

**Verificação de segurança (read-only, já feita):** o head-comercial **não tem**
`handle_new_user`, `is_account_member`, nem trigger em `auth.users`, e **não tem**
nenhuma tabela base do WACRM (`accounts`, `profiles`, `conversations`…). Logo,
aplicar o schema base do WACRM lá é **aditivo e não quebra** o app HEAD que está no
ar (não sobrescreve função/trigger de auth).

**Colisões resolvidas:** o head-comercial já tem `pdis` e `usage_events` (legado do
HEAD). As tabelas novas foram renomeadas para **`ai_pdis`** (migration 038) e
**`ai_usage_events`** (migration 040) — schema IA fica 100% livre de colisão.

### Como aplicar (à ordem; idempotente — usa IF NOT EXISTS)

O schema base é grande (34 migrations). Para aplicar nos **arquivos exatos** (sem
risco de transcrição), use UMA destas vias no projeto `head-comercial`:

- **Via A — Supabase Studio (sem CLI):** abra o SQL Editor do projeto head-comercial
  e cole/rode, NESTA ORDEM, os bundles de `supabase/_bundles/`:
  `base1.sql → base2.sql → base3.sql → base4.sql → ai_unified.sql`.
- **Via B — CLI:** `supabase link --project-ref wnxyvjxfvsatmxpyhdkf` (pede o
  access token + senha do banco) e depois `supabase db push` (aplica 001–041 da
  pasta `supabase/migrations/` em ordem). O `supabase/config.toml` já aponta para o ref.

> Os bundles em `supabase/_bundles/` são só a concatenação ordenada das migrations
> (base1=001–009, base2=010–018, base3=019–027, base4=028–034, ai_unified=035–041),
> para colar de uma vez. A fonte de verdade continua sendo `supabase/migrations/`.

---

## O que já foi implementado (nesta sessão)

Tudo no codebase do WACRM (`Projects/SALES 3R Performance Comercial/wacrm/`).

### Fundação de IA (`src/lib/ai/`)
- `anthropic.ts` — client SDK + model IDs (Sonnet 4-6 / Haiku 4.5). Portado do HEAD.
- `custo.ts` — custo USD por chamada (telemetria/fair use).
- `transcricao-extractor.ts` — parser .txt/.vtt → texto normalizado.
- `validar-insumo.ts` — triagem barata (Haiku) antes do Sonnet.
- `method-config.ts` + `config.ts` — **método configurável por conta** (preset 3R
  de fábrica; mercado aberto). `customizado:false` ⇒ usa o 3R verbatim (zero regressão).
- `prompts/analise-call-v1.ts` — prompt parametrizado (`buildSystemPrompt`/`buildAnaliseTool`).
- `analise-call.ts` — engine (tool_use forçado + zod montado das dimensões da conta).
- `store.ts` — persistência escopada por `account_id` (via service role).

### Camada SaaS / billing (`src/lib/billing/`)
- `plans.ts` — catálogo free/pro/enterprise + limites.
- `quota.ts` — `assertQuota` (gating, 403 com upsell) + `consumir` (contador mensal).
- `stripe.ts` — client.
- `src/lib/email/client.ts` — Resend (avisos de quota, boas-vindas) — no-op sem key.

### Rotas de API (`src/app/api/`)
- `ai/analise-call` (POST analisa, GET lista) — padrão requireRole→assertQuota→engine→store→consumir.
- `ai/whatsapp` (POST) — **analisa uma conversa real do CRM** (lê `messages`), o ganho central da fusão.
- `billing/checkout` (POST, owner) e `billing/webhook` (POST, Stripe→accounts.plan).

### UI e navegação
- `src/app/(dashboard)/ia/analise/page.tsx` — tela de análise de call.
- `src/components/layout/sidebar.tsx` — item "Análise IA" (beta).

### Banco (`supabase/migrations/`)
- `035_ai_sellers.sql` — pgvector + `sellers`.
- `036_ai_documents_analyses.sql` — `ai_documents` + `ai_analyses` + bucket `ai-insumos`.
- `037_ai_cria.sql` — `ai_scripts` + `ai_objections` (pgvector) + `ai_campaigns`.
- `038_ai_pdis.sql` — `pdis`.
- `039_account_sales_config.sql` — config de método + seed/trigger + backfill.
- `040_ai_usage.sql` — `usage_events` + `usage_counters` + RPC `increment_usage_counter`.
- `041_billing.sql` — `accounts.plan`/stripe + `subscriptions`.

### Qualidade
- `scripts/golden-set/eval-call.mjs` + README — gate de eval (`npm run eval -- arquivo.txt`).
- Testes: `src/lib/billing/plans.test.ts`, `src/lib/ai/method-config.test.ts` (8 testes, verdes).
- **Typecheck limpo; 475 testes passam** (as 2 falhas em `dashboard/date-utils.test.ts`
  são pré-existentes e dependem do fuso da máquina — não têm relação com esta fusão).

---

## 🔑 Credenciais / segredos a fornecer

Adicionar ao `.env.local` (e às env vars do deploy):

```bash
# IA (obrigatório para os módulos de análise)
ANTHROPIC_API_KEY=sk-ant-...

# Stripe (obrigatório para cobrança)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...          # do endpoint do webhook (ver abaixo)
STRIPE_PRICE_PRO=price_...               # Price ID do plano Pro (assinatura mensal)
STRIPE_PRICE_ENTERPRISE=price_...        # Price ID do plano Enterprise

# E-mail transacional (opcional — sem isto, avisos viram no-op logado)
RESEND_API_KEY=re_...
EMAIL_FROM="Sales 3R <no-reply@seu-dominio.com.br>"

# Se trocar de projeto Supabase (Opção B), atualizar também:
# NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
```

Stripe: criar 2 Products/Prices (Pro, Enterprise, recorrência mensal) e um Webhook
apontando para `https://SEU_DOMINIO/api/billing/webhook` com os eventos
`checkout.session.completed`, `customer.subscription.updated`,
`customer.subscription.deleted` — o `whsec_...` desse endpoint vira `STRIPE_WEBHOOK_SECRET`.

---

## Passos para colocar no ar

1. **Confirmar Opção A ou B** (projeto Supabase de destino).
2. `npm install` (deps novas já estão no `package.json`: `@anthropic-ai/sdk`,
   `stripe`, `resend`, `zod`).
3. **Aplicar migrations** no projeto escolhido, em ordem `035 → 041` (via Supabase
   CLI `supabase db push`, ou aplicando cada arquivo). Na Opção B, aplicar `001–034`
   antes.
4. Configurar os segredos acima.
5. `npm run build` e deploy (Vercel).
6. **Rodar `get_advisors`** (Supabase) e checar que não há alerta de RLS nas tabelas
   novas.

## Verificação (após deploy)
- `npm run typecheck` → limpo. `npm run test` → verde (exceto as 2 de date-utils, pré-existentes).
- `ANTHROPIC_API_KEY=... npm run eval -- scripts/golden-set/samples/sua-call.txt` → **eval verde**.
- Logado numa conta, abrir **/ia/analise**, colar uma transcrição → análise persiste
  em `ai_analyses` isolada por `account_id`.
- `POST /api/ai/whatsapp { conversationId }` numa conversa existente → análise da conversa real.
- Checkout Stripe (test mode) → webhook atualiza `accounts.plan`; estourar o limite
  do free → `assertQuota` devolve 403 com mensagem de upsell.

---

## Deploy (Vercel)

O produto unificado tem **projeto Vercel PRÓPRIO**, separado do `sales-3r-crm`
(que NÃO foi tocado — produção, env e repo intactos; previews de teste removidos).

- **Projeto:** `crm-gestor-comercial` (team `sales3r`, id `prj_qYbtSOmTt8W76knk1LDoCQbyYdjY`).
- ✅ **Produção LIVE e pública** — aponta para o Supabase **head-comercial**.
  - **URL:** `https://crm-gestor-comercial.vercel.app` (e `…-sales3r.vercel.app`).
  - `/login` → 200; `/` → 307 → `/dashboard` → 307 → `/login` (auth ok).
  - **Deployment Protection: DESLIGADA** (autorizado pelo dono) — app público,
    protegido pelo próprio login (Supabase Auth + RLS).
  - ⚠️ **Causa do 404 inicial:** o projeto foi criado "pelado" (`vercel project add`)
    sem preset de framework → `framework: null` → edge dava 404 em tudo. Corrigido
    via API (`framework: "nextjs"`) + redeploy. Lição: criar projeto novo já com o
    preset, ou linkar com `vercel link` num dir Next detectável.
- Env no projeto (escopo Production), todas configuradas: `NEXT_PUBLIC_SUPABASE_URL`
  + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (head-comercial), `SUPABASE_SERVICE_ROLE_KEY`
  (chave `sb_secret_…` do head-comercial), `ANTHROPIC_API_KEY` (validada).
- **Admin de teste:** `adm@sales3r.com.br` (owner de uma conta no head-comercial, com
  account_sales_config preset 3R; senha entregue ao dono fora do repo).
- ⚠️ O site está sob **Deployment Protection (SSO do time Vercel)** — só quem está no
  time `sales3r` acessa. Para abrir a clientes externos, desligar a proteção em
  Project → Settings → Deployment Protection (ou ligar só para Preview).
- Falta para billing: `STRIPE_SECRET_KEY/WEBHOOK_SECRET/PRICE_*`.
- O working copy local (`.vercel/project.json`) agora aponta para este projeto novo.
  ⚠️ O git remoto desta pasta ainda é `Alberto3R/wacrm` (repo do sales-3r-crm) — **NÃO dar
  `git push` daqui** sem antes apontar para um repo próprio do produto unificado, senão
  o código cai no sales-3r-crm. (Link antigo salvo em `/tmp/sales3r-vercel-link.bak.json`.)

### Para ligar IA + gravações server-side (e billing)
Adicionar no projeto `crm-gestor-comercial` (Settings → Environment Variables, escopo
Production) e rodar `vercel deploy --prod`:
```
SUPABASE_SERVICE_ROLE_KEY=<service-role do head-comercial — SECRETO>   # AI store, webhooks, automações
ANTHROPIC_API_KEY=<sk-ant-…>                                          # liga toda a IA
STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / STRIPE_PRICE_PRO / STRIPE_PRICE_ENTERPRISE
ENCRYPTION_KEY / META_APP_SECRET                                      # WhatsApp (se for usar o CRM)
RESEND_API_KEY=<opcional>
```
Estado atual: **a UI sobe e login/leituras (RLS) batem no head-comercial; IA e
gravações server-side aguardam `SUPABASE_SERVICE_ROLE_KEY` + `ANTHROPIC_API_KEY`.**

## Módulos de IA portados (todas as 11 capacidades)
Telas na sidebar (grupo IA, beta): **Análise IA** (`/ia/analise`), **Criar IA**
(`/ia/criar` — scripts, contragolpe, follow-up, campanhas), **Funil IA**
(`/ia/funil` — pauta do funil + raio-x, lendo `deals`/`pipelines` reais), **Time IA**
(`/ia/time` — sellers, PDI rascunho, coaching). APIs em `src/app/api/ai/*`
(analise-call, whatsapp, scripts, contragolpe, followup, campanhas, pauta-funil,
raio-x, sellers, pdi, coaching). Engines/prompts em `src/lib/ai/*`. Método
configurável por conta (default 3R); quota por plano em toda rota (analise/geracao).
Typecheck limpo; testes verdes (exceto as 2 pré-existentes de date-utils, por fuso).

## Follow-ups (ainda não implementados)
- **Onboarding wizard** + tela de Settings para editar `account_sales_config` (método/tom/dimensões/ICP/produto/oferta).
- **UI do módulo WhatsApp**: botão "Analisar com IA" dentro do inbox (a API `/api/ai/whatsapp` já existe).
- **Vincular análise a seller na UI** (o campo `seller_id` já existe; falta o seletor nas telas de análise) — necessário para alimentar o coaching.
- **Embedding do contragolpe** (pgvector): hoje grava a objeção; falta calcular/buscar similares.
- **Dashboard de uso/custo** (lê `ai_usage_events`) e e-mails de billing/quota ligados aos fluxos.
- **Rate-limit por plano**: trocar `RATE_LIMITS.publicApi` flat por lookup do plano.
- **Cutover**: desligar o app HEAD e redirecionar para o produto único.
```
