# Rodada 31/jul/2026 — Histórico vivo do negócio + robustez do WhatsApp

O que mudou nesta rodada, por quê e onde. Complementa o retrato geral
(`ESTADO-DO-CRM-2026-07-27.md`). Fonte: código (`Alberto3R/wacrm`, deploy Vercel
no push da `main`) + base de produção (Supabase `uymmbqockiqcpporluxk`).

---

## 1. Histórico vivo do negócio (`deal_events`)

**O quê:** aba **Histórico** no detalhe do negócio (drawer) que se **autoalimenta**
das ações do dia a dia — criação, mudança de etapa, troca de responsável, status
(ganho/perdido/reaberto) e valor. Cada evento com **data-hora + autor**.

**Como:**
- **Migration `081_deal_events.sql`** — tabela `public.deal_events` + trigger
  `log_deal_event` em `deals` (AFTER INSERT/UPDATE, `SECURITY DEFINER`, dentro de
  bloco `EXCEPTION` = best-effort, **nunca bloqueia** a escrita do negócio) +
  backfill (`created` de todos os deals na data real + mudanças de etapa via
  `deal_stage_events`).
- **Autor** capturado por `auth.uid()` — ação de service_role/automação fica como
  "ação automática do sistema".
- **`created_via_integration`**: os webhooks de captação (`/api/leads/[token]`) e de
  gateway (`/api/webhooks/gateway/[token]`, Voomp/Hotmart) enriquecem o evento de
  criação com **origem, UTMs, página e o payload** ("Mostrar dados"); o move de etapa
  automático do gateway leva o rótulo "via {provedor}".
- **UI:** `src/components/pipelines/deal-history.tsx` (timeline) + abas Dados/Histórico
  em `deal-form.tsx`.

**Regra p/ leitura:** RLS por `is_account_member(account_id)`; escrita só via trigger
(security definer) / service role. Vale para **todas as contas**.

---

## 2. App Secret por canal (fim do `META_APP_SECRET` por cliente)

**Problema:** o webhook valida a assinatura HMAC contra o env global
`META_APP_SECRET` e é **fail-closed**. Cada cliente costuma ter o App Meta dele
(App Secret diferente) → conectar canal novo exigia **editar env + redeploy**, e
esquecer disso deixava o canal "conectado" **mudo**.

**Correção (migration `082_whatsapp_config_app_secret.sql`):**
- Coluna `whatsapp_config.app_secret` (criptografada GCM, igual ao `access_token`).
- O webhook (`/api/whatsapp/webhook`) resolve o canal pelo `phone_number_id` do
  payload e valida a assinatura pelo **segredo daquele canal**; `META_APP_SECRET`
  vira **fallback** (não é mais obrigatório).
- Campo **App Secret** na tela Configurações → WhatsApp (criptografado; vazio = preserva).

**Impacto:** onboarding **self-service** (cliente cola o App Secret na tela, sem env
nem deploy). Contas antigas seguem pelo fallback do env — nada quebra. Backfill de
conta existente = re-salvar o canal com o App Secret na UI.

---

## 3. Registro na Cloud API é obrigatório para enviar (erro #133010)

**Sintoma:** número **verificado** conecta, mas o primeiro envio falha com
`(#133010) Account not registered`. Causa: o passo `/register` (Cloud API) é
**pulado quando não há PIN** na conexão — verificar ≠ registrar.

**Como resolver:** informar o **PIN de verificação em duas etapas** do número em
Configurações → WhatsApp e Salvar (a rota chama `registerPhoneNumber`), ou registrar
via Graph `POST /{phone_number_id}/register`. Depois o número fica
`status: CONNECTED`, `platform_type: CLOUD_API`.

**Melhoria de UX (PR #4):** o Alert de status em Configurações → WhatsApp, quando o
número está conectado mas **não registrado**, agora avisa explicitamente que **os
envios falham com #133010** e explica o passo pra registrar.

> Para receber (inbound) também é preciso: o **App inscrito no WABA**
> (`subscribed_apps`) **e** o **webhook do App configurado** na Meta
> (`POST /{app-id}/subscriptions`, `object=whatsapp_business_account`,
> `fields=messages`, callback = `…/api/whatsapp/webhook`, com o `verify_token` do canal).

---

## 4. Robustez do webhook/envio (PR #5)

- **Resposta de botão de template (`type=button`):** ao tocar num botão de resposta
  rápida de um template, a Meta manda `type:"button"` (≠ `interactive`). Antes caía em
  `[Unsupported message type: button]`. Agora o `case 'button'` (em
  `whatsapp/webhook/route.ts`) renderiza o rótulo como texto e guarda o `payload` em
  `interactive_reply_id` (fluxos/auto-advance conseguem rotear).
- **`verify_token` preservado no save vazio:** a rota `/api/whatsapp/config` gravava
  `verify_token` sempre — salvar o canal com o campo vazio **zerava o token** e
  **quebrava o recebimento** (Meta rejeita a verificação do webhook). Agora só grava
  quando enviado (vazio = preserva), igual ao `app_secret`.
- **Dicas amigáveis nos erros da Meta:** `throwMetaError` (ponto único de todo envio)
  anexa uma explicação em PT-BR por código — #133010 (registrar o número), 131047
  (janela 24h → template), 190 (token inválido → reconectar), 132000 (params do
  template) etc.

---

## Referências

| Item | Migration | PR | Arquivos-chave |
|---|---|---|---|
| Histórico do negócio | `081_deal_events` | #2 | `deal-history.tsx`, `deal-form.tsx`, `api/leads/[token]`, `api/webhooks/gateway/[token]` |
| App Secret por canal | `082_whatsapp_config_app_secret` | #3 | `webhook-signature.ts`, `whatsapp/webhook/route.ts`, `whatsapp/config/route.ts`, `whatsapp-config.tsx` |
| Aviso "não registrado" (#133010) | — | #4 | `whatsapp-config.tsx` |
| Botão + verify_token + dicas de erro | — | #5 | `whatsapp/webhook/route.ts`, `whatsapp/config/route.ts`, `meta-api.ts` |
