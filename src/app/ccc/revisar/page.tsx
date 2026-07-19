'use client'

import { useCallback, useEffect, useState } from 'react'

// Console do consultor 3R — revisar os entregáveis de um diagnóstico antes do
// go-live. Um agente 3R gera (diagnóstico + playbook + scripts + régua) e, se
// marcado, já monta o funil na conta. O consultor pode EDITAR o texto e APROVAR.
// Chama /api/ccc/processar (gerar) e /api/ccc/entregaveis (carregar/salvar/aprovar).

interface Funil {
  ok: boolean
  pipeline_id?: string
  nome?: string
  etapas?: { name: string; is_connection: boolean }[]
  reused?: boolean
  error?: string
}

type Status = 'rascunho' | 'aprovado'

export default function RevisarPage() {
  const [diagnosticoId, setDiagnosticoId] = useState('')
  const [transcricao, setTranscricao] = useState('')
  const [montarFunil, setMontarFunil] = useState(false)
  const [accountId, setAccountId] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')
  const [funil, setFunil] = useState<Funil | null>(null)

  // entregável carregado/gerado (editável)
  const [entregavelId, setEntregavelId] = useState<string | null>(null)
  const [conteudoMd, setConteudoMd] = useState('')
  const [status, setStatus] = useState<Status>('rascunho')
  const [salvo, setSalvo] = useState(true) // false = há edição não salva
  const [salvando, setSalvando] = useState(false)
  const [feedback, setFeedback] = useState('')

  // setup dos templates HSM na Meta
  const [criandoTpl, setCriandoTpl] = useState(false)
  const [tplMsg, setTplMsg] = useState('')

  // carrega o entregável mais recente de um diagnóstico (se já existe)
  const carregarExistente = useCallback(async (id: string) => {
    if (!id.trim()) return
    try {
      const res = await fetch(
        `/api/ccc/entregaveis?diagnostico_id=${encodeURIComponent(id.trim())}`,
      )
      const data = await res.json()
      if (res.ok && data.entregavel) {
        setEntregavelId(data.entregavel.id)
        setConteudoMd(data.entregavel.conteudo_md || '')
        setStatus(data.entregavel.status === 'aprovado' ? 'aprovado' : 'rascunho')
        setSalvo(true)
        setFunil(null)
        setFeedback('')
      }
    } catch {
      /* silencioso — se não houver pacote ainda, o consultor gera */
    }
  }, [])

  // pré-preenche o id se veio em ?id= e tenta carregar o pacote existente
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const id = params.get('id')
    if (id) {
      setDiagnosticoId(id)
      carregarExistente(id)
    }
  }, [carregarExistente])

  async function processar() {
    if (!diagnosticoId.trim()) {
      setErro('Informe o ID do diagnóstico.')
      return
    }
    setCarregando(true)
    setErro('')
    setFeedback('')
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
      setEntregavelId(data.entregavel_id ?? null)
      setConteudoMd(data.conteudo_md || '')
      setStatus('rascunho')
      setSalvo(true)
      setFunil(data.funil ?? null)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao processar.')
    } finally {
      setCarregando(false)
    }
  }

  async function salvarPatch(payload: { conteudo_md?: string; status?: Status }) {
    if (!entregavelId) return
    setSalvando(true)
    setFeedback('')
    try {
      const res = await fetch('/api/ccc/entregaveis', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entregavel_id: entregavelId, ...payload }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar.')
      setStatus(data.entregavel.status === 'aprovado' ? 'aprovado' : 'rascunho')
      setSalvo(true)
      setFeedback(
        payload.status === 'aprovado'
          ? 'Pacote aprovado ✅'
          : payload.status === 'rascunho'
            ? 'Reaberto para edição'
            : 'Edição salva ✅',
      )
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Erro ao salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function criarTemplates() {
    setCriandoTpl(true)
    setTplMsg('')
    try {
      const res = await fetch('/api/ccc/criar-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao criar templates.')
      const r = ((data.resultados ?? [])[0] ?? {}) as {
        ok?: boolean
        template?: string
        status?: string
        erro?: string
      }
      setTplMsg(
        r.ok
          ? `Template ${r.template} enviado pra Meta (${r.status ?? 'submitted'}). Aprovação leva de minutos a horas.`
          : `Meta recusou: ${r.erro ?? 'sem detalhe'}`,
      )
    } catch (e) {
      setTplMsg(e instanceof Error ? e.message : 'Erro ao criar templates.')
    } finally {
      setCriandoTpl(false)
    }
  }

  const inputBase =
    'w-full rounded-[10px] border border-white/15 bg-[#08120E] px-3.5 py-3 text-[15px] text-[#EAF3EC] outline-none placeholder:text-[#6E857A] focus:border-[#10B981]'

  return (
    <main className="min-h-screen bg-[#08120E] text-[#EAF3EC]">
      <div className="mx-auto max-w-3xl px-5 py-12">
        <a
          href="/dashboard"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-[#9FB4A8] transition-colors hover:text-[#34D399]"
        >
          ← Voltar pro CRM
        </a>
        <header className="mb-8">
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-[#10B981]">
            Console do consultor · 3R
          </span>
          <h1 className="mt-3 text-3xl font-extrabold">Revisar entregáveis</h1>
          <p className="mt-3 text-[#9FB4A8]">
            Um agente 3R gera o diagnóstico, o playbook, os scripts e a régua a
            partir do formulário e da transcrição do kickoff. Revise e edite o
            texto, aprove antes do go-live — e, se quiser, já monte o funil na
            conta.
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
            {carregando
              ? 'Um agente 3R está trabalhando nisso agora…'
              : conteudoMd
                ? 'Gerar de novo →'
                : 'Gerar e revisar →'}
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
              <>
                <p className="mt-2 text-[#EAF3EC]">
                  ✅ Pipeline <b>{funil.nome}</b>{' '}
                  {funil.reused ? 'já existia (reusado, sem duplicar)' : 'criado'}{' '}
                  com {funil.etapas?.length ?? 0} etapas —{' '}
                  <span className="text-[#34D399]">
                    {funil.etapas?.map((e) => e.name).join(' → ')}
                  </span>
                </p>
                <a
                  href="/pipelines"
                  className="mt-2 inline-block text-sm text-[#34D399] underline-offset-2 hover:underline"
                >
                  Ver funil no CRM →
                </a>
              </>
            ) : (
              <p className="mt-2 text-[#dc6a54]">Funil não criado: {funil.error}</p>
            )}
          </section>
        )}

        {conteudoMd && (
          <section className="mt-6 rounded-2xl border border-white/15 bg-[#0F211A] p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-[#6E857A]">
                Entregáveis (editar e aprovar)
              </h2>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                  status === 'aprovado'
                    ? 'bg-[#10B981]/15 text-[#34D399]'
                    : 'bg-[#E0A43B]/15 text-[#E0A43B]'
                }`}
              >
                {status === 'aprovado' ? '✅ Aprovado' : '● Rascunho'}
              </span>
            </div>

            <textarea
              className={`${inputBase} min-h-[420px] resize-y font-sans leading-relaxed`}
              value={conteudoMd}
              onChange={(e) => {
                setConteudoMd(e.target.value)
                setSalvo(false)
              }}
            />

            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              <button
                onClick={() => salvarPatch({ conteudo_md: conteudoMd })}
                disabled={salvando || salvo || !entregavelId}
                className="rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-[#EAF3EC] transition-colors hover:border-[#34D399] disabled:opacity-40"
              >
                {salvando ? 'Salvando…' : salvo ? 'Salvo' : 'Salvar edição'}
              </button>

              {status === 'rascunho' ? (
                <button
                  onClick={() =>
                    salvarPatch({ conteudo_md: conteudoMd, status: 'aprovado' })
                  }
                  disabled={salvando || !entregavelId}
                  className="rounded-lg bg-gradient-to-b from-[#34D399] to-[#10B981] px-4 py-2 text-sm font-bold text-[#04231A] transition-transform hover:-translate-y-0.5 disabled:opacity-50"
                >
                  Aprovar pacote
                </button>
              ) : (
                <button
                  onClick={() => salvarPatch({ status: 'rascunho' })}
                  disabled={salvando || !entregavelId}
                  className="rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-[#9FB4A8] transition-colors hover:border-[#E0A43B] hover:text-[#E0A43B] disabled:opacity-40"
                >
                  Reabrir para edição
                </button>
              )}

              {feedback && (
                <span className="text-sm text-[#9FB4A8]">{feedback}</span>
              )}
            </div>
          </section>
        )}

        <section className="mt-6 rounded-2xl border border-white/10 bg-[#0B1712] p-5">
          <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-[#6E857A]">
            Setup · templates da Meta
          </h2>
          <p className="mt-2 text-sm text-[#9FB4A8]">
            Cria o template HSM <code className="text-[#EAF3EC]">ccc_toque_cadencia</code>{' '}
            (usado pelo motor de cadência pra cobrar o vendedor) na Meta, com o
            WhatsApp já conectado no CRM. Faça uma vez.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <button
              onClick={criarTemplates}
              disabled={criandoTpl}
              className="rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-[#EAF3EC] transition-colors hover:border-[#34D399] disabled:opacity-50"
            >
              {criandoTpl ? 'Enviando pra Meta…' : 'Criar template de cadência na Meta'}
            </button>
            {tplMsg && <span className="text-sm text-[#9FB4A8]">{tplMsg}</span>}
          </div>
        </section>
      </div>
    </main>
  )
}
