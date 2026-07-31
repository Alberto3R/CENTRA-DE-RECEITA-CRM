# Glossário PT-BR — Tradução da UI do CRM Sales 3R

Referência única para traduzir a interface de inglês → português (Brasil),
de forma consistente e SEM quebrar o app.

## ⚠️ REGRA DE OURO

Traduzir **somente texto que o usuário final vê na tela**:
- Texto entre tags JSX (`<h1>Welcome</h1>`)
- `placeholder`, `title`, `aria-label`, `alt`
- Labels de formulário, texto de botões, títulos, subtítulos
- Mensagens de toast/sonner, estados vazios, mensagens de erro exibidas
- `<title>` e metadata de página visíveis

**NUNCA traduzir / NUNCA alterar:**
- Nomes de variáveis, funções, componentes, tipos, hooks
- Chaves de objeto (`{ status: ... }` — a chave `status` fica)
- `import`/`export`, caminhos, URLs, nomes de rotas
- `console.log/error/warn`, comentários de código
- `data-*`, `className`, classes Tailwind, ids, `name` de inputs usados em lógica
- **Valores de dados/enum comparados ou salvos** (lista abaixo)
- A palavra **`wacrm`** (o nome do produto é tratado na fase de rebrand — deixar intacto)

## 🚫 VALORES DE DADOS — manter SEMPRE em inglês (não traduzir o literal)

Esses literais são comparados em código e/ou gravados no Postgres (CHECK/ENUM).
Traduzir o **valor** quebra o banco. Só traduza o **label exibido**, nunca o valor.

- **roles:** `owner`, `admin`, `agent`, `viewer`
- **category:** `Marketing`, `Utility`, `Authentication`
- **status (vários):** `connected`, `disconnected`, `online`, `away`,
  `open`, `pending`, `closed`, `won`, `lost`, `draft`, `active`, `archived`,
  `scheduled`, `sending`, `sent`, `delivered`, `read`, `replied`, `failed`,
  `running`, `done`, `success`, `partial`, `expired`, `revoked`, `fulfilled`,
  `Draft`, `Pending`, `Approved`, `Rejected`, `REJECTED`
- **types:** `text`, `image`, `document`, `audio`, `video`, `location`,
  `template`, `customer`, `agent`, `bot`, `button`, `csv`, `custom_field`,
  `exact`, `contains`, `condition`, `wait`, `end`, `all`
- **template component types:** `BODY`, `BUTTONS`, `HEADER`, `FOOTER`,
  `COPY_CODE`, `PHONE_NUMBER`, `QUICK_REPLY`, `URL`
- **triggers:** `keyword`, `first_inbound_message`, `manual`, `keyword_match`
- **branch:** `yes`, `no`

> Padrão seguro: `status === 'won' ? 'Ganho' : 'Perdido'` — o `'won'`/`'lost'`
> ficam; só o texto exibido `'Ganho'`/`'Perdido'` é traduzido.

## 📖 Termos — módulos / navegação

| EN | PT-BR |
|---|---|
| Dashboard | Painel |
| Inbox | Caixa de entrada |
| Contacts | Contatos |
| Pipelines | Funis |
| Deals | Negócios |
| Broadcasts | Disparos |
| Automations | Automações |
| Flows | Fluxos |
| Settings | Configurações |
| Templates | Modelos |
| Tags | Tags |
| Members | Membros |
| Custom fields | Campos personalizados |
| API keys | Chaves de API |

## 📖 Termos — entidades

| EN | PT-BR |
|---|---|
| Contact | Contato |
| Conversation | Conversa |
| Message | Mensagem |
| Note | Nota |
| Deal | Negócio |
| Stage | Etapa |
| Account | Conta |
| Owner | Proprietário |
| Admin | Administrador |
| Agent | Agente |
| Viewer | Visualizador |
| Recipient | Destinatário |
| Template | Modelo |
| History | Histórico |
| Event | Evento |

## 📖 Termos — ações

| EN | PT-BR | EN | PT-BR |
|---|---|---|---|
| Save | Salvar | Cancel | Cancelar |
| Delete | Excluir | Remove | Remover |
| Add | Adicionar | Edit | Editar |
| Create | Criar | Update | Atualizar |
| Search | Buscar | Filter | Filtrar |
| Export | Exportar | Import | Importar |
| Send | Enviar | Close | Fechar |
| Confirm | Confirmar | Back | Voltar |
| Next | Próximo | Continue | Continuar |
| Invite | Convidar | Connect | Conectar |
| Copy | Copiar | Download | Baixar |

## 📖 Termos — autenticação

| EN | PT-BR |
|---|---|
| Sign in | Entrar |
| Sign out | Sair |
| Sign up / Create account | Criar conta |
| Welcome back | Bem-vindo de volta |
| Email | E-mail |
| Password | Senha |
| Forgot password? | Esqueceu a senha? |
| Don't have an account? | Não tem uma conta? |
| Already have an account? | Já tem uma conta? |
| Reset password | Redefinir senha |

## 📖 Termos — estados (LABELS exibidos; valor do dado fica em inglês)

| EN | PT-BR |
|---|---|
| Loading… | Carregando… |
| No results | Nenhum resultado |
| Connected / Disconnected | Conectado / Desconectado |
| Online / Away | Online / Ausente |
| Draft | Rascunho |
| Pending | Pendente |
| Approved / Rejected | Aprovado / Rejeitado |
| Sent / Delivered / Read | Enviado / Entregue / Lido |
| Scheduled | Agendado |
| Active / Archived | Ativo / Arquivado |
| Won / Lost | Ganho / Perdido |
| Open / Closed | Aberto / Fechado |
| Failed | Falhou |
| Registered / Not registered | Registrado / Não registrado |

## 📖 Termos técnicos Meta/WhatsApp (manter em inglês; só o rótulo ao redor traduz)

Nomes próprios da plataforma da Meta — **não traduzir o termo**. Traduza só o texto
ao redor (ex.: "Insira o **App Secret**", "Número **registrado** na Cloud API").

| Termo | Observação |
|---|---|
| **App Secret** | Segredo do App Meta; valida a assinatura dos webhooks. Guardado por canal (`whatsapp_config.app_secret`), env `META_APP_SECRET` = fallback. |
| **App ID** | ID do App Meta. |
| **verify token** / **Token de verificação do webhook** | String que o operador cria; casa com o webhook na Meta. Rótulo pode ser PT ("Token de verificação"); o conceito é esse. |
| **access token** / **Token de acesso** | Token permanente (System User). Rótulo PT ok. |
| **phone_number_id**, **WABA** (WhatsApp Business Account) | Identificadores da Cloud API. |
| **Cloud API** / **registrar (register)** | Verificar ≠ **registrar**: sem `/register` (com PIN de 2 etapas), o envio falha com **#133010 "Account not registered"**. |
| **PIN de verificação em duas etapas** | PIN 2FA do número, exigido no `/register`. |
| **template** (button/quick reply) | O toque em botão de template chega como mensagem `type: 'button'` (valor de dado — fica em inglês). |

## Tom

- Português do Brasil, profissional e direto (CRM de vendas).
- Tratamento por "você". Pode usar imperativo nos botões ("Salvar", "Adicionar contato").
- Manter acentuação correta (ã, ç, é, ó…). Não usar "vc", gírias ou abreviações.
