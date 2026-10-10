// Contexto do lead para o agente: o que ele já respondeu antes de chegar no
// WhatsApp (formulário do anúncio, formulário da página, calculadora). Vai
// junto da mensagem do agente para ele não perguntar de novo.
//
// Até out/2026 só a calculadora da Augra chegava ao agente. As respostas do
// formulário nativo da Meta e do webhook de página eram gravadas em
// lead_attribution.raw e nunca lidas: o funil da Logos pergunta formação,
// momento e investimento no anúncio, e o agente teria perguntado tudo de novo.

const money = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? 'R$ ' + Math.round(n).toLocaleString('pt-BR') : '—'
}

function calculadora(raw: Record<string, unknown>): string {
  const lines = [
    'CONTEXTO DO LEAD (veio da Calculadora de Vaga Aberta da Augra — já temos estes dados, NÃO pergunte de novo):',
    `- Vaga: ${raw.cargo_vaga ?? '—'}${raw.qtd_vagas_abertas ? ` (×${raw.qtd_vagas_abertas})` : ''}`,
    raw.dias_vaga_aberta != null ? `- Aberta há: ${raw.dias_vaga_aberta} dias` : '',
    raw.salario_anunciado != null ? `- Salário anunciado: ${money(raw.salario_anunciado)}` : '',
    raw.custo_estimado_mensal != null
      ? `- Perda estimada (estimativa de mercado): ${money(raw.custo_estimado_mensal)}/mês`
      : '',
    raw.empresa ? `- Empresa: ${raw.empresa}` : '',
    'Use isso pra personalizar a conversa e conduzir pro diagnóstico/recrutamento.',
  ]
  return lines.filter(Boolean).join('\n')
}

// Campos técnicos ou que o agente não deve repetir para o lead.
const IGNORAR =
  /^(leadgen_id|form_id|ad_id|adset_id|campaign_id|page_id|token|origem|source|fbclid|gclid|ttclid|fbp|fbc|ip|user_agent|event_id|event_source_url|landing_url|referrer|consent.*|lgpd.*|utm_.*|telefone|phone|phone_number|whatsapp|celular|cpf)$/i

// "qual_a_sua_formação?" → "Qual a sua formação?"
function rotulo(chave: string): string {
  const t = chave.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

// Slug da Meta ("de_r$_500_a_r$_1.000") → texto ("de r$ 500 a r$ 1.000").
function valor(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'object') return null
  const t = String(v).replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t) return null
  return t.length > 200 ? t.slice(0, 200) + '…' : t
}

export function leadContextFrom(
  raw: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!raw) return undefined
  if (raw.origem === 'calculadora-vaga-aberta') return calculadora(raw)

  const linhas: string[] = []
  for (const [k, v] of Object.entries(raw)) {
    if (IGNORAR.test(k)) continue
    const t = valor(v)
    if (!t) continue
    linhas.push(`- ${rotulo(k)}: ${t}`)
    if (linhas.length >= 15) break
  }
  if (linhas.length === 0) return undefined
  return [
    'CONTEXTO DO LEAD (respostas do formulário que a pessoa preencheu antes de chegar aqui — já temos estes dados, NÃO pergunte de novo; use para personalizar):',
    ...linhas,
  ].join('\n')
}
