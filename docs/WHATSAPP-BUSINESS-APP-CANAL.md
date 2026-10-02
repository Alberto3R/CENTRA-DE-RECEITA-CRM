# WhatsApp Business (app do celular) como canal do CRM

Pesquisa + mapa de impacto · 02/out/2026 · status: **Caminho A implementado na branch `feat/whatsapp-coexistencia` (falta configurar a Meta e aplicar a migration 102)**

## O problema que isso resolve

Hoje o CRM só enxerga o WhatsApp da **Cloud API oficial**. O SDR e o vendedor também falam com
lead pelo **WhatsApp Business do celular**, e essa conversa nunca entra no CRM. Foi assim que
o funil Diagnóstico pareceu "não trabalhado" quando, na verdade, foi trabalhado fora do sistema.

## Dois caminhos

| | **A. Coexistência (oficial da Meta)** | **B. Baileys via Evolution API (QR code)** |
|---|---|---|
| O que é | O mesmo número roda no app Business do celular **e** na Cloud API ao mesmo tempo | Biblioteca que imita o WhatsApp Web; conecta lendo um QR code |
| Status no Brasil | **Liberado no Brasil** | Funciona, mas viola os Termos da Meta |
| Risco de banimento | Nenhum (é produto oficial) | **Alto.** O número pode ser restrito ou banido sem aviso, mais ainda com volume ou disparo frio |
| Histórico | Até **180 dias** de conversas 1:1 importados na conexão | Só o que chega a partir da conexão (o sync de histórico do Baileys é parcial) |
| Mensagens enviadas pelo celular | Chegam no CRM via webhook `smb_message_echoes` | Chegam (`fromMe=true`) |
| Grupos | **Não** | Sim |
| Custo | Tarifa Meta só em template; resposta dentro de 24h é grátis | Servidor próprio sempre ligado + o risco de perder o número |
| Infra | Nenhuma nova (é o webhook que já existe) | **Servidor dedicado** (Docker + Postgres + Redis). Não roda na Vercel |
| Encaixe no código | O canal continua `channel_type='whatsapp'`: reaproveita tudo | Tipo de canal novo, que exige mexer em cerca de 30 pontos (abaixo) |
| Limitações | 20 msg/s somando app e API; mensagens temporárias, visualização única e localização ao vivo ficam desligadas; listas de transmissão ficam só leitura; app ≥ 2.24.17 | Sem template, sem botões confiáveis, sem CAPI/CTWA, sem ligação; a sessão cai e precisa de reconexão |

### Recomendação

1. **Caminho A (Coexistência) para o uso principal**: os números de SDR e de vendedor que já usam o
   WhatsApp Business no celular. Resolve 90% da dor (ver no CRM o que acontece no aparelho) sem risco.
2. **Caminho B só se for preciso** ter grupos ou números que não podem entrar na Meta. Nesse caso
   vale como canal de **atendimento 1:1**, **nunca** de disparo ou prospecção fria. No produto
   Central de Receita, oferecer como opção "por conta e risco do cliente", com termo de aceite.
3. Não usar Baileys para escalar volume. O número da 3R já foi estrangulado com API oficial; num
   canal não oficial, o mesmo comportamento termina em banimento.

---

## Caminho A: o que ajustar no CRM (Coexistência)

**Pré-requisito Meta (⚠️ verificar antes de codar):** a Coexistência só é conectada pelo
**Embedded Signup**, que exige o app da Meta habilitado como **Tech Provider** ou parceiro e o
Business verificado. O CRM ainda não tem Embedded Signup. Construir direto na **v4**: a v2
será descontinuada em **15/out/2026**.

1. **Tela "Conectar WhatsApp do celular"** (Configurações → WhatsApp): botão que abre o Embedded
   Signup (FB JS SDK, fluxo de onboarding do app Business). Ele devolve `code`, `waba_id` e
   `phone_number_id`. O back troca `code` por token, cifra com `ENCRYPTION_KEY`, insere a linha
   em `whatsapp_config` (`channel_type='whatsapp'`, `label` com o nome do SDR) e assina o app
   (`subscribed_apps`). ⚠️ Confirmar na doc se o número de coexistência deve ou não passar pelo `/register`.
   - Nova coluna `whatsapp_config.connection_mode` ('cloud' | 'coexistence').
2. **Webhook** (`src/app/api/whatsapp/webhook/route.ts`): tratar 3 campos novos:
   - `smb_message_echoes`: mensagem que o vendedor mandou **pelo celular**. Gravar como saída
     (`sender_type` de agente humano) com `messages.origin='device'`.
   - `history`: lote de histórico de até 180 dias. Importar em background, em blocos (job + `after()`),
     sem disparar flows, automações ou agente.
   - `smb_app_state_sync`: contatos do celular, para criar ou atualizar `contacts`.
3. **Dedupe por `message_id`** (obrigatório aqui, porque histórico e echo se sobrepõem): índice único
   `(conversation_id, message_id)` + `insert … on conflict do nothing`. **Esse bug já existe hoje**:
   o webhook não deduplica, e uma retentativa da Meta duplica a mensagem.
4. **Coluna `messages.origin`** ('crm' | 'device' | 'history' | 'agent'). Serve para os painéis não
   misturarem o que foi feito no CRM com o que foi feito no celular, e para a gestão ver quem respondeu e por onde.
5. **Agente de IA / flows**: se chegar um echo do celular na conversa, o humano assumiu. Marcar
   `conversations.ai_handoff=true` para o agente não atropelar o vendedor.
6. **Disparo**: respeitar o teto de 20 msg/s por número (o worker de broadcast já enfileira, só ajustar o ritmo).

📊 ESTIMATIVA: 3 a 5 dias de desenvolvimento + o tempo da Meta para liberar o Tech Provider.

---

## Caminho A — o que já foi feito (branch `feat/whatsapp-coexistencia`)

| Peça | Onde |
|---|---|
| Migration: trava de duplicata, `messages.origin`, colunas `coex_*`/`connection_mode` em `whatsapp_config`, tabela `whatsapp_app_contacts` (com RLS) | `supabase/migrations/102_whatsapp_coexistencia.sql` |
| Webhook: dedupe na entrada (retentativa da Meta não grava nem dispara bot de novo) | `src/app/api/whatsapp/webhook/route.ts` |
| Webhook: `smb_message_echoes` → mensagem de atendente `origin='app'`, pausa IA e flow | idem |
| Webhook: `history` → importa calado em lotes, `origin='history'`, progresso no canal | idem |
| Webhook: `smb_app_state_sync` → agenda em `whatsapp_app_contacts` (NÃO cria contato; só dá nome) | idem |
| Número em coexistência: flows e automações da conta não respondem (agente só se tiver um configurado no canal) | idem |
| Conexão: troca do code, assinatura da WABA, canal salvo sem `/register`, pede agenda + histórico | `src/app/api/whatsapp/coexistence/onboard/route.ts` |
| Botão "Conectar WhatsApp do celular" + status da importação | `src/components/settings/coexistence-connect.tsx` |
| Selo "pelo celular" / "histórico" no balão | `src/components/inbox/message-bubble.tsx` |
| Proxy de mídia tenta o token de cada canal (cada vendedor tem a sua WABA) | `src/app/api/whatsapp/media/[mediaId]/route.ts` |
| Testes ponta a ponta do webhook (banco em memória, HMAC real) | `src/app/api/whatsapp/webhook/coexistence.test.ts` |

### Estado na Meta (02/out/2026)
- App "Sales 3R API" (1005742594569109), portfólio 1653435418279597: verificação da empresa ✅; termos de
  Tech Provider (Independent) aceitos ✅; **Verificação do acesso enviada — em análise** (prazo Meta 01/12/2026).
- Configuração do Embedded Signup criada: **config_id `962999766232045`** ("Central de Receita - Coexist").
  Tipo de recurso confirmado no configurador: `whatsapp_business_app_onboarding`.
- Login do Facebook para Empresas: "Entrar com o SDK do JavaScript" = Sim; domínios permitidos
  `centraldereceita.com.br`, `vendas.sales3r.com.br`, `sales-3r-crm.vercel.app`.
- Webhook do app (callback `/api/whatsapp/webhook`): assinados `messages`, `calls`, `history`,
  `smb_app_state_sync`, `smb_message_echoes`.
- Falta: os 2 vídeos + pedido de acesso avançado a `whatsapp_business_messaging`,
  `whatsapp_business_management` e `public_profile` (o Login para Empresas exige).

### Falta para ir ao ar (passos humanos)
1. **Meta — app como Tech Provider.** No app da Meta (ex.: "Sales 3R API", 1005742594569109): verificação do
   Business + acesso de Tech Provider. ⚠️ Sem isso o Embedded Signup não abre para terceiros.
2. **Meta — configuração do Embedded Signup.** Produto "Facebook Login for Business" → nova configuração
   do tipo WhatsApp Embedded Signup com o onboarding do **app WhatsApp Business** habilitado → anotar o
   `config_id`. Em "Domínios permitidos para o SDK JS": `centraldereceita.com.br` e `vendas.sales3r.com.br`.
3. **Meta — webhooks do app:** assinar os campos `history`, `smb_app_state_sync` e `smb_message_echoes`
   (o callback já é o do CRM).
4. **Vercel — env vars:** `NEXT_PUBLIC_META_APP_ID`, `NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID`,
   `META_EMBEDDED_SIGNUP_APP_SECRET` (opcional `NEXT_PUBLIC_META_GRAPH_VERSION`, padrão v25.0).
   Sem as duas públicas o botão não aparece — o deploy é seguro antes da Meta estar pronta.
5. **Banco:** aplicar a migration 102. Ela NÃO apaga nada: com as 4 duplicatas que existem hoje em produção
   o índice único não é criado (o dedupe no código já funciona sem ele). Decidir o que fazer com as 4 sobras
   e então criar o índice.
6. **Teste real:** conectar um número de teste pelo app (versão ≥ 2.24.17), conferir histórico, echo e mídia.
   A Meta só aceita pedir agenda/histórico **uma vez e em até 24h** após a conexão.

⚠️ A conferir no teste real: o valor `featureType: 'whatsapp_business_app_onboarding'` no `FB.login`
(a doc v4 habilita o onboarding pela configuração; o extra é inofensivo se sobrar).

## Caminho B: o que ajustar no CRM (Baileys / Evolution API)

### Infra
- **Evolution API v2** (open source, Apache 2.0, ~10 mil estrelas, usa Baileys por baixo e já
  normaliza webhooks) num VPS ou Railway/Fly: Docker + Postgres + Redis. **Uma instância por número.**
  Não usar Baileys direto dentro do Next: a sessão é um WebSocket permanente, e a Vercel congela a função.
- Alternativa paga (sem servidor): Z-API, UAZAPI, W-API. Mesmo risco de banimento, só muda quem hospeda.

### Banco
- Migration nova recriando o CHECK: `channel_type in ('whatsapp','instagram','email','whatsapp_qr')`
  (mesmo padrão DO-block da `091_email_channel.sql`).
- Colunas em `whatsapp_config`: `qr_instance`, `qr_base_url`, `qr_api_key` (cifrada),
  `qr_webhook_secret` (cifrado), `connection_state` ('open'|'connecting'|'close'), `last_connected_at`.
- Dedupe por `message_id` (o mesmo item 3 do Caminho A).

### Ingestão (modelo = o canal de Instagram)
- Rota nova `/api/whatsapp-qr/webhook` (o path precisa conter `/webhook` para passar no
  `src/middleware.ts:91-95`), autenticada por segredo da instância e processando em `after()`.
- Eventos: `MESSAGES_UPSERT` (entrada, e `fromMe` = enviada pelo celular), `MESSAGES_UPDATE`
  (status sent/delivered/read), `CONNECTION_UPDATE` (caiu → alerta), `QRCODE_UPDATED`.
- Ignorar `@g.us` (grupos) e `status@broadcast` na v1. ⚠️ O WhatsApp está migrando contatos para
  **LID** (identificador sem telefone); o dedupe de contato tem que aceitar LID além de telefone.
- Mídia: baixar (base64 da Evolution) e subir no Supabase Storage com URL absoluta. O proxy
  `/api/whatsapp/media/{id}` é exclusivo da Meta. A transcrição já aceita URL absoluta.

### Envio: cerca de 30 pontos acoplados (mapa do código)
- **Branch novo** em `src/lib/messaging/send.ts` (o lugar natural), em `src/lib/ai-agent/handle.ts:153`
  (faz fetch direto no Graph), em `src/lib/automations/meta-send.ts:121`, em `src/lib/flows/meta-send.ts`
  (texto :84, **mídia :232 e botões :381 usam o canal PRIMÁRIO, sem olhar a conversa**),
  em `src/app/api/whatsapp/send/route.ts:284` e em `react/route.ts:114`.
- **`resolveChannelConfig` (`src/lib/whatsapp/channel.ts:20`) não filtra tipo.** Cerca de 15 chamadas
  sem `channelId` caem no primário e mandam template Cloud por ele (broadcast, leads, gateway,
  alertas, deal-trigger, scheduled, CAPI, ligação, mídia). Se o canal QR virar primário, tudo
  isso quebra calado. Correção: `resolveChannelConfig(..., { type: 'whatsapp' })` nesses pontos.
- Botões e listas dos flows: no QR, virar texto numerado ("responda 1, 2 ou 3").

### O que fica desligado no canal QR
Templates/HSM, janela de 24h (não existe), disparo em massa (bloquear, ou deixar no máximo 1 msg a cada 20-40s
com teto diário), ligação, CAPI/CTWA, quality rating. A UI precisa esconder esses recursos, como já faz com o Instagram.

### UI
- Seção nova em Configurações: "WhatsApp (QR code)", com QR na tela (polling do estado),
  botões reconectar/desconectar e selo **"não oficial"**.
- Inbox: `channel-display.tsx` hoje decide pelo **contato**, não pelo canal. Passar a decidir pelo
  `channel_type` da conversa para mostrar o selo certo.
- Alerta de queda da conexão: reaproveitar o monitor de saúde via Resend.

### Boas práticas anti-banimento (reduzem o risco, não o eliminam)
- Usar número **aquecido** (com meses de uso real), nunca um chip novo.
- Fila de envio com atraso aleatório (≥ 2-5 s), presença "digitando…" e teto diário.
- Só responder quem chamou ou quem já é contato. **Nada de prospecção fria.**
- Não mandar o mesmo texto idêntico para muita gente; nada de link encurtado em massa.
- Ter plano de contingência: se o número cair, o histórico precisa estar no CRM (por isso a ingestão é o mais importante).

📊 ESTIMATIVA: 2 a 3 semanas (infra + ingestão + branch de envio + bloqueios de UI + testes) +
custo mensal do servidor.

---

## Bugs encontrados no mapeamento (valem independente da decisão)
1. O webhook do WhatsApp **não deduplica por `message_id`**: uma retentativa da Meta duplica a mensagem.
2. `resolveChannelConfig` devolve o primário **de qualquer tipo**. Se alguém marcar o Instagram ou o
   e-mail como primário, os templates de leads, broadcasts e alertas quebram.
3. A mídia (`/api/whatsapp/media/[mediaId]`) e a mídia e os botões dos flows usam o token do canal **primário**,
   o que falha com um 2º número em outra WABA.
4. `conversation-list.tsx:122` lê `whatsapp_config.display_phone_number`, coluna que não aparece em
   nenhuma migration. ⚠️ Conferir se existe em produção.
5. O tipo TS `WhatsAppConfig` (`src/types/index.ts:235`) não tem `channel_type`.

## Fontes
- Coexistência: ycloud.com/blog/whatsapp-business-app-coexistence-meta-update ·
  instantreply.co/blog/whatsapp-coexistence-what-actually-syncs-2026 · whautomate.com/whatsapp-coexistence
- Evolution API: github.com/EvolutionAPI/evolution-api
- Risco Baileys: adviseai.in/blog/whatsapp-automation-ban-risk · zylos.ai/research/2026-01-26-whatsapp-api-automation
