# Canal de E-mail no CRM — plano de execução

> Levantado em **27/ago/2026**. Objetivo: prospecção por e-mail em volume controlado, com as
> **respostas caindo na inbox do CRM** e visíveis para a responsável (Ana Clara).

---

## 1. Decisões tomadas (Alberto, 27/ago)

| Decisão | Escolha |
|---|---|
| Provedor | **Zoho** |
| Domínio de disparo | **`time.sales3r.com.br`** — já pronto e em uso no Zoho |
| Volume | **até 50 e-mails/dia**, 1 caixa |
| Responsável | **Ana Clara — `acramos@time.sales3r.com.br`** (já existe no Zoho) |

> A escolha inicial tinha sido Google Workspace (o CRM já tem OAuth do Google pronto para o
> Calendar). O Alberto optou pelo Zoho por já estar configurado e em uso no subdomínio.
> **Trade-off aceito:** sem OAuth pronto e sem push em tempo real — o recebimento vira
> polling. Em compensação, não depende de aprovar app OAuth nenhum, e o polling é o padrão
> que já roda na casa (13 jobs `pg_cron` no Supabase).

---

## 2. Estado do DNS (verificado por `dig`, 27/ago — pós-correção)

```
time.sales3r.com.br   MX → mx.zoho.com               (ZOHO — domínio de DISPARO)
                     SPF → v=spf1 include:zohomail.com ~all              ✅
                    DKIM → seletor `dkim`, v=DKIM1; k=rsa; p=MIGf...     ✅
                   DMARC → v=DMARC1; p=none; rua=mailto:adm@sales3r...   ✅
                    >>> CONJUNTO COMPLETO — pronto para disparo

sales3r.com.br        MX → aspmx.l.google.com        (Google Workspace)
                     SPF → v=spf1 include:_spf.google.com ~all           ✅
                    DKIM → nenhum seletor comum responde                 ❌ FALTA
                   DMARC → v=DMARC1; p=none; rua=mailto:adm@sales3r...   ✅ corrigido
```

**Feito em 27/ago:**
1. DKIM do subdomínio de disparo gerado no Zoho e publicado ✅
2. DMARC do subdomínio criado ✅
3. **DMARC do domínio raiz corrigido** — o valor era literalmente
   `TXT    _dmarc    v=DMARC1; p=none;` (a linha inteira da instrução colada dentro do campo
   de valor). Não começava com `v=DMARC1`, então todo parser ignorava: o domínio principal
   estava **sem DMARC**. Agora válido ✅

**Pendência remanescente (não bloqueia este projeto):** o `sales3r.com.br` **não tem DKIM**.
Testados 9 seletores comuns, nenhum responde. Ativar em **Admin do Google → Apps → Gmail →
Autenticar e-mail**. Afeta a entrega de tudo que sai do domínio principal — Central de
Receita, convites do CRM, e-mail comercial — mas não a prospecção, que sai do `time.`.

> ⚠️ Ao conferir por `dig`, o resolver local pode devolver vazio por cache negativo (consultou
> antes do registro existir). Checar sempre contra `@8.8.8.8` / `@1.1.1.1`.

## 3. Arquitetura

```
Garimpo de leads (Apify / Máquina de Leads)
        └─→ contatos com e-mail no CRM  (já temos 2.201 de 2.618 = 84%)
                └─→ CANAL E-MAIL (channel_type='email')
                       ├─ envio     → SMTP Zoho, 1:1, intervalo aleatório, ≤50/dia
                       └─ recebimento → pg_cron (2 min) → /api/email/poll → IMAP Zoho
                                            └─→ conversations/messages
                                                   └─→ INBOX do CRM → Ana Clara
```

O e-mail entra como **mais um canal**, exatamente como o Instagram entrou. Inbox, responsável,
histórico do contato e cadência funcionam iguais ao WhatsApp.

### Por que IMAP/SMTP e não a Zoho Mail API

| | IMAP + SMTP | Zoho Mail API |
|---|---|---|
| Autenticação | senha de app (minutos) | app OAuth no Zoho (aprovação, refresh tokens) |
| Bibliotecas | `imapflow` / `nodemailer`, maduras | cliente próprio |
| Serverless | ✅ polling por cron (padrão da casa) | ✅ |
| Threading | remontar por `Message-ID`/`References` | ajuda um pouco |

**MVP com IMAP/SMTP.** A API fica como evolução se o threading der trabalho.

⚠️ **IMAP IDLE não funciona na Vercel** (conexão persistente; a função congela ao retornar).
Tem que ser polling por cron — o mesmo desenho dos jobs 2, 6, 7 e 8 que já rodam.

---

## 4. Estado atual do CRM

| Peça | Estado |
|---|---|
| `contacts.email` | ✅ 2.201 de 2.618 contatos (84%) |
| `pg_cron` + endpoints | ✅ padrão já rodando (13 jobs) |
| `phone_number_id` nullable | ✅ veio da migration do Instagram |
| `DEFAULT_CADENCE` | ⚠️ já prevê "E-mail" no dia 4 — sem implementação |
| `sendTextViaChannel` | ⚠️ existe, mas roteia binário (instagram : whatsapp) |
| `channel_type` | ❌ `CHECK (IN ('whatsapp','instagram'))` — não aceita e-mail |
| Login da Ana Clara | ❌ não existe no CRM |
| Resend (`lib/email/client.ts`) | ⚠️ transacional (convites/billing) — não serve de canal |
| OAuth Google (`google_connections`) | ➖ existe, mas não será usado nesta rota |

---

## 5. Fases

### Fase 0 — Infra (fora do código; precisa do Alberto)
1. ~~**Ativar DKIM** do `time.sales3r.com.br`~~ ✅ **feito 27/ago**
2. ~~**Criar o DMARC** do subdomínio~~ ✅ **feito 27/ago**
3. ~~Corrigir o DMARC do domínio raiz~~ ✅ **feito 27/ago**
4. Gerar **senha de app** no Zoho para a caixa `acramos@` (IMAP + SMTP) ⬅️ **próximo**
5. **Aquecer a caixa por 2–3 semanas** — começar em ~5/dia e subir devagar

> O aquecimento é o item de maior prazo do projeto. **Começar por ele**, em paralelo com o
> desenvolvimento — senão o código fica pronto e a caixa não pode disparar.

### Fase 1 — Canal no banco ✅ **APLICADA 27/ago** (`091_email_channel.sql`)
- `channel_type` agora aceita `'email'`; CHECK extra garante que canal de e-mail tem caixa
- Colunas novas em `whatsapp_config`: `email_address`, `email_provider`, `imap_host/port`,
  `smtp_host/port`, `daily_send_limit`, `imap_last_uid`, `last_poll_at`
- Credencial (senha de app do Zoho) reusa `access_token` — **mesmo AES-256-GCM** dos tokens
  de WhatsApp/Instagram
- `messages.subject` (assunto) + índice em `message_id` para casar a resposta na thread
- `contacts_account_email_idx` — ⚠️ **NÃO-único de propósito**: a base já tem **111 e-mails
  repetidos** dentro da mesma conta (`ranierisantos@gmail.com` aparece **10x**). Um UNIQUE
  quebraria a migration. **A regra de qual contato recebe a resposta fica no código**:
  preferir o que já tem conversa aberta, senão o mais recente
- Verificado: os 10 canais existentes (whatsapp/instagram) intactos

- [ ] Config UI: seção "E-mail" em Configurações (espelhar `instagram-settings.tsx`) — **pendente**

### Fase 2 — Envio
- `src/lib/email/outbound.ts` — SMTP via `nodemailer`, envio **1:1**, grava `Message-ID`
- Estender `sendTextViaChannel` para 3 canais
- Disparo em lote: reusar o motor de broadcast com **throttle + intervalo aleatório**
  (nunca "para: 50 pessoas" — sempre 50 e-mails individuais)
- **Teto por dia por caixa**, aplicado no worker

### Fase 3 — Recebimento

🚨 **BLOQUEADO — IMAP não habilitado NA CAIXA.** Resposta literal do servidor:

```
a1 NO [ALERT] You are yet to enable IMAP for your account.
             Please contact your administrator (Failure)
```

**Investigação no Admin Console do Zoho (27/ago) — duas hipóteses eliminadas:**

1. ❌ **Não é o host.** `imappro.zoho.com` e `imap.zoho.com` devolvem o MESMO erro. (A tela
   de Configurações do Zoho mostra `imappro`/`smtppro` como os hosts de organização — vale
   trocar por higiene, mas não é a causa.)
2. ❌ **Não é a política da organização.** Em *Política de e-mail → Política padrão →
   Restrições → Restrição de acesso*, o **Acesso IMAP está ✅ Habilitado** (junto de POP e
   ActiveSync). A "Restrição de acesso Aplicada" é a `Default Restriction`, e a lista de
   restrições customizadas está vazia.

✅ **Causa real:** a política diz *"os usuários **podem habilitar** o acesso IMAP **para suas
contas**"* — ela **permite**, mas cada caixa precisa ligar individualmente. Bate com o
`for your account` da mensagem.

**O Admin Console NÃO tem esse toggle por usuário** — varridos *Configurações da caixa de
correio* (alias, encaminhamento, política, delegado, ações, ausência, assinatura), *Incoming
Email Settings* (é anti-spam), *Personalização de configuração* e a busca global por "IMAP"
(que só oferece ações no nível de política).

**Como destravar:** entrar em **mail.zoho.com como a própria `acramos@`** → Configurações →
Contas de e-mail → **IMAP** → habilitar. A caixa **nunca fez login** e está com 0 B — o
primeiro acesso dela provavelmente é pré-requisito de qualquer forma. Caminhos: ela mesma
faz, ou o Alberto redefine a senha dela no Admin, entra, liga o IMAP e devolve a senha.

`imapflow@1.7.6` instalado e `verificarIMAP()` pronto — só falta a caixa aceitar.

- `/api/email/poll` + job `pg_cron` a cada 2 min (padrão dos jobs existentes)
- IMAP: buscar não-lidos, casar na conversa por `In-Reply-To`/`References`, criar contato se
  o remetente for novo, marcar como lido (idempotência)
- Inbox: **reusar `components/inbox/channel-display.tsx`** — contato de e-mail pode não ter
  telefone, igual ao do Instagram

### Fase 4 — Cadência
- Implementar o passo "E-mail" da `DEFAULT_CADENCE` (dia 4)
- **Parar a cadência quando o lead responde** (mesma regra da `diag-cadencia`)

---

## 6. Gotchas herdados (custaram caro antes — não repetir)

| Armadilha | Regra |
|---|---|
| **Fire-and-forget na Vercel** | A função congela ao retornar. Todo processamento pós-resposta em `after()`/`waitUntil` — foi o bug que fazia 1 de 10 mensagens do WhatsApp chegar |
| **IMAP IDLE** | Não sobrevive em serverless. Polling por cron, sempre |
| **`.eq('account_id').single()`** | Quebra assim que a conta tem 2+ canais. Sempre `resolveChannelConfig` |
| **Contato sem telefone** | `(contact.name \|\| contact.phone).charAt(0)` derruba a página. Usar os helpers de `channel-display.tsx` |
| **Painel de WhatsApp** | Filtrar `channel_type='whatsapp'`, senão o canal novo faz o banner acusar "desconectado" à toa |
| **Reputação de domínio** | Volume acima da capacidade da caixa não dá erro — degrada em silêncio |
| **Termos do Zoho** | O Zoho empurra bulk para o Zoho Campaigns. 50/dia **1:1 e personalizado** é outbound, não bulk — manter assim |

---

## 7. Pendências

**Com o Alberto (bloqueiam o resto):**
- [x] ~~**DKIM** do `time.sales3r.com.br`~~ ✅ 27/ago
- [x] ~~**DMARC** do `time.sales3r.com.br`~~ ✅ 27/ago
- [x] ~~DMARC do domínio raiz (estava quebrado)~~ ✅ 27/ago
- [x] ~~**Senha de app** do Zoho~~ ✅ 27/ago — cifrada e gravada no canal; SMTP provado ao vivo
- [ ] 🚨 **Habilitar IMAP** no Zoho Admin Console ⬅️ **bloqueia a Fase 3 inteira**
- [ ] 🔐 **Rotacionar a senha de app** — foi colada em texto plano no chat
- [ ] DKIM do `sales3r.com.br` no Admin do Google (à parte — não bloqueia)
- [ ] **Iniciar o aquecimento** da caixa — 2 a 3 semanas, é o item de maior prazo
- [ ] Ana Clara aceitar o convite do CRM (link gerado 27/ago, validade 14 dias)

**Comigo:**
- [x] ~~Marca da Ana Clara~~ → **Sales 3R**, papel `agent`
- [x] ~~Caixa de disparo~~ → **`acramos@time.sales3r.com.br`**
- [x] ~~Fase 1 — banco~~ → migration `091` aplicada
- [x] ~~Fase 2 — envio (SMTP + throttle + teto diário)~~ → código pronto, typecheck/lint/testes ok
- [x] ~~Fase 1 — UI de configuração do canal~~ ✅ 27/ago — `/api/email/config` (GET/POST/DELETE),
      `/api/email/test` (SMTP e IMAP separados), `email-settings.tsx`, seção "E-mail" na
      navegação. Build de produção compila, typecheck/lint limpos.
- [ ] Fase 3 — recebimento (`/api/email/poll` + job `pg_cron`)
- [ ] Fase 4 — passo de e-mail na cadência

## 8. Resolvido

**Login da Ana Clara (27/ago):** criado por **convite** (fluxo oficial do produto —
`account_invitations`, token de 32 bytes com SHA-256 no banco), e não por INSERT direto em
`auth.users`. Conta **Sales 3R**, papel **`agent`**, validade 14 dias. Ela define a própria
senha ao aceitar. Promover para `admin` se precisar configurar o canal sozinha.

Relacionado: `MULTICANAL-MULTIAGENTE.md`, `INSTAGRAM-DIRECT-CANAL.md`
