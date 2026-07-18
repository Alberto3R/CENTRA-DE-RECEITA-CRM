'use client'

import { useState, type FormEvent } from 'react'

// Formulário de Diagnóstico Comercial — Central de Comando Comercial.
// Público (sem sessão). Posta as respostas em /api/diagnostico (service role).
// Data-driven: as perguntas vivem em SECOES; o render é genérico por tipo.

type Campo = {
  id: string
  label: string
  tipo: 'text' | 'textarea' | 'chips' | 'multi'
  opcoes?: string[]
  hint?: string
}

const SECOES: { titulo: string; campos: Campo[] }[] = [
  {
    titulo: 'Seu negócio',
    campos: [
      { id: 'o_que_vende', label: 'O que sua empresa vende, e pra quem?', tipo: 'text' },
      { id: 'ticket', label: 'Ticket médio', tipo: 'chips', opcoes: ['Até R$ 1k', 'R$ 1–5k', 'R$ 5–20k', 'R$ 20k+'] },
      { id: 'ciclo', label: 'Ciclo de venda (do 1º contato ao fechamento)', tipo: 'chips', opcoes: ['Dias', '1–2 semanas', '3–4 semanas', '1 mês+'] },
      { id: 'faturamento', label: 'Faturamento/mês do comercial hoje', tipo: 'chips', opcoes: ['Até R$ 50k', 'R$ 50–150k', 'R$ 150–500k', 'R$ 500k+'] },
    ],
  },
  {
    titulo: 'Seus leads',
    campos: [
      { id: 'origem_leads', label: 'De onde vêm seus leads hoje?', tipo: 'multi', opcoes: ['Indicação', 'Tráfego pago', 'Prospecção ativa', 'Orgânico', 'Não sei'] },
      { id: 'leads_mes', label: 'Quantos leads novos entram por mês?', tipo: 'chips', opcoes: ['Até 20', '20–50', '50–150', '150+', 'Não sei'] },
    ],
  },
  {
    titulo: 'Seu funil hoje',
    campos: [
      { id: 'usa_crm', label: 'Você usa CRM hoje?', tipo: 'chips', opcoes: ['Sim, e o time usa', 'Sim, mas ninguém usa', 'Planilha', 'Caderno / cabeça', 'Nada'] },
      { id: 'sabe_lead_conversa', label: 'Sabe quantos leads viram conversa com o decisor?', tipo: 'chips', opcoes: ['Sei de cabeça', 'Sei se pesquisar', 'Não sei'] },
      { id: 'sabe_conversa_venda', label: 'Sabe quantas dessas conversas viram venda?', tipo: 'chips', opcoes: ['Sei de cabeça', 'Sei se pesquisar', 'Não sei'] },
      { id: 'follow_up_visivel', label: 'Quando um vendedor não faz o follow-up, você fica sabendo?', tipo: 'chips', opcoes: ['Sempre', 'Às vezes', 'Nunca'] },
    ],
  },
  {
    titulo: 'Seu time',
    campos: [
      { id: 'num_vendedores', label: 'Quantas pessoas no time comercial?', tipo: 'chips', opcoes: ['Só eu', '1–3', '4–8', '9+'] },
      { id: 'cobra_time', label: 'Como você cobra o time hoje? Tem meta clara e acompanhamento?', tipo: 'textarea' },
      { id: 'melhor_pior', label: 'Consegue dizer seu melhor e pior vendedor com número (não "acho")?', tipo: 'chips', opcoes: ['Sim, com número', 'Só no achismo', 'Não sei'] },
    ],
  },
  {
    titulo: 'Seus números',
    campos: [
      { id: 'numeros_olha', label: 'Que números do comercial você olha, e com que frequência?', tipo: 'textarea' },
      { id: 'taxa_de_cabeca', label: 'Sabe sua taxa de conversão de cabeça agora?', tipo: 'chips', opcoes: ['Sim', 'Não'] },
    ],
  },
  {
    titulo: 'O que você já tentou',
    campos: [
      { id: 'ja_tentou', label: 'O que já tentou pra resolver isso?', tipo: 'multi', opcoes: ['Curso', 'Mentoria', 'Contratar gestor', 'Consultoria', 'Nada ainda'] },
      { id: 'quanto_gastou', label: 'Quanto já investiu nisso (curso/mentoria/consultoria)?', tipo: 'chips', opcoes: ['Nada', 'Até R$ 5k', 'R$ 5–20k', 'R$ 20–50k', 'R$ 50k+'] },
      { id: 'mentoria_mudou', label: 'Se já fez mentoria/curso: mudou algo de verdade na operação?', tipo: 'chips', opcoes: ['Sim, mudou', 'Pouco', 'Não mudou nada', 'Não se aplica'] },
      { id: 'perde_mes', label: 'Quanto você acha que perde por mês por desorganização/follow-up?', tipo: 'chips', opcoes: ['Não sei dizer', 'Até R$ 5k', 'R$ 5–20k', 'R$ 20k+'] },
    ],
  },
  {
    titulo: 'Prontidão',
    campos: [
      { id: 'por_que_agora', label: 'Por que resolver isso agora? O que muda se ficar mais 6 meses assim?', tipo: 'textarea' },
      { id: 'decisor', label: 'A decisão de investir nisso é só sua?', tipo: 'chips', opcoes: ['Só minha', 'Tenho sócio', 'Preciso alinhar'] },
      { id: 'comecar', label: 'Se fizer sentido, consegue começar nas próximas semanas?', tipo: 'chips', opcoes: ['Sim', 'Talvez', 'Não agora'] },
    ],
  },
]

export default function DiagnosticoPage() {
  const [contato, setContato] = useState({ nome: '', empresa: '', whatsapp: '' })
  const [respostas, setRespostas] = useState<Record<string, string | string[]>>({})
  const [enviando, setEnviando] = useState(false)
  const [ok, setOk] = useState(false)
  const [erro, setErro] = useState('')

  function setResp(id: string, val: string) {
    setRespostas((r) => ({ ...r, [id]: val }))
  }
  function toggleMulti(id: string, val: string) {
    setRespostas((r) => {
      const atual = Array.isArray(r[id]) ? (r[id] as string[]) : []
      const novo = atual.includes(val) ? atual.filter((v) => v !== val) : [...atual, val]
      return { ...r, [id]: novo }
    })
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!contato.nome.trim() || !contato.whatsapp.trim()) {
      setErro('Preencha ao menos seu nome e WhatsApp.')
      return
    }
    setEnviando(true)
    setErro('')
    try {
      const res = await fetch('/api/diagnostico', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...contato, respostas }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao enviar.')
      setOk(true)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao enviar.')
    } finally {
      setEnviando(false)
    }
  }

  const chipBase =
    'cursor-pointer select-none rounded-[10px] border px-3.5 py-2.5 text-sm transition-colors'
  const inputBase =
    'w-full rounded-[10px] border border-white/15 bg-[#08120E] px-3.5 py-3 text-[15px] text-[#EAF3EC] outline-none placeholder:text-[#6E857A] focus:border-[#10B981]'

  if (ok) {
    return (
      <main className="min-h-screen bg-[#08120E] text-[#EAF3EC] grid place-items-center px-6">
        <div className="max-w-md text-center">
          <div className="text-5xl">✅</div>
          <h1 className="mt-4 text-2xl font-extrabold">Diagnóstico recebido!</h1>
          <p className="mt-3 text-[#9FB4A8]">
            Um agente 3R já está montando o raio-x do seu comercial. A gente te
            chama no WhatsApp com os próximos passos.
          </p>
          <p className="mt-6 font-mono text-sm tracking-widest text-[#10B981]">
            #EUVENDOTODODIA
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#08120E] text-[#EAF3EC]">
      <div className="mx-auto max-w-2xl px-5 py-12">
        <header className="mb-8">
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-[#10B981]">
            Central de Comando Comercial · 3R
          </span>
          <h1 className="mt-3 text-3xl font-extrabold leading-tight">
            Diagnóstico do seu comercial
          </h1>
          <p className="mt-3 text-[#9FB4A8]">
            5 minutos honestos sobre como você vende hoje. É a partir daqui que um
            agente 3R monta o raio-x do seu funil.
          </p>
        </header>

        <form onSubmit={submit} className="flex flex-col gap-8">
          {/* contato */}
          <section className="rounded-2xl border border-white/15 bg-[#0F211A] p-5">
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-2">
                <span className="text-sm font-semibold">Seu nome *</span>
                <input
                  className={inputBase}
                  value={contato.nome}
                  onChange={(e) => setContato({ ...contato, nome: e.target.value })}
                  placeholder="Como te chamam?"
                  required
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-sm font-semibold">Sua empresa</span>
                <input
                  className={inputBase}
                  value={contato.empresa}
                  onChange={(e) => setContato({ ...contato, empresa: e.target.value })}
                  placeholder="Nome da empresa"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-sm font-semibold">Seu WhatsApp *</span>
                <input
                  className={inputBase}
                  value={contato.whatsapp}
                  onChange={(e) => setContato({ ...contato, whatsapp: e.target.value })}
                  placeholder="(DDD) 9 9999-9999"
                  inputMode="tel"
                  required
                />
              </label>
            </div>
          </section>

          {/* seções data-driven */}
          {SECOES.map((secao) => (
            <section key={secao.titulo} className="flex flex-col gap-5">
              <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-[#6E857A]">
                {secao.titulo}
              </h2>
              {secao.campos.map((campo) => (
                <div key={campo.id} className="flex flex-col gap-2.5">
                  <span className="text-sm font-semibold">{campo.label}</span>
                  {campo.hint && (
                    <span className="text-xs text-[#6E857A]">{campo.hint}</span>
                  )}

                  {campo.tipo === 'text' && (
                    <input
                      className={inputBase}
                      value={(respostas[campo.id] as string) || ''}
                      onChange={(e) => setResp(campo.id, e.target.value)}
                    />
                  )}

                  {campo.tipo === 'textarea' && (
                    <textarea
                      className={`${inputBase} min-h-[80px] resize-y`}
                      value={(respostas[campo.id] as string) || ''}
                      onChange={(e) => setResp(campo.id, e.target.value)}
                    />
                  )}

                  {campo.tipo === 'chips' && (
                    <div className="flex flex-wrap gap-2">
                      {campo.opcoes!.map((op) => {
                        const on = respostas[campo.id] === op
                        return (
                          <button
                            type="button"
                            key={op}
                            onClick={() => setResp(campo.id, op)}
                            className={`${chipBase} ${
                              on
                                ? 'border-[#10B981] bg-[#04231A] font-semibold text-[#34D399]'
                                : 'border-white/15 bg-[#08120E] text-[#9FB4A8] hover:border-[#10B981]'
                            }`}
                          >
                            {op}
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {campo.tipo === 'multi' && (
                    <div className="flex flex-wrap gap-2">
                      {campo.opcoes!.map((op) => {
                        const arr = Array.isArray(respostas[campo.id])
                          ? (respostas[campo.id] as string[])
                          : []
                        const on = arr.includes(op)
                        return (
                          <button
                            type="button"
                            key={op}
                            onClick={() => toggleMulti(campo.id, op)}
                            className={`${chipBase} ${
                              on
                                ? 'border-[#10B981] bg-[#04231A] font-semibold text-[#34D399]'
                                : 'border-white/15 bg-[#08120E] text-[#9FB4A8] hover:border-[#10B981]'
                            }`}
                          >
                            {op}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}
            </section>
          ))}

          {erro && <p className="text-sm text-[#dc6a54]">{erro}</p>}

          <button
            type="submit"
            disabled={enviando}
            className="rounded-xl bg-gradient-to-b from-[#34D399] to-[#10B981] px-6 py-4 text-base font-bold text-[#04231A] shadow-[0_10px_30px_rgba(16,185,129,0.2)] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
          >
            {enviando ? 'Enviando…' : 'Enviar meu diagnóstico →'}
          </button>
          <p className="text-center font-mono text-xs tracking-wide text-[#6E857A]">
            Suas respostas vão direto pra um agente 3R montar seu raio-x.
          </p>
        </form>
      </div>
    </main>
  )
}
