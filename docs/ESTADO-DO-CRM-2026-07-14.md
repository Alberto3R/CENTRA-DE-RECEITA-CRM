# Estado do CRM — Central de Receita · 14/jul/2026

Documento-retrato de como o CRM está **hoje**: o que é, o que faz, quem usa,
o que mudou nesta rodada e o que ainda está pendente. Fonte: base de produção
(Supabase `uymmbqockiqcpporluxk`) + código (`Alberto3R/wacrm`, deploy Vercel).

> Substitui o retrato de 10/jul (`ESTADO-DO-CRM-2026-07-10.md`). Repositório local
> em `WACRM-HeadComercial/wacrm/` (mesmo repo remoto).

---

## 1. O que é

**Central de Receita** — CRM multi-marca de WhatsApp + **Gestor Comercial (IA)** +
suíte **Outbound/SDR** + **agente de IA que qualifica e marca a call sozinho**. Um ou
**vários** números de WhatsApp oficial (Cloud API) por marca, inbox compartilhado,
funil de vendas, disparos, automações, **ligação VoIP** e camada de IA para análise
comercial e agendamento. Fork evoluído do `wacrm`.

- **Stack:** Next.js 16 (App Router) · Supabase (Postgres + RLS + Realtime + Auth) ·
  deploy Vercel (auto-deploy no push da `main`). Domínios: `www.centraldereceita.com.br`
  (canônico) e `vendas.sales3r.com.br`.
- **Multi-tenancy:** cada **conta** (marca) é um tenant isolado por RLS. Fonte de
  verdade do acesso: `profiles.account_id` + `profiles.account_role`.
- **Idioma/tema:** PT-BR, marca Central de Receita (acento troca por conta), claro/escuro.

---

## 2. Marcas conectadas (snapshot de produção — 14/jul)

| Conta (tenant) | Canais | Contatos | Negócios | Modelos aprov. | Membros | SDRs | Agente IA on | Agenda Google |
|---|---|---|---|---|---|---|---|---|
| **SpectraX** | 1 | 228 | 88 | 13 | 3 | 1 | 0 | — |
| **AUGRA** | **2** | 138 | 140 | 28 | 2 | 0 | **2** | ✅ |
| **Elas que Vendem** | 1 | 64 | 58 | 41 | 3 | 0 | 1 | — |
| **Sales 3R** | 1 | 3 | 1 | 2 | 1 | 0 | 1 | — |
| **Lucas Vital** | 0 | 0 | 0 | 0 | 1 | 0 | 0 | — |

> **AUGRA** agora opera **2 canais**: **Principal** (11 9362, recrutamento) e
> **Outbound / Prospecção** (81 9516, número novo), cada um com seu **agente de IA**.
> **SpectraX** caiu de 4 → 3 membros (André e Enzo desligados). **Lucas Vital** é um
> **login novo** (sem conta operante ainda) — reflete o onboarding Stripe-first (§7).

---

## 3. Módulos / o que o CRM faz hoje

| Módulo | Estado | O que faz |
|---|---|---|
| **Conversas (Inbox)** | ✅ | Inbox WhatsApp compartilhado; texto/mídia/**modelos**; **gravar áudio** no compositor; respostas, reações, sessão de 24h; **botão de ligar** no header. Sidebar do contato mostra **negócios, tags, ligações, calls agendadas e notas**. |
| **Funis (Pipeline)** | ✅ | Kanban, drag-and-drop, filtros + **busca**; motivos de perda; no card: **Ligar + Iniciar conversa com modelo**; e-mail/telefone visíveis. |
| **Contatos** | ✅ | Base, tags, campos, notas, importação. |
| **Painel Outbound** | ✅ | KPIs de SDR (ligações, conversas c/ decisor★, reuniões, qualificados), forecast, **cadência editável**, fila "Próximos passos". |
| **Disparos (Broadcasts)** | ✅ | Envio em massa por modelo, **por canal**, agendável (worker pg_cron), com métricas. |
| **Automações** | ✅ (admin) | Gatilhos → ações (nova mensagem, palavra-chave, novo contato, 1ª msg). |
| **Fluxos (Flows)** | ✅ beta (admin) | Bots/menus interativos por botão/lista. |
| **Relatórios** | ✅ | Análises de funil, motivos de perda, atividade. |
| **Gestor Comercial (IA)** | ✅ (admin) | Analisar conversa (colar, **buscar no WhatsApp** com **áudios transcritos**, ou **ligação gravada**), analisar funil, avaliar time, criar materiais. **Régua closer×SDR por função** (§6). |
| **Agente de IA (atendimento + agendamento)** | ✅ | **1 agente por canal** com persona própria; responde o lead, qualifica e **marca a call sozinho** na Agenda Google (§5b). AUGRA roda 2 (recrutamento + prospecção). |
| **Ligações (VoIP)** | ✅ (admin) | Receber, **ligar (com aceite do lead)**, gravar, ouvir, transcrever e analisar. |
| **Configurações** | ✅ (admin) | Perfil, segurança, aparência, **Assinatura**, WhatsApp (canais), Modelos, Campos/Tags, Negócios/moeda, Agente IA, **Agenda (Google)**, Webhooks, **Membros**, Chaves de API. |
| **Assinatura (Billing)** | ✅ | Self-service via Stripe (portal, assentos, banner de pagamento pendente). |

---

## 4. Papéis e permissões

Duas dimensões independentes por usuário:

1. **Nível de acesso (RBAC):** `profiles.account_role` — **owner > admin > agent > viewer**.
   Agente (SDR) tem menu enxuto; Configurações/gestão ficam ocultas.
2. **Função comercial:** `profiles.funcao` (`closer | sdr | social_seller | gestor`) —
   distinta do RBAC; define a **régua de análise da IA** (§6). Capturada no convite e
   editável em **Membros**.

Escritas sensíveis protegidas por **RLS no banco**; o menu é a camada visual.

---

## 5. WhatsApp — conexão, modelos e ligação

- **Multi-canal + multi-agente:** a conta pode ter **vários números** (canais), cada um
  com seu **agente de IA** e **conjunto de templates**. Inbox/disparos/ligações separam
  por canal. Detalhes em `docs/MULTICANAL-MULTIAGENTE.md` (migrations 056–059).
- **Conexão:** número oficial na **Cloud API** (token de system user criptografado
  AES-256-GCM no `whatsapp_config`; webhook fan-out pro CRM). Auto-reconciliação do aviso
  "Não registrado" quando a Meta confirma `CONNECTED` + WABA inscrito.
- **Modelos:** criados/sincronizados do Meta; visíveis pra todos os papéis; enviáveis do
  inbox e do card; idioma em dropdown (padrão pt_BR); ajuda de variáveis.
- **Ligação (Calling API):** receber (WebRTC), **ligar com aceite do lead**, gravar →
  ouvir → transcrever → analisar no Gestor. Toda ligação vira atividade no Painel Outbound.

### 5b. Agendamento com Google Calendar — **NOVO** (feature de produto, multi-tenant)

O **agente de IA marca a call sozinho**, dentro da conversa do WhatsApp:

1. **Conecta a agenda** — Configurações → **Agenda (Google)**, OAuth por conta
   (`google_connections`, refresh token cifrado; RLS só service role). **Cada conta liga
   a própria agenda.**
2. **Escolhe a agenda de destino** — dropdown das agendas da conta (ou colar o ID de uma
   agenda dedicada, ex.: "Comercial"), salvo em `google_connections.calendar_id`.
3. **Regras por conta** (`scheduling_config`): fuso, duração (slot), buffer, dias/horário
   de atendimento, janela de oferta.
4. **Na conversa:** o agente chama `ver_horarios` (livre/ocupado via free/busy) e **oferece
   2-3 horários concretos**; ao lead escolher, pergunta o **e-mail** e chama `agendar_call`
   → cria o **evento com Google Meet**, adiciona o lead como convidado (**convite + lembrete**)
   e manda o link no WhatsApp.
5. **Aparece no CRM:** cada agendamento é gravado em `scheduled_calls` e mostrado na
   **sidebar da conversa** (data + link do Meet). Antes a call vivia só no Google.

- **Escopos Google:** `calendar.events` (sensível — criar evento) + `calendar.freebusy`
  (não sensível — livre/ocupado). **Verificação do app em curso** (justificativa + vídeo)
  pra tirar o aviso "app não verificado" e o teto de 100 usuários.
- Arquivos: `src/lib/google/{oauth,calendar}.ts`, rotas `/api/google/*` e
  `/api/scheduling/{config,calendar}`, `src/components/settings/agenda-panel.tsx`.
  Migrations **063** (google_connections + scheduling_config) e **064** (scheduled_calls).

---

## 6. Gestor Comercial (IA) — régua por função

- **Motor:** `analisarCall(texto, config, objetivo)` (Anthropic Sonnet); saída estruturada
  (dimensões, nota A/B/C, perda estimada, prescrições).
- **Régua por objetivo (por papel):** **closer** → régua 3R (fechar); **sdr** → régua de
  pré-vendas (qualificar + agendar), penaliza SDR que tenta fechar. Automática por quem
  atendeu (Ligações via `whatsapp_calls.user_id`; conversa via dono). Sem contexto → closer.
- **Transcrição:** **ElevenLabs Scribe** (PT-BR, diarização), sob demanda; cobre ligações
  **e** áudios do WhatsApp (cache em `messages.transcript`).
  - **Correção (jul):** os áudios da conversa vinham do Storage e o route tratava como proxy
    Meta → 400 e "[áudio não transcrito]" mesmo com o toast dizendo "transcritos". Agora
    `baixarAudio` escolhe a fonte pela URL e o toast mostra a contagem real.

---

## 7. Onboarding e acesso — Stripe-first (login ≠ conta)

- **Conta = produto pago.** `signup` cria **só um login** (`auth.users`, sem profile).
  A **conta nasce na compra** (webhook Stripe → `provision_account`) ou no **convite**
  (`redeem_invitation` cria o profile). Migration **061**.
- **Remoção de membro = remoção total** (migration **060**): apaga profile + vínculo, **sem
  conta pessoal de brinde**; a rota DELETE ainda **bane o login**. (André e Enzo removidos.)
- **Convite:** link de uso único com **nível de acesso** + **função comercial** + validade.
- **Página de vendas → checkout:** CTA do topo fala com vendas; demais botões abrem cadastro
  da empresa e **redirecionam pro checkout Stripe**.

---

## 8. Deploy & banco

- **Código:** `main` publicada na Vercel a cada push.
- **Migrations aplicadas até 064:**
  - até `059` — ver retrato de 10/jul (transcrição, worker de disparo, multi-canal/agente/templates).
  - `060_remove_member_no_new_account` (remoção total do membro),
    `061_stripe_first_onboarding` (login ≠ conta; `provision_account`),
    `062_rls_app_config` (RLS no `app_config` — segredo do cron),
    `063_google_calendar_scheduling` (`google_connections` + `scheduling_config`),
    `064_scheduled_calls` (registro das calls no CRM).

---

## 9. Pendências e riscos conhecidos

| Item | Situação |
|---|---|
| **Verificação do app Google** | Em curso (justificativa + vídeo de demo). Enquanto não aprovar: aviso "app não verificado" + teto de 100 usuários. Escopos: `calendar.events` (sensível) + `calendar.freebusy`. |
| **Página /privacidade × Google** | Precisa citar explicitamente o uso de **Google Calendar/Meet** (o revisor checa) — ajustar antes de enviar a verificação. |
| **Nome do número Outbound AUGRA (Meta)** | `name_status: PENDING_REVIEW` (número reciclado, ainda aparece como "GeriClass"). Não bloqueia envio; resolve na aprovação. |
| **Ligação PSTN (telefonia comum)** | Adiada — aguardando escolha de operadora BR/SIP. Hoje só a ligação VoIP da Meta. |
| **calls antigas não registradas** | `scheduled_calls` só grava a partir da migration 064; agendamentos de teste anteriores não aparecem no CRM (existem no Google). |
| **Marcar funções dos membros** | Membros sem `funcao` viram closer na análise; marcar os SDRs em Membros. |
| **Footgun de exclusão de conta** | `profiles.account_id` é `ON DELETE CASCADE`: excluir uma conta apaga os profiles dos membros. Trocar por comportamento seguro (migration à parte). |

---

## 10. Próximos passos sugeridos

1. **Google:** ajustar `/privacidade`, gravar o vídeo e enviar a verificação (publicar em produção).
2. **AUGRA:** acompanhar o A/B de prospecção (5 variações, 1 pra cada 2 leads) e reverificar o nome do número Outbound.
3. Marcar funções comerciais dos membros (SDR vs closer) em cada conta.
4. (Produto) Trocar o `ON DELETE CASCADE` de `profiles.account_id` por comportamento seguro.
5. (Produto) Avaliar ligação PSTN quando a operadora for definida.

---
*Gerado em 14/jul/2026. Snapshot de dados reflete a produção nesta data. Novidades desta rodada:
agendamento por IA na Agenda Google (marca a call + Meet + convite ao lead + call visível no CRM),
agente por canal em operação real (AUGRA, 2 números), onboarding Stripe-first, correção da
transcrição de áudio, RLS no app_config e toast repaginado.*
