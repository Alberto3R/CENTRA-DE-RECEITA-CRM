# Estado do CRM — 27/jul/2026 (novidade: Ligação PSTN via Telnyx)

> Complementa o snapshot de [14/jul](./ESTADO-DO-CRM-2026-07-14.md). Aqui só o
> que mudou/entrou desde então. O headline da rodada é a **ligação direta ao
> telefone do lead (PSTN)** — antes o CRM só ligava pela VoIP do WhatsApp/Meta.

---

## 1. Ligação PSTN (Telnyx) — **NOVO, no ar**

Agora o SDR liga **direto pro telefone comum do lead** (celular/fixo), falando
**pelo navegador** (softphone WebRTC), com **caller ID próprio**, **gravação**,
**transcrição** e **análise no Gestor**. Separada e complementar à ligação VoIP
do WhatsApp (que continua igual).

### Como funciona (Modelo A — softphone WebRTC)
1. SDR clica **"Ligar (telefone)"** (botão verde, ao lado do de WhatsApp/azul)
   no inbox e no card do negócio.
2. Backend registra a chamada e gera um **token JWT** curto; o SDK
   `@telnyx/webrtc` loga e disca. Mídia ponta-a-ponta navegador↔Telnyx.
3. **Normalização do 9º dígito**: número do contato sem o 9 do celular é
   corrigido automaticamente (senão a Telnyx recusa com "CALL DOES NOT EXIST").
4. **Registro pelo cliente** (a connection WebRTC não dispara webhook de Call
   Control): o softphone reporta atendeu/encerrou + duração → `telnyx_calls`
   → **atividade "call" no Painel Outbound** (dedup no servidor).
5. **Gravação client-side**: grava mic do SDR + áudio do lead no navegador →
   sobe pro Storage `call-recordings` → `recording_path`.
6. Tela **Ligações** (`/ligacoes`, admin) mescla WhatsApp + Telefone: **player**,
   **Analisar** (transcreve via ElevenLabs → Gestor em `/ia/analise`), selo de
   canal (Telefone verde / WhatsApp azul).

### Infra Telnyx (conta nível Verified)
- Número **+55 62 3602 9411** (Goiânia, DDD 62, fixo) — DDD 61 não tinha estoque.
- Outbound Voice Profile (só BR, teto US$ 20/dia) + Credential Connection WebRTC
  + Telephony Credential. IDs/keys no doc de credenciais (fora do repo).
- **Custo real confirmado (CDR):** celular BR **US$ 0,015/min** (~R$ 0,08),
  cobrança mínima 60s. All-in com perna WebRTC + gravação ≈ US$ 0,019/min
  (~R$ 0,10). Número: US$ 3/mês fixo.

### Código
- Migrations **075** (`telnyx_calls`) + **076** (`recording_path`).
- `src/lib/telnyx/{calling,webhook}.ts`, `src/app/api/telnyx/{token,webhook,call,call/[id]/recording,call/[id]/transcribe}`, `src/hooks/use-telnyx-call.ts`, `src/components/telnyx/telnyx-call-button.tsx`, tela `/ligacoes` estendida.
- Envs `TELNYX_*` (5) na Vercel `sales-3r-crm`.

---

## 2. Pendências e riscos

| Item | Situação |
|---|---|
| **Multi-tenant da ligação PSTN** | ⚠️ **Bloqueia venda pra clientes.** Hoje número/connection/credential vêm de ENV globais → **toda conta ligaria pelo número da 3R** e a cobrança cairia na conta Telnyx da 3R. Ok pra 3R usar internamente; **antes de liberar pra clientes** precisa da camada `telnyx_config` por conta (espelhar `whatsapp_config`) — cada cliente com número próprio. Modelo recomendado: **Managed Accounts** do Telnyx (3R revende com margem). |
| Gravação — 1º teste ponta-a-ponta | Validar em produção (captura + upload + player + análise). |
| Deploy git→Vercel | Auto-deploy intermitente em pushes rápidos em sequência (fila da Vercel). Espaçar push, ou `vercel --prod` pela CLI. |
| CSP (`next.config.ts`) | `Report-Only` (não bloqueia); considerar allowlist Telnyx pra tirar o ruído do console. |

---
*Gerado 27/jul/2026. Ligação PSTN discando + registrando + gravando +
transcrevendo + analisando. Falta o multi-tenant antes de vender pra clientes.*
