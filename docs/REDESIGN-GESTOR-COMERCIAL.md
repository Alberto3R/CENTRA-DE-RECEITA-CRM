# Plano de Redesign — Gestor Comercial (UI sem "cara de IA")

> Gerado com a skill `design-taste-frontend`. **Design read:** UI de produto/dashboard
> para times de vendas B2B (BR). Não é landing page — então aplicamos as partes
> transferíveis da skill: anti-slop, anti-AI-tell, base neutra + 1 accent, hierarquia
> por peso/cor, shadcn/ui (já no stack) **nunca no estado default**.

## Objetivos do dono (travados)
1. **Nenhum h1 com o termo "IA".** (Feito: "Análise de conversa", "Análise de funil", "Avaliação do time", "Criar materiais comerciais".)
2. **Design não pode ter cara de IA.** Sem gradiente roxo/azul-glow, sem emoji-robô, sem "✨/🤖", sem cards genéricos flutuando.
3. **Menu agrupado sob "Gestor Comercial"**, itens como **verbos**. (Feito: grupo colapsável → Analisar conversa · Analisar funil · Avaliar time · Criar materiais.)

## Princípios (o "anti-cara-de-IA")
- **Base neutra + 1 accent só.** Mantém o accent da conta (`bg-primary`); proibido roxo/neon/glow. Sombra, quando houver, tingida do fundo — nunca preto puro.
- **Hierarquia por peso e cor, não por tamanho gritante.** h1 = `text-xl/2xl semibold tracking-tight`; nada de `text-6xl`.
- **Números em `font-mono` tabular** (perdas em R$, scores, créditos). Dá ar de "ferramenta séria", não de chat.
- **Cards só quando elevação comunica hierarquia.** Onde for lista, usar `divide-y`/`border-t` + espaço, não caixinha em tudo.
- **Estados reais:** loading (skeleton no formato do resultado), vazio (composto, com o próximo passo), erro (inline). Já há erro inline; falta skeleton e empty caprichado.
- **Zero emoji** no produto (há um `🙂` no default do agente de WhatsApp — manter fora das telas do Gestor). Ícones: a lib já é `lucide-react` (manter uma família só).
- **Linguagem de gestor, em verbos.** Sem "IA faz X"; falar do resultado ("Onde o dinheiro vazou", "Pauta da reunião", "Plano de 90 dias").

## Design system enxuto (aplicar às 4 telas)
Tokens já existem (shadcn: `bg-card`, `border-border`, `text-foreground`, `text-muted-foreground`, `bg-primary`). Falta **consistência**. Criar 3 primitivos compartilhados em `src/components/gestor/`:

1. **`PageHeader`** — título (noun phrase, sem "IA") + subtítulo curto + slot de ação à direita + **chip de créditos restantes** (lê `saldoCreditos`). Uma régua só de espaçamento (`px-4 lg:px-6 py-6`, `max-w-4xl`).
2. **`ResultSection`** — bloco de resultado padronizado (cabeçalho fino com `border-b`, corpo com espaçamento), some o "tudo é card".
3. **`EmptyState` / `ResultSkeleton`** — vazio com ícone + 1 frase + CTA; skeleton no formato do resultado (não spinner).

Escala única: radius `rounded-lg` (12px) em tudo; spacing em múltiplos de 4; `gap-3/4/6`. Travar (Shape/Color Consistency Lock da skill).

## Por tela
- **Analisar conversa** (`/ia/analise`): textarea → resultado. Nota A/B/C como **selo neutro** (sem semáforo gritante), perda em R$ `font-mono`, dimensões em lista `divide-y` (não 7 cards). Skeleton ao analisar.
- **Criar materiais** (`/ia/criar`): seletor de modo já ok; render do markdown num bloco tipográfico legível (prosa), com botão **Copiar**. Tirar o `pre` cru → tipografia de documento.
- **Analisar funil** (`/ia/funil`): métricas (pipeline/forecast/variância) como **stat row** (`font-mono`, sem caixinha), pauta em lista numerada, deals em risco em tabela enxuta (`divide-y`), sem barras de progresso com track cheio.
- **Avaliar time** (`/ia/time`): lista de vendedores `divide-y`; PDI com bandeira como selo discreto; coaching em seções (`ResultSection`), não cards empilhados.

## Faseamento
- **Fase 1 (já feita):** menu "Gestor Comercial" + verbos; remoção de "IA" dos h1.
- **Fase 2:** primitivos (`PageHeader`/`ResultSection`/`EmptyState`/`ResultSkeleton`) + chip de créditos no header.
- **Fase 3:** aplicar primitivos nas 4 telas; números em mono; listas em vez de cards; botão Copiar nos materiais.
- **Fase 4:** skeletons de loading + empty states; revisão de cópia (tirar "a IA faz", virar resultado).
- **Fase 5:** dark mode conferido nas 4 telas; pré-flight anti-tell (sem roxo/glow/emoji; um accent; um radius).

## Pré-flight anti-tell (checar antes de fechar)
Sem AI-purple/glow · um accent · um radius · números em mono · zero emoji nas telas do Gestor · h1 sem "IA" · estados loading/vazio/erro presentes · dark mode ok.
