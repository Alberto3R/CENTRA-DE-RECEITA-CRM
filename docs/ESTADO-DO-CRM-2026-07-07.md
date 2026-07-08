# Estado do CRM — Central de Receita · 07/jul/2026

Documento-retrato de como o CRM está **hoje**: o que é, o que faz, quem usa,
o que mudou nesta rodada e o que ainda está pendente. Fonte: base de produção
(Supabase `uymmbqockiqcpporluxk`) + código (`Alberto3R/wacrm`, deploy Vercel).

---

## 1. O que é

**Central de Receita** — CRM multi-marca de WhatsApp + **Gestor Comercial (IA)** +
suíte **Outbound/SDR**. Um número de WhatsApp oficial (Cloud API) por marca,
inbox compartilhado, funil de vendas, disparos, automações e camada de IA para
análise comercial. Fork evoluído do `wacrm`.

- **Stack:** Next.js 16 (App Router) · Supabase (Postgres + RLS + Realtime + Auth) ·
  deploy Vercel (auto-deploy no push da `main`).
- **Multi-tenancy:** cada **conta** (marca) é um tenant isolado por RLS. Papel do
  usuário vive em `profiles.account_role`; multi-conta via `account_members` +
  RPC `switch_account`.
- **Idioma/tema:** PT-BR, tema escuro, marca Central de Receita (acento esmeralda,
  símbolo sino). Paleta troca por conta (marca ativa).

---

## 2. Marcas conectadas (snapshot de produção)

| Conta (tenant) | Plano | WhatsApp | Contatos | Negócios | Modelos aprovados |
|---|---|---|---|---|---|
| **Elas que Vendem** | enterprise | ✅ conectado | 59 | 52 | 24 |
| **AUGRA** | enterprise | ✅ conectado | 1 | 3 | 28 |
| **Sales 3R** | enterprise | ✅ conectado | 1 | 0 | 2 |
| **SpectraX** *(conta "Alberto Oliveira")* | enterprise | ✅ conectado | 69 | 68 | 6 |

> **Nota:** a conta que opera a **SpectraX** ainda se chama **"Alberto Oliveira"**
> no CRM (nome herdado do signup). Sugestão: renomear para "SpectraX".
> `ANDRE DE SOUZA DE ALENCAR` (free, vazia) é o tenant pessoal do André — some
> quando ele aceitar o convite de SDR (o aceite move o profile e limpa o tenant).

---

## 3. Módulos / o que o CRM faz hoje

| Módulo | Estado | O que faz |
|---|---|---|
| **Conversas (Inbox)** | ✅ | Inbox WhatsApp compartilhado; envio de texto/mídia/**modelos**; respostas, reações, sessão de 24h; **botão de ligar** no header. |
| **Funis (Pipeline)** | ✅ | Kanban de negócios, drag-and-drop, filtros (data/responsável/tag), motivos de perda editáveis; **no card: Ligar + Iniciar conversa com modelo**. |
| **Contatos** | ✅ | Base de contatos, tags, campos, notas, importação. |
| **Painel Outbound** | ✅ | KPIs do time de SDR (ligações, atendimentos, conversas c/ decisor★, WhatsApp, reuniões, qualificados), forecast do mês, **cadência editável** e fila "Próximos passos". |
| **Disparos (Broadcasts)** | ✅ | Envio em massa por modelo, com métricas de entrega/leitura/resposta. |
| **Automações** | ✅ (admin) | Gatilhos → ações (nova mensagem, palavra-chave, novo contato, 1ª msg). |
| **Fluxos (Flows)** | ✅ beta (admin) | Bots/menus interativos por botão/lista. |
| **Relatórios** | ✅ | Análises de funil, motivos de perda, atividade. |
| **Gestor Comercial (IA)** | ✅ (admin) | Analisar conversa (transcrição **ou busca no WhatsApp**), analisar funil, avaliar time, criar materiais. |
| **Configurações** | ✅ (admin) | Perfil, segurança, aparência, **Assinatura**, WhatsApp, Modelos, Campos/Tags, Negócios/moeda, Agente IA, Webhooks, **Membros**, Chaves de API. |
| **Assinatura (Billing)** | ✅ | Self-service via Stripe (portal, assentos por plano, banner de pagamento pendente). |
| **Ligação WhatsApp (VoIP)** | 🟡 **novo** | Ver §5. Receber já funciona; **ligar** espera liberação de tier na Meta. |

---

## 4. Papéis e permissões

Hierarquia: **owner > admin > agent > viewer** (fonte de verdade: `profiles.account_role`;
RLS via `is_account_member`).

- **Owner / Admin:** enxergam tudo, incluindo Automações, Fluxos, Gestor Comercial e
  **Configurações**.
- **Agent (SDR):** vê **Painel, Conversas, Contatos, Funis, Painel Outbound, Relatórios,
  Disparos**. **Não** vê Automações, Fluxos, Gestor Comercial nem Configurações
  (só Perfil/Segurança/Aparência de Configurações). *(Corrigido nesta rodada.)*
- **Viewer:** somente leitura.

Escritas sensíveis são protegidas por **RLS no banco**; o menu é a camada visual.

---

## 5. WhatsApp — conexão, modelos e ligação

- **Conexão:** cada marca tem número oficial na **Cloud API** (token de system user
  criptografado AES-256-GCM no `whatsapp_config`; webhook fan-out pro CRM).
- **Modelos (templates):** criados/sincronizados do Meta; enviáveis do inbox e do
  card de negócio. *(Bug corrigido nesta rodada: o seletor escondia modelos de
  agentes — agora escopa por conta.)*
- **Módulo de ligação (Calling API) — novo:**
  - **Receber chamadas:** ✅ funcional. Lead liga → card "Chamada recebida" toca em
    qualquer tela → SDR atende (WebRTC no navegador) → áudio conecta. `callback_permission`
    ativo (quem liga já autoriza retorno).
  - **Ligar pro lead (business-initiated):** código no ar (botão no inbox/card +
    pedido de permissão), mas o **go-live depende do tier de mensagens ≥ 2.000/dia**
    da Meta (número novo ainda não tem). Sinalização por Graph API + webhooks; mídia
    WebRTC no navegador; **sem ferramenta externa paga**.
  - Toda ligação encerrada vira **atividade "call"** no Painel Outbound.

---

## 6. O que mudou nesta rodada (jul/2026)

**Onboarding SpectraX (reaquecimento):**
- 📥 **68 leads** inbound (lista do Carlos/CEO) importados na pipeline **Outbound SDR**
  (estágio "Novo lead"), com notas ricas + tag `SpectraX · Reaquecimento`; 10 "quentes"
  com tag `🔥 Prioridade · Pediu reunião`.
- 📱 **WhatsApp da SpectraX conectado** ao CRM (número +55 66 93618-1879, Cloud API).
- 📝 **5 modelos UTILITY** de reaquecimento (`spx_reaquecimento_*`) criados e aprovados;
  envio de teste **entregue**.
- 🖼️ **Foto de perfil** da SpectraX gerada e publicada (homem de camisa social + logo).

**Produto:**
- ☎️ **Módulo de ligação VoIP** (receber + ligar + atender) — §5.
- 🧩 Card de negócio ganhou **Ligar** e **Iniciar conversa com modelo** (cria a conversa
  do lead importado e dispara o template).
- 🔐 **RBAC do menu:** agentes deixaram de ver páginas de admin (Configurações etc.).
- 🐛 **Fix:** seletor de modelos passou a escopar por conta (agentes voltaram a ver os
  modelos aprovados).
- 👥 **Acessos:** time SpectraX provisionado — Enzo (admin/líder), Lorenzo e André (SDRs);
  acesso da Karol (admin Elas que Vendem) reparado.

---

## 7. Deploy & banco

- **Código:** `main` publicada na Vercel a cada push (último ciclo incluiu módulo de
  ligação, botões do card, RBAC e fixes).
- **Migrations:** aplicadas até **049** (`whatsapp_calls` + `offer_sdp` do módulo de
  ligação; antes: cadência editável 047, motivos de perda 046, outbound 043-045).

---

## 8. Pendências e riscos conhecidos

| Item | Situação |
|---|---|
| **Ligar pro lead (outbound)** | Espera **tier ≥ 2.000/dia** da Meta na SpectraX. Sobe com volume/qualidade dos templates. |
| **Renomear conta "Alberto Oliveira" → "SpectraX"** | Cosmético, recomendado. |
| **Convite do André (SDR)** | Pendente de aceite. Ao aceitar, o tenant pessoal dele é limpo. |
| **Footgun de exclusão de conta** | `profiles.account_id` é `ON DELETE CASCADE`: excluir uma conta apaga os profiles dos membros que a têm como ativa (tranca o usuário). Só excluir conta após conferir que nenhum profile ativo aponta pra ela — ou trocar o FK por comportamento seguro (migration à parte). |
| **Membership em duas tabelas** | `profiles` (conta ativa+papel) e `account_members` (multi-conta) nem sempre em sync dependendo do fluxo de convite. Vale unificar/reconciliar. |
| **TURN p/ WebRTC** | Só se o teste de ligação mostrar NAT travando (coturn grátis / Twilio). Hoje o relay do WhatsApp cobre. |

---

## 9. Próximos passos sugeridos

1. Rodar o reaquecimento SpectraX: mover leads pra "Em cadência" e disparar `spx_*`.
2. Escalar o tier de mensagens da SpectraX pra destravar ligar-pro-lead.
3. Renomear a conta para "SpectraX".
4. (Produto) Trocar o `ON DELETE CASCADE` de `profiles.account_id` por comportamento seguro.
5. (Opcional) Botão de ligar/mensagem também em outras telas (contatos).

---
*Gerado em 07/jul/2026. Snapshot de dados reflete a produção nesta data.*
