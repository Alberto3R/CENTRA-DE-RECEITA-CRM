# Caminho A — vender a "Central de Receita" para empresas externas

**Marca do produto: Central de Receita** (CRM + Gestor Comercial). Posicionamento:
*"A Central de Receita Comercial da sua empresa — organiza, acompanha e faz a receita
crescer, num lugar só."* Glyph do logo: **CR**. Domínio livre (a registrar):
`centraldereceita.com.br` e `centraldereceita.com`.

> ⚠️ **Marca descritiva** → fraca como marca nominativa pura no INPI. Registrar a
> **marca mista** (nome + logo) e/ou um short-name. Falar com despachante.
>
> ⚠️ Nada aqui foi deployado. `main` faz deploy no push. Branch `feature/caminho-a`
> criada com estas mudanças (exceto os 2 arquivos que colidem com WIP — ver abaixo).
> Rode `pnpm build`/testes antes de mesclar.

## ✅ Feito

**Rebrand "Sales 3R" → "Central de Receita"** (o que o cliente vê): `layout.tsx`
(title/description), `icon.tsx` (glyph CR), `sidebar.tsx` (logo CR + wordmark),
telas de `login/signup/forgot-password` (glyph), `themes.ts` (nome do tema),
`email/client.ts` (remetente — domínio `sales3r.com.br` mantido, entregável hoje),
`invite-member-dialog.tsx`, `template-manager.tsx`, `whatsapp-config.tsx` (cópias),
`message-thread.tsx` ("IA da 3R" → "IA da Central").
> Mantido de propósito: **método "3R"** (Resultado/Rotina/Ritual) nos prompts de IA
> e `method-config.ts` — é a metodologia, não a marca. NÃO trocar.

**Enforcement de assentos** (`api/account/invitations` POST): bloqueia convite quando
(membros + convites pendentes) ≥ `plano.usuariosInclusos`. Teto rígido nos inclusos
(assento extra pago = Caminho B).

**Portal de billing** (`api/billing/portal`, novo): Stripe Billing Portal; só owner;
retorna `{ url }` pra ver fatura, trocar cartão, cancelar.

**Aba "Assinatura" no Settings** (`billing-settings.tsx` + wiring em `settings-sections.ts`
e `settings/page.tsx`): plano atual + uso de créditos (`GET /api/ai/creditos`), toggle
mensal/anual, botões **Assinar** (→ checkout) e **Gerenciar assinatura** (→ portal).
Owner-only. Typecheck limpo (`tsc --noEmit` exit 0).

**Banner de assinatura vencida** (`subscription-banner.tsx` no `dashboard-shell.tsx`):
aviso persistente no topo quando `accounts.subscription_status` ∈ (`past_due`,
`canceled`, `unpaid`, `incomplete`), com botão "Regularizar" → aba Assinatura (owner).
Não faz lockout — o tier free é legítimo e as features de IA já travam por crédito.

**Páginas legais LGPD** (rascunho): `/privacidade` e `/termos`. Preencher `[COLCHETES]`
(CNPJ, razão social, DPO, foro) e passar no jurídico.

## ✅ Código do Caminho A: COMPLETO

Todos os itens de código foram implementados (rebrand, assentos, portal, aba Assinatura,
banner de assinatura vencida, páginas legais). `tsc --noEmit` limpo. Falta só merge + tarefas humanas.

## 🔧 Pendências de merge (não-código)

### 2 arquivos de rebrand fora da branch (colidem com WIP)
`sidebar.tsx` (wordmark) e `template-manager.tsx` (cópia) têm o rebrand aplicado no
**working tree**, mas ficaram FORA do commit da branch porque têm WIP não commitado seu.
Incluir esses 2 hunks quando você commitar seu WIP.

## 👤 Tarefas humanas
- [ ] Registrar `centraldereceita.com.br` (+ `.com`) e apontar `NEXT_PUBLIC_SITE_URL`.
- [ ] Registro de marca no INPI (mista) — despachante.
- [ ] `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` na Vercel + endpoint do webhook no Stripe.
- [ ] Preencher/revisar `privacidade` e `termos` no jurídico; linkar no rodapé do signup.
- [ ] Tirar segredos do `CREDENCIAIS-CRM-SALES-3R.md` → Vercel/secret manager; girar `ENCRYPTION_KEY`.
- [ ] Verificar `centraldereceita.com.br` no Resend e trocar `EMAIL_FROM`.

## Fundação já pronta (não mexer)
Multi-tenancy por `account_id` (RLS em todas as tabelas); signup cria conta sozinho;
convites + papéis; checkout Stripe + webhook + quota de créditos de IA.
