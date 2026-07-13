# Multi-canal + Multi-agente — Central de Receita

Como o CRM suporta **vários números de WhatsApp por conta**, cada um com seu
próprio **agente de IA** e **conjunto de templates**. Ex.: um número de **SDR**
(agente que qualifica) e um de **Onboarding** (agente que acolhe), na mesma conta,
com inbox, disparos e ligações separando por número.

> Data: jul/2026. Migrations **056–059**. Aplicado e no ar; **retrocompatível**
> (com 1 número, tudo funciona igual — o número atual virou o canal "primário").

---

## 1. Conceito

- **Canal = um número de WhatsApp** (uma linha em `whatsapp_config`, com seu
  `phone_number_id`, `waba_id`, token, registro).
- A **conta** continua sendo o tenant (isolamento por RLS não muda). O **canal é
  uma dimensão _dentro_ da conta** — organização/roteamento, não fronteira de
  segurança.
- Todo canal tem um **primário** (`is_primary`) — usado como fallback de envio
  quando algo não tem canal explícito.

---

## 2. Modelo de dados

| Tabela | Coluna nova | Papel |
|---|---|---|
| `whatsapp_config` | `label`, `is_primary` | **É a tabela de canais.** Soltou `UNIQUE(account_id)`; mantém `UNIQUE(phone_number_id)`; índice único parcial garante 1 primário por conta. |
| `conversations` | `channel_id` | Em qual número a conversa acontece. Dedup de inbound = `(conta, contato, canal)`. |
| `broadcasts` | `channel_id` | De qual número o disparo sai. |
| `whatsapp_calls` | `channel_id` | Em qual número a ligação acontece. |
| `ai_agent_config` | `id` (PK nova), `channel_id`, `name` | **1 agente por canal** (era 1 por conta, PK `account_id`). |
| `message_templates` | `channel_id` | Cada canal tem seus templates (WABA própria). Unicidade = `(channel_id, name, language)`. |

**Migrations:** `056` (canais + conversas), `057` (agente por canal), `058`
(broadcasts + calls), `059` (templates por canal). Todas com **backfill pro canal
primário** e idempotentes.

---

## 3. Como o roteamento funciona

**Entrada (inbound):** o webhook da Meta já traz o `phone_number_id`. O CRM casa
esse id com a linha de `whatsapp_config` → daí sai `account_id` **e o canal**
(`config.id`). A conversa é amarrada a esse canal; o **agente do canal** responde.
_(Essa parte já era “multi-canal-ready” — o webhook sempre roteou por número.)_

**Saída (outbound):** o helper **`resolveChannelConfig(db, accountId, channelId?)`**
(`src/lib/whatsapp/channel.ts`) resolve o canal certo com fallback seguro:
1. o `channelId` dado (se for da conta);
2. senão, o **primário**;
3. senão, qualquer canal.

Toda resolução de `whatsapp_config` no envio passa por ele — resposta no inbox
sai pelo número da conversa; disparo/ligação, pelo número escolhido; flows,
automações, captação de leads, gateway e CAPI usam o primário.

> **Por que isso importou:** antes, ~16 pontos faziam `.eq('account_id').single()`
> — com 2 números isso **estouraria** (`.single()` com múltiplas linhas). O sweep
> pra `resolveChannelConfig` é o que torna o multi-canal seguro.

---

## 4. Superfícies de UI

- **Configurações → WhatsApp:** lista de canais (chips, ★ = primário),
  **"Adicionar canal"**, "Nome do canal", "Tornar primário", remover por canal.
- **Configurações → Agente IA:** barra de canais + **"Nome do agente"** — cada
  número tem sua persona/prompt/modelo/palavra de transferência.
- **Configurações → Modelos:** barra de canais; sincronizar/criar/editar operam na
  **WABA do canal selecionado**.
- **Inbox:** a resposta sai pelo número da conversa; o **picker de modelos** mostra
  só os templates daquele canal.
- **Disparos:** o **canal é escolhido no início** do assistente (os modelos são por
  canal); o disparo sai por ele.
- **Ligações:** registram de qual número saíram.

---

## 5. Como usar (passo a passo)

1. **Adicionar o 2º número:** Configurações → WhatsApp → **Adicionar canal** →
   preencha nome (ex.: "Onboarding") + credenciais da Meta **desse número** (o
   número precisa existir na sua conta da Meta — pré-requisito operacional).
2. **Templates do canal:** Configurações → Modelos → selecione o canal →
   **Sincronizar da Meta** (puxa os templates da WABA dele) ou crie novos.
3. **Agente do canal:** Configurações → Agente IA → selecione o canal → escreva a
   persona (SDR num, Onboarding noutro) → **Ativar**.
4. Pronto: mensagens que chegam em cada número abrem conversas separadas, o agente
   certo responde, e disparos/ligações escolhem de qual número saem.

---

## 6. Retrocompatibilidade e verificação

- Backfills conferidos: conversas **51/51**, agentes **3/3**, templates **87/87**
  amarrados ao canal primário; disparos/ligações idem.
- Com **1 canal**, o comportamento é idêntico ao anterior.
- **Verificação ao vivo** com 2 números reais ainda depende de conectar o 2º
  número na Meta.

---

## 7. Limitações conhecidas

- **Mídia de entrada e transcrição** de áudio usam o token do canal **primário**
  (MVP). Se o 2º número tiver **WABA diferente**, baixar mídia dele pode falhar —
  ideal seria resolver pelo canal da conversa (sub-melhoria).
- **Automações** enviam pelo canal **primário** (e mostram os templates dele). Não
  há, por ora, automação por canal.
- Se os dois números **compartilham a mesma WABA**, os templates aparecem
  duplicados (um conjunto por canal) — correto, mas redundante.

---

## 8. Mapa de arquivos (principais)

- Núcleo: `src/lib/whatsapp/channel.ts` (helper), `webhook/route.ts` (bind canal),
  `send/route.ts`, `react/route.ts`.
- Agente: `src/lib/ai-agent/handle.ts`, `api/ai-agent/config/route.ts`,
  `components/settings/ai-agent-settings.tsx`.
- Disparo/ligação: `lib/broadcast/worker.ts`, `api/whatsapp/broadcast/route.ts`,
  `api/whatsapp/call/route.ts`, wizard em `broadcasts/new` + `step1`/`step4`.
- Templates: `api/whatsapp/templates/{sync,submit,[id]}`,
  `components/settings/template-manager.tsx`, `inbox/template-picker.tsx`.
- Config de canais: `api/whatsapp/config/route.ts`,
  `components/settings/whatsapp-config.tsx`.
- Sweep channel-safe: `flows/meta-send.ts`, `automations/meta-send.ts`,
  `notifications/lead-alert.ts`, `api/leads`, `webhooks/gateway/[token]`,
  `conversions/capi.ts`, `whatsapp/media/[mediaId]`, `ai/conversa-transcricao`.

---
*Documento técnico — Multi-canal + Multi-agente, jul/2026.*
