'use client'

import { useEffect, useState } from 'react'

// Console do consultor 3R — revisar os entregáveis de um diagnóstico antes do
// go-live. Um agente 3R gera (diagnóstico + playbook + scripts + régua) e, se
// marcado, já monta o funil na conta. Chama /api/ccc/processar.

interface Funil {
  ok: boolean
  pipeline_id?: string
  nome?: string
  etapas?: { name: string; is_connection: boolean }[]
  error?: string
}

export default function RevisarPage() {
  const [diagnosticoId, setDiagnosticoId] = useState('')
  const [transcricao, setTranscricao] = useState('')
  const [montarFunil, setMontarFunil] = useState(false)
  const [accountId, setAccountId] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')
  const [conteudoMd, setConteudoMd] = useState('')
  const [funil, setFunil] = useState<Funil | null>(null)

  // pré-preenche o id se veio em ?id=
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const id = params.get('id')
    if (id) setDiagnosticoId(id)
  }, [])

  async function processar() {
    if (!diagnosticoId.trim()) {
      setErro('Informe o ID do diagnóstico.')
      return
    }
    setCarregando(true)
    setErro('')
    setConteudoMd('')
    setFunil(null)
    try {
      const res = await fetch('/api/ccc/processar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          diagnostico_id: diagnosticoId.trim(),
          transcricao: transcricao.trim() || undefined,
          montar_funil: montarFunil,
          account_id: accountId.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao processar.')
      setConteudoMd(data.conteudo_md || '')
      setFunil(data.funil ?? null)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao processar.')
    } finally {
      setCarregando(false)
    }
  }

  const inputBase =
    'w-full rounded-[10px] border border-white/15 bg-[#08120E] px-3.5 py-3 text-[15px] text-[#EAF3EC] outline-none placeholder:text-[#6E857A] focus:border-[#10B981]'

  return (
    <main className="min-h-screen bg-[#08120E] text-[#EAF3EC]">
      <div className="mx-auto max-w-3xl px-5 py-12">
        <header className="mb-8">
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-[#10B981]">
            Console do consultor · 3R
          </span>
          <h1 className="mt-3 text-3xl font-extrabold">Revisar entregáveis</h1>
          <p className="mt-3 text-[#9FB4A8]">
            Um agente 3R gera o diagnóstico, o playbook, os scripts e a régua a
            partir do formulário e da transcrição do kickoff. Revise antes do
            go-live — e, se quiser, já monte o funil na conta.
          </p>
        </header>

        <section className="flex flex-col gap-4 rounded-2xl border border-white/15 bg-[#0F211A] p-5">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-semibold">ID do diagnóstico *</span>
            <input
              className={inputBase}
              value={diagnosticoId}
              onChange={(e) => setDiagnosticoId(e.target.value)}
              placeholder="uuid do ccc_diagnosticos"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-semibold">
              Transcrição do kickoff{' '}
              <span className="font-normal text-[#6E857A]">(opcional)</span>
            </span>
            <textarea
              className={`${inputBase} min-h-[110px] resize-y`}
              value={transcricao}
              onChange={(e) => setTranscricao(e.target.value)}
              placeholder="Cole aqui a transcrição da call (Meet + Gemini)…"
            />
          </label>

          <label className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={montarFunil}
              onChange={(e) => setMontarFunil(e.target.checked)}
              className="h-4 w-4 accent-[#10B981]"
            />
            Já montar o funil na conta (passo 3)
          </label>

          {montarFunil && (
            <label className="flex flex-col gap-2">
              <span className="text-sm font-semibold">ID da conta (account_id)</span>
              <input
                className={inputBase}
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder="uuid da conta do cliente"
              />
            </label>
          )}

          {erro && <p className="text-sm text-[#dc6a54]">{erro}</p>}

          <button
            onClick={processar}
            disabled={carregando}
            className="mt-1 rounded-xl bg-gradient-to-b from-[#34D399] to-[#10B981] px-6 py-3.5 text-base font-bold text-[#04231A] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
          >
            {carregando ? 'Um agente 3R está gerando…' : 'Gerar e revisar →'}
          </button>
        </section>

        {funil && (
          <section
            className={`mt-6 rounded-2xl border p-5 ${funil.ok ? 'border-[#10B981]' : 'border-[#dc6a54]'}`}
          >
            <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-[#6E857A]">
              Funil
            </h2>
            {funil.ok ? (
              <p className="mt-2 text-[#EAF3EC]">
                ✅ Pipeline <b>{funil.nome}</b> criado com{' '}
                {funil.etapas?.length ?? 0} etapas —{' '}
                <span className="text-[#34D399]">
                  {funil.etapas?.map((e) => e.name).join(' → ')}
                </span>
              </p>
            ) : (
              <p className="mt-2 text-[#dc6a54]">Funil não criado: {funil.error}</p>
            )}
          </section>
        )}

        {conteudoMd && (
          <section className="mt-6 rounded-2xl border border-white/15 bg-[#0F211A] p-5">
            <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.16em] text-[#6E857A]">
              Entregáveis gerados (revisar)
            </h2>
            <pre className="overflow-x-auto whitespace-pre-wrap font-sans text-sm leading-relaxed text-[#EAF3EC]">
              {conteudoMd}
            </pre>
          </section>
        )}
      </div>
    </main>
  )
}
