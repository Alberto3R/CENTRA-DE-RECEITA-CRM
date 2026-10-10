// Revisão automática do agente de atendimento (ai_agente_avaliacoes,
// migration 110). Lê o TRECHO em que só o agente falava com o lead — da
// abertura até o consultor humano mandar a primeira mensagem — e responde o
// que a página "Resultado do agente" precisa: o lead respondeu? o agente
// descobriu os dados de qualificação? apresentou a oferta? passou pro
// consultor? nota e erro.
//
// O humano assumir cedo NÃO é erro do agente — foi o que distorceu a 1ª
// leitura das palestras da ILARF (out/2026): o consultor entrava ~45 min
// depois, com o lead ainda na 1ª resposta, e a nota caía na conta do agente.

import type { SupabaseClient } from '@supabase/supabase-js'
import { getAnthropic, MODELO_ANALISE } from '@/lib/ai/anthropic'
import { calcularCustoUsd } from '@/lib/ai/custo'
import { registrarUso } from '@/lib/ai/store'

export interface MensagemConversa {
  sender_type: string
  content_text: string | null
  template_name: string | null
  created_at: string
}

export interface CampoQualificacao {
  chave: string
  rotulo: string
  /** Valores possíveis; vazio = texto/número livre. */
  opcoes?: string[]
}

export interface Trecho {
  inicioAt: string
  origem: string
  /** Mensagens até o humano assumir (exclusive). */
  mensagens: MensagemConversa[]
  humanoAssumiuAt: string | null
  leadRespondeu: boolean
  respostaSeg: number | null
  msgsAgente: number
  msgsLead: number
  msgsHumano: number
  ultimaAt: string
}

/** 1ª mensagem do lead vira "origem": a mensagem pronta do QR/landing agrupa. */
export function normalizarOrigem(texto: string | null | undefined): string {
  return (texto ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48)
    .trim()
}

/**
 * Corta a conversa no ponto em que o consultor assumiu. `bot` é o agente,
 * `agent` é gente do time, `customer` é o lead. Sem mensagem do lead não há
 * atendimento do agente (ele só roda em resposta) — devolve null.
 */
export function segmentar(msgs: MensagemConversa[]): Trecho | null {
  const iLead = msgs.findIndex((m) => m.sender_type === 'customer')
  if (iLead < 0) return null
  const iHumano = msgs.findIndex((m, i) => i > iLead && m.sender_type === 'agent')
  const trecho = iHumano < 0 ? msgs : msgs.slice(0, iHumano)
  const iPrimeiroBot = trecho.findIndex((m, i) => i > iLead && m.sender_type === 'bot')
  const leadRespondeu =
    iPrimeiroBot >= 0 && trecho.some((m, i) => i > iPrimeiroBot && m.sender_type === 'customer')
  const inicio = msgs[iLead].created_at
  return {
    inicioAt: inicio,
    origem: normalizarOrigem(msgs[iLead].content_text),
    mensagens: trecho,
    humanoAssumiuAt: iHumano < 0 ? null : msgs[iHumano].created_at,
    leadRespondeu,
    respostaSeg:
      iPrimeiroBot < 0
        ? null
        : (Date.parse(trecho[iPrimeiroBot].created_at) - Date.parse(inicio)) / 1000,
    msgsAgente: msgs.filter((m) => m.sender_type === 'bot').length,
    msgsLead: msgs.filter((m) => m.sender_type === 'customer').length,
    msgsHumano: msgs.filter((m) => m.sender_type === 'agent').length,
    ultimaAt: msgs[msgs.length - 1].created_at,
  }
}

export function transcrever(trecho: Trecho): string {
  const linhas = trecho.mensagens.map((m) => {
    const quem = m.sender_type === 'customer' ? 'LEAD' : m.sender_type === 'bot' ? 'AGENTE' : 'EQUIPE'
    const texto = m.content_text ?? (m.template_name ? `[modelo ${m.template_name}]` : '[mídia]')
    return `${quem} [${m.created_at.slice(5, 16).replace('T', ' ')}]: ${texto}`
  })
  if (trecho.humanoAssumiuAt) linhas.push('--- aqui o consultor humano assumiu a conversa ---')
  const t = linhas.join('\n')
  return t.length > 24000 ? t.slice(t.length - 24000) : t
}

export interface Avaliacao {
  qualificacao: Record<string, string | number | null>
  qualificado: boolean
  apresentou_oferta: boolean
  agente_encaminhou: boolean
  interesse: 'alto' | 'medio' | 'baixo' | 'nenhum' | 'sem_sinal'
  dor: string
  erro: string
  nota: number
  resumo: string
}

const INTERESSES = ['alto', 'medio', 'baixo', 'nenhum', 'sem_sinal'] as const

export function lerAvaliacao(texto: string, campos: CampoQualificacao[]): Avaliacao | null {
  const ini = texto.indexOf('{')
  const fim = texto.lastIndexOf('}')
  if (ini < 0 || fim <= ini) return null
  let o: Record<string, unknown>
  try {
    o = JSON.parse(texto.slice(ini, fim + 1))
  } catch {
    return null
  }
  const q = (o.qualificacao ?? {}) as Record<string, unknown>
  const qualificacao: Record<string, string | number | null> = {}
  for (const c of campos) {
    const v = q[c.chave]
    qualificacao[c.chave] =
      typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null
  }
  const nota = Math.round(Number(o.nota))
  const interesse = INTERESSES.includes(o.interesse as (typeof INTERESSES)[number])
    ? (o.interesse as Avaliacao['interesse'])
    : 'sem_sinal'
  const txt = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  return {
    qualificacao,
    qualificado: o.qualificado === true,
    apresentou_oferta: o.apresentou_oferta === true,
    agente_encaminhou: o.agente_encaminhou === true,
    interesse,
    dor: txt(o.dor),
    erro: txt(o.erro),
    nota: nota >= 1 && nota <= 5 ? nota : 3,
    resumo: txt(o.resumo),
  }
}

function promptAvaliacao(
  instrucoes: string,
  campos: CampoQualificacao[],
  /** A conversa começou antes da versão atual das instruções. */
  anteriorAVersao: string | null,
): string {
  const lista = campos
    .map((c) => `- "${c.chave}" (${c.rotulo})${c.opcoes?.length ? `: escolha entre ${c.opcoes.join(' | ')}` : ''}`)
    .join('\n')
  // As instruções do agente vêm PRIMEIRO e as regras da revisão por último:
  // com as instruções no fim (16 mil caracteres), o revisor esquecia as
  // regras e culpava o agente por roteiro que mudou depois da conversa.
  return `Você revisa o trabalho de um agente de atendimento por WhatsApp. Abaixo estão as instruções que o agente segue HOJE. Depois vem a conversa a revisar.

<instrucoes_do_agente>
${instrucoes.slice(0, 16000)}
</instrucoes_do_agente>

# COMO REVISAR
Na conversa, AGENTE é o agente, LEAD é o cliente e EQUIPE são pessoas do time. Você vê só o trecho ANTES de o consultor humano assumir.

1. Avalie só o que o AGENTE fez dentro do que o lead permitiu. Lead que não respondeu não é erro do agente. Consultor assumir cedo não é erro do agente.
2. As instruções acima são a versão de HOJE e mudam a cada campanha. Se o lead veio de um evento, palestra, campanha ou produto que as instruções não citam, NADA disso é erro: não aponte "veio de outro congresso", "origem diferente", "não seguiu o roteiro do evento X". Nesses casos julgue só pelas falhas universais da regra 3.
3. "erro" é só o que prejudicou o atendimento ou a imagem da marca: inventou fato; disse que não tem algo que existe; ignorou o que o lead pediu; perguntou o que o lead já tinha respondido; várias perguntas na mesma mensagem; mensagens repetidas; respondeu mensagem automática; mostrou texto técnico (JSON, código) ao lead; falou preço ou condição quando as instruções proíbem. Estilo NÃO é erro (negrito, tamanho, dois balões, palavra de abertura, ordem das perguntas). Sem erro desse tipo, "erro" fica vazio.
4. "nota": 5 = fez tudo o que o lead permitiu; 4 = bom, com detalhe a melhorar; 3 = cumpriu o básico; 2 = erro que atrapalhou o lead; 1 = erro grave (fato falso, lead dispensado ou mal atendido).
5. "qualificado": o agente descobriu os dados essenciais de qualificação.
6. "agente_encaminhou": o agente passou ou anunciou que passaria a conversa para o consultor.
7. "dor": o que trava o lead na prática, nas palavras dele. Vazio se ele não disse.
8. Nunca invente dado que o lead não deu: use null.
${anteriorAVersao ? `9. ATENÇÃO: esta conversa é ANTERIOR à versão atual das instruções, que vale desde ${anteriorAVersao}. Na época o agente seguia outras instruções, com outro nome, outro roteiro e outras proibições. NÃO aponte como erro descumprir regra, nome, roteiro ou proibição que só existe nas instruções de hoje. O nome com que o agente se apresenta NUNCA é erro nessas conversas, nem perguntar o motivo do contato, nem a ordem das perguntas. Aponte só as falhas universais da regra 3 e dê a nota por elas.\n` : ''}
Dados de qualificação a extrair:
${lista || '- (nenhum definido)'}

Responda SÓ com JSON:
{"qualificacao": {${campos.map((c) => `"${c.chave}": ...`).join(', ')}}, "qualificado": bool, "apresentou_oferta": bool, "agente_encaminhou": bool, "interesse": "alto"|"medio"|"baixo"|"nenhum"|"sem_sinal", "dor": "", "erro": "", "nota": 1-5, "resumo": "1 frase para o gestor"}`
}

/**
 * Deduz das instruções do agente quais dados ele deve descobrir do lead.
 * Roda uma vez por agente; o resultado fica em ai_agent_config.qualificacao_campos.
 */
export async function deduzirCampos(
  instrucoes: string,
): Promise<{ campos: CampoQualificacao[]; tokensIn: number; tokensOut: number }> {
  const r = await getAnthropic().messages.create({
    model: MODELO_ANALISE,
    max_tokens: 600,
    system:
      'Leia as instruções de um agente de atendimento e liste de 2 a 5 dados que ele precisa descobrir do lead para qualificá-lo (perfil, momento, porte, necessidade...). Não inclua nome, telefone, e-mail nem a dor (já são tratados à parte). Responda SÓ com JSON: [{"chave": "snake_case", "rotulo": "Rótulo curto", "opcoes": ["valores possíveis em snake_case"] ou []}]',
    messages: [{ role: 'user', content: instrucoes.slice(0, 16000) }],
  })
  const texto = r.content.find((b) => b.type === 'text')?.text ?? '[]'
  let campos: CampoQualificacao[] = []
  try {
    const arr = JSON.parse(texto.slice(texto.indexOf('['), texto.lastIndexOf(']') + 1)) as unknown[]
    campos = arr
      .filter((c): c is CampoQualificacao => !!c && typeof (c as CampoQualificacao).chave === 'string')
      .slice(0, 5)
      .map((c) => ({ chave: c.chave, rotulo: c.rotulo || c.chave, opcoes: c.opcoes ?? [] }))
  } catch {
    campos = []
  }
  return { campos, tokensIn: r.usage.input_tokens, tokensOut: r.usage.output_tokens }
}

/** Avalia uma conversa e grava em ai_agente_avaliacoes. Precisa do client admin. */
export async function avaliarConversa(
  db: SupabaseClient,
  p: { conversationId: string; accountId: string; agentId: string | null },
): Promise<'avaliada' | 'sem_trecho' | 'falhou'> {
  const [{ data: conv }, { data: msgs }, { data: cfg }] = await Promise.all([
    db.from('conversations').select('contact_id').eq('id', p.conversationId).maybeSingle(),
    db
      .from('messages')
      .select('sender_type, content_text, template_name, created_at')
      .eq('conversation_id', p.conversationId)
      .order('created_at')
      .limit(400),
    p.agentId
      ? db
          .from('ai_agent_config')
          .select('system_prompt, qualificacao_campos, updated_at')
          .eq('id', p.agentId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const trecho = segmentar((msgs ?? []) as MensagemConversa[])
  if (!trecho) return 'sem_trecho'

  const instrucoes = (cfg as { system_prompt?: string } | null)?.system_prompt ?? ''
  let campos = (cfg as { qualificacao_campos?: CampoQualificacao[] | null } | null)
    ?.qualificacao_campos
  let custo = 0
  if (!campos && instrucoes && p.agentId) {
    const d = await deduzirCampos(instrucoes)
    custo += calcularCustoUsd(MODELO_ANALISE, d.tokensIn, d.tokensOut)
    // Várias revisões em paralelo podem deduzir ao mesmo tempo, cada uma com
    // chaves diferentes ("segmento" × "segmento_atuacao"): só grava quem chegar
    // primeiro e todo mundo usa o que ficou gravado.
    await db
      .from('ai_agent_config')
      .update({ qualificacao_campos: d.campos })
      .eq('id', p.agentId)
      .is('qualificacao_campos', null)
    const { data: gravado } = await db
      .from('ai_agent_config')
      .select('qualificacao_campos')
      .eq('id', p.agentId)
      .maybeSingle()
    campos =
      (gravado as { qualificacao_campos?: CampoQualificacao[] | null } | null)?.qualificacao_campos ??
      d.campos
  }
  campos = campos ?? []
  const versaoDesde = (cfg as { updated_at?: string } | null)?.updated_at ?? null
  const anteriorAVersao =
    versaoDesde && trecho.inicioAt < versaoDesde
      ? new Date(versaoDesde).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
      : null

  const r = await getAnthropic().messages.create({
    model: MODELO_ANALISE,
    max_tokens: 700,
    system: promptAvaliacao(instrucoes, campos, anteriorAVersao),
    messages: [
      {
        role: 'user',
        content: `Conversa de ${trecho.inicioAt.slice(0, 10)}.\n\n${transcrever(trecho)}`,
      },
    ],
  })
  custo += calcularCustoUsd(MODELO_ANALISE, r.usage.input_tokens, r.usage.output_tokens)
  await registrarUso({
    accountId: p.accountId,
    capacidade: 'agente.avaliacao',
    uso: { modelo: MODELO_ANALISE, tokens_in: r.usage.input_tokens, tokens_out: r.usage.output_tokens },
    custoUsd: custo,
  })
  const av = lerAvaliacao(r.content.find((b) => b.type === 'text')?.text ?? '', campos)
  if (!av) return 'falhou'

  const { error } = await db.from('ai_agente_avaliacoes').upsert({
    conversation_id: p.conversationId,
    account_id: p.accountId,
    agent_id: p.agentId,
    contact_id: (conv as { contact_id?: string } | null)?.contact_id ?? null,
    origem: trecho.origem || null,
    inicio_at: trecho.inicioAt,
    humano_assumiu_at: trecho.humanoAssumiuAt,
    msgs_agente: trecho.msgsAgente,
    msgs_lead: trecho.msgsLead,
    msgs_humano: trecho.msgsHumano,
    resposta_seg: trecho.respostaSeg,
    lead_respondeu: trecho.leadRespondeu,
    qualificado: av.qualificado,
    qualificacao: av.qualificacao,
    apresentou_oferta: av.apresentou_oferta,
    agente_encaminhou: av.agente_encaminhou,
    interesse: av.interesse,
    dor: av.dor || null,
    erro: av.erro || null,
    nota: av.nota,
    resumo: av.resumo || null,
    avaliado_ate: trecho.ultimaAt,
    avaliado_em: new Date().toISOString(),
    modelo: MODELO_ANALISE,
    custo_usd: custo,
  })
  if (error) {
    console.error('[agente-avaliacao] gravar falhou:', error.message)
    return 'falhou'
  }
  return 'avaliada'
}
