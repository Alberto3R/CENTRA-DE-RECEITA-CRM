# Golden Set — Análise de Call (gate de qualidade da IA)

Gabarito de qualidade do módulo de **Análise de IA** do produto unificado (CRM +
IA de gestão comercial). Garante que o prompt `v1` continua entregando análises
das 7 dimensões (preset 3R) sem alucinar números e sempre com prescrição acionável.

> **Regra dura (CI):** mudou prompt em `src/lib/ai/prompts/*` → rode o eval verde
> antes de abrir PR. Nenhum módulo de IA entra sem isso (ver o plano de fusão).

## Como rodar

Pré-requisito: deps instaladas e uma `ANTHROPIC_API_KEY` válida.

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run eval -- caminho/transcricao.txt
```

O script roda o prompt v1 (mesmo system prompt + tool da app) contra
`claude-sonnet-4-6` com `tool_choice` forçado, imprime o JSON e o placar
`passed / failed`, e sai com código `1` se algum check falhar.

## Rubrica automática

| # | Check | O que protege |
|---|-------|---------------|
| 1 | Cobertura das 7 dimensões | Análise completa, não parcial |
| 2 | Toda evidência tem timestamp não-vazio | Anti-alucinação: sem evidência fantasma |
| 3 | `perda != null` ⇒ `perda_memoria_calculo` presente | Anti-alucinação: nenhuma perda em R$ sem a conta |

## Samples

Guarde transcrições de referência em `samples/` (ex.: `gericlass.txt`). 

> ⚠️ **LGPD:** não versione transcrições com PII real (nomes, telefones, valores)
> sem anonimizar. Vale também para o golden set.

## Mercado aberto

O eval cobre o **preset 3R** (default de fábrica). Para uma conta com método
customizado (`account_sales_config`), rode também uma variação do eval com as
dimensões da conta antes de promover mudanças de prompt — o objetivo é não
regredir nem o 3R nem os presets alternativos.
