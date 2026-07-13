# Estado do CRM — Central de Receita · 10/jul/2026

Documento-retrato de como o CRM está **hoje**: o que é, o que faz, quem usa,
o que mudou nesta rodada e o que ainda está pendente. Fonte: base de produção
(Supabase `uymmbqockiqcpporluxk`) + código (`Alberto3R/wacrm`, deploy Vercel).

> Repositório local agora em `WACRM-HeadComercial/wacrm/` (mesmo repo remoto).

---

## 1. O que é

**Central de Receita** — CRM multi-marca de WhatsApp + **Gestor Comercial (IA)** +
suíte **Outbound/SDR**. Um número de WhatsApp oficial (Cloud API) por marca,
inbox compartilhado, funil de vendas, disparos, automações, **ligação VoIP** e
camada de IA para análise comercial. Fork evoluído do `wacrm`.

- **Stack:** Next.js 16 (App Router) · Supabase (Postgres + RLS + Realtime + Auth) ·
  deploy Vercel (auto-deploy no push da `main`).
- **Multi-tenancy:** cada **conta** (marca) é um tenant isolado por RLS. Fonte de
  verdade do acesso: `profiles.account_id` + `profiles.account_role`.
- **Idioma/tema:** PT-BR, tema escuro, marca Central de Receita (acento esmeralda,
  símbolo sino). Paleta troca por conta (marca ativa).

---

## 2. Marcas conectadas (snapshot de produção — 10/jul)

| Conta (tenant) | Plano | WhatsApp | Contatos | Negócios | Modelos aprov. | Membros | SDRs |
|---|---|---|---|---|---|---|---|
| **SpectraX** | enterprise | ✅ | 228 | 88 | 9 | 4 | 2 |
| **Elas que Vendem** | enterprise | ✅ | 60 | 54 | 36 | 4 | 0 |
| **AUGRA** | enterprise | ✅ | 1 | 3 | 28 | 1 | 0 |
| **Sales 3R** | enterprise | ✅ | 1 | 0 | 2 | 1 | 0 |

> A conta que opera a SpectraX **já foi renomeada** de "Alberto Oliveira" para
> **"SpectraX"**. Todas as 4 marcas com WhatsApp oficial conectado.

---

## 3. Módulos / o que o CRM faz hoje

| Módulo | Estado | O que faz |
|---|---|---|
| **Conversas (Inbox)** | ✅ | Inbox WhatsApp compartilhado; texto/mídia/**modelos**; **gravar áudio** no compositor (mic na cor do tema); respostas, reações, sessão de 24h; **botão de ligar** no header (sem sobreposição — container queries). |
| **Funis (Pipeline)** | ✅ | Kanban, drag-and-drop, filtros (data/responsável/tag) + **busca por nome/e-mail/telefone/título**; motivos de perda editáveis; no card: **Ligar + Iniciar conversa com modelo**; ao abrir o card, **e-mail e telefone do contato** visíveis. |
| **Contatos** | ✅ | Base de contatos, tags, campos, notas, importação. |
| **Painel Outbound** | ✅ | KPIs de SDR (ligações, atendimentos, conversas c/ decisor★, WhatsApp, reuniões, qualificados), forecast do mês, **cadência editável** e fila "Próximos passos". |
| **Disparos (Broadcasts)** | ✅ | Envio em massa por modelo, com métricas de entrega/leitura/resposta. |
| **Automações** | ✅ (admin) | Gatilhos → ações (nova mensagem, palavra-chave, novo contato, 1ª msg). |
| **Fluxos (Flows)** | ✅ beta (admin) | Bots/menus interativos por botão/lista. |
| **Relatórios** | ✅ | Análises de funil, motivos de perda, atividade. |
| **Gestor Comercial (IA)** | ✅ (admin) | Analisar conversa (colar, **buscar no WhatsApp** com **áudios transcritos**, ou **analisar ligação gravada**), analisar funil, avaliar time, criar materiais. **Régua closer×SDR por função** (§6). |
| **Ligações** | ✅ (admin) | Página central de histórico de chamadas: ouvir gravação + **Analisar** (transcreve → Gestor). |
| **Configurações** | ✅ (admin) | Perfil, segurança, aparência, **Assinatura**, WhatsApp, Modelos, Campos/Tags, Negócios/moeda, Agente IA, Webhooks, **Membros**, Chaves de API. |
| **Assinatura (Billing)** | ✅ | Self-service via Stripe (portal, assentos por plano, banner de pagamento pendente). |
| **Ligação WhatsApp (VoIP)** | ✅ | Ver §5. Receber, **ligar (com aceite do lead)**, gravar, ouvir, transcrever e analisar. |

---

## 4. Papéis e permissões

Duas dimensões independentes por usuário:

1. **Nível de acesso (RBAC):** `profiles.account_role` — **owner > admin > agent > viewer**.
   - **Owner/Admin:** tudo, incluindo Automações, Fluxos, Gestor, Ligações e Configurações.
   - **Agent (SDR):** Painel, Conversas, Contatos, Funis, Painel Outbound, Relatórios,
     Disparos. **Não** vê Automações, Fluxos, Gestor, Ligações nem Configurações (só
     Perfil/Segurança/Aparência).
   - **Viewer:** somente leitura.
2. **Função comercial:** `profiles.funcao` (`closer | sdr | social_seller | gestor`) —
   **novo**. Distinta do RBAC; define a **régua de análise da IA** (§6). Capturada no
   convite (seletor "Função comercial") e editável na aba **Membros**.

Escritas sensíveis são protegidas por **RLS no banco**; o menu é a camada visual.

---

## 5. WhatsApp — conexão, modelos e ligação

- **Multi-canal + multi-agente (novo):** a conta pode ter **vários números** de
  WhatsApp, cada um um "canal" com seu próprio **agente de IA** e **conjunto de
  templates** (ex.: SDR num número, Onboarding noutro). Inbox/disparos/ligações
  separam por canal. Detalhes em `docs/MULTICANAL-MULTIAGENTE.md` (migrations 056–059).
- **Conexão:** cada marca tem número oficial na **Cloud API** (token de system user
  criptografado AES-256-GCM no `whatsapp_config`; webhook fan-out pro CRM).
- **Aviso "Não registrado" — resolvido:** números conectados reaproveitando token
  ficavam com `registered_at` nulo e mostravam o falso alarme, mesmo entregando eventos.
  Agora o app **auto-reconcilia** (ao abrir Configurações → WhatsApp ou no "Verificar
  com a Meta") quando a Meta confirma o número `CONNECTED` + WABA inscrito.
- **Modelos (templates):** criados/sincronizados do Meta; visíveis para todos os papéis
  da conta; enviáveis do inbox e do card. **Idioma agora é dropdown (padrão pt_BR)** e o
  cadastro de **variáveis** tem ajuda explicando placeholders + valores de exemplo.
- **Ligação (Calling API):**
  - **Receber:** ✅ card "Chamada recebida" toca em qualquer tela → atende (WebRTC).
  - **Ligar pro lead:** ✅ **liberado, desde que o lead autorize receber ligação**
    (permissão de call da Meta); botão no inbox/card.
  - **Gravação → ouvir → transcrever → analisar:** ✅ a chamada é gravada (Storage
    `call-recordings`), tem player, transcrição sob demanda e análise no Gestor.
  - `callback_permission` ativo; toda ligação encerrada vira **atividade "call"** no
    Painel Outbound.
  - Mídia WebRTC no navegador; **sem ferramenta externa paga**.

---

## 6. Gestor Comercial (IA) — régua por função

- **Motor:** `analisarCall(texto, config, objetivo)` (Anthropic Sonnet); saída
  estruturada com dimensões, nota A/B/C, perda estimada e prescrições.
- **Régua por objetivo (decisão: "pelo papel do vendedor"):**
  - **closer** → régua 3R (fechar na conversa) — inalterada.
  - **sdr** → régua de pré-vendas (qualificar + agendar): 6 dimensões próprias
    (abertura/enquadramento, qualificação/fit, descoberta de dor, geração de interesse,
    agendamento, compromisso/anti no-show); penaliza SDR que tenta fechar.
  - A régua é **automática por quem atendeu**: Ligações derivam de `whatsapp_calls.user_id`;
    análise de conversa do CRM, do atendente/dono da conversa. Na página "Analisar conversa"
    (texto colado) há seletor manual de vendedor. Sem contexto → closer.
- **Transcrição:** provedor **ElevenLabs Scribe** (assinatura já existente), PT-BR com
  diarização. Cobre gravações de ligação **e** áudios (mensagens de voz) do WhatsApp na
  análise de conversa (antes os áudios eram descartados); cache em `messages.transcript`.

---

## 7. Onboarding e acesso

- **Modelo só convite + compra:** removida a criação avulsa de conta na maioria dos
  pontos (inclusive o botão "Começar" da página de vendas).
- **Convite:** link de uso único com **nível de acesso** + **função comercial** +
  validade; ao resgatar, move o profile pra conta e grava a função.
- **Página de vendas → checkout:** CTA do topo fala com vendas (WhatsApp); demais botões
  abrem formulário de cadastro da empresa e **redirecionam pro checkout Stripe**.

---

## 8. Deploy & banco

- **Código:** `main` publicada na Vercel a cada push.
- **Migrations aplicadas até 059:**
  - `050_checkout_leads`, `051_call_recordings`, `052_call_transcript`,
    `053_message_transcript` (cache de transcrição de áudio), `054_user_funcao_comercial`
    (`profiles.funcao` + `account_invitations.funcao` + redeem copia a função).
  - `055_broadcast_worker` (worker de disparo + pg_cron), `056_multichannel_phase1`
    (canais + `conversations.channel_id`), `057_agent_per_channel`, `058_multichannel_phase2`
    (`broadcasts`/`whatsapp_calls`.channel_id), `059_templates_per_channel`.

---

## 9. Pendências e riscos conhecidos

| Item | Situação |
|---|---|
| **Nome de exibição SpectraX (Meta)** | `name_status: PENDING_REVIEW` — nome "SpectraX" em análise pela Meta. Não afeta envio/recebimento; resolve sozinho na aprovação. |
| **Marcar funções dos membros existentes** | Membros antigos entram com `funcao` nula (→ tratados como closer). Marcar os SDRs em Configurações → Membros pra régua SDR valer (SpectraX já com 2 SDRs marcados). |
| **Footgun de exclusão de conta** | `profiles.account_id` é `ON DELETE CASCADE`: excluir uma conta apaga os profiles dos membros ativos. Só excluir após conferir; ou trocar o FK por comportamento seguro (migration à parte). |
| **Réguas customizadas × SDR** | A régua SDR só se aplica quando a conta **não** customizou o método; contas com método próprio usam a config delas. |
| **TURN p/ WebRTC** | Só se algum teste mostrar NAT travando (coturn grátis / Twilio). Hoje o relay do WhatsApp cobre. |

---

## 10. Próximos passos sugeridos

1. Marcar as funções comerciais dos membros (SDR vs closer) em cada conta.
2. Rodar o reaquecimento SpectraX: mover leads pra "Em cadência" e disparar `spx_*`.
3. (Produto) Trocar o `ON DELETE CASCADE` de `profiles.account_id` por comportamento seguro.
4. (Opcional) Botão de ligar/mensagem também em Contatos.
5. Acompanhar a aprovação do nome de exibição da SpectraX na Meta.

---
*Gerado em 10/jul/2026. Snapshot de dados reflete a produção nesta data.*
