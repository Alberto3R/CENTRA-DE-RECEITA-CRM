"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { ArrowUp, BookOpen, ExternalLink, LifeBuoy, Loader2, MessageCircle, RotateCcw } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

// Chat de ajuda: responde dúvidas de uso com base na Central de Ajuda (/ajuda)
// e devolve os artigos de passo a passo. Aberto a todos os papéis.

const SUPORTE_WA =
  "https://wa.me/5561982742727?text=" +
  encodeURIComponent("Olá! Sou cliente da Central de Receita e preciso de ajuda com: ");

const SUGESTOES = [
  "Como conecto o WhatsApp?",
  "Como ligo o agente 3R?",
  "Como crio um funil?",
  "Como convido alguém da equipe?",
  "Como importo meus contatos?",
  "O que é a janela de 24 horas?",
];

interface Artigo {
  slug: string;
  titulo: string;
  url: string;
}
interface Mensagem {
  papel: "usuario" | "ajuda";
  texto: string;
  artigos?: Artigo[];
  encontrou?: boolean;
  erro?: boolean;
}

const CHAVE = "ajuda-chat:v1";

/** Markdown mínimo: parágrafos, listas (1. / -) e **negrito**. Sem HTML cru. */
function Texto({ texto }: { texto: string }) {
  const negrito = (linha: string) =>
    linha.split(/(\*\*[^*]+\*\*)/g).map((parte, i) =>
      parte.startsWith("**") && parte.endsWith("**") ? (
        <strong key={i} className="font-semibold text-foreground">
          {parte.slice(2, -2)}
        </strong>
      ) : (
        <Fragment key={i}>{parte}</Fragment>
      ),
    );
  const blocos: { tipo: "p" | "ol" | "ul"; linhas: string[] }[] = [];
  for (const bruta of texto.split("\n")) {
    const linha = bruta.trim();
    if (!linha) {
      blocos.push({ tipo: "p", linhas: [] });
      continue;
    }
    const ol = linha.match(/^\d+[.)]\s+(.*)$/);
    const ul = linha.match(/^[-*•]\s+(.*)$/);
    const tipo = ol ? "ol" : ul ? "ul" : "p";
    const conteudo = ol ? ol[1] : ul ? ul[1] : linha;
    const atual = blocos.at(-1);
    if (atual && atual.tipo === tipo && (tipo !== "p" || atual.linhas.length)) atual.linhas.push(conteudo);
    else blocos.push({ tipo, linhas: [conteudo] });
  }
  return (
    <div className="space-y-2">
      {blocos
        .filter((b) => b.linhas.length)
        .map((b, i) =>
          b.tipo === "p" ? (
            <p key={i}>{b.linhas.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{negrito(l)}</Fragment>)}</p>
          ) : b.tipo === "ol" ? (
            <ol key={i} className="list-decimal space-y-1 pl-5">
              {b.linhas.map((l, j) => <li key={j}>{negrito(l)}</li>)}
            </ol>
          ) : (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {b.linhas.map((l, j) => <li key={j}>{negrito(l)}</li>)}
            </ul>
          ),
        )}
    </div>
  );
}

export function AjudaChat() {
  const [aberto, setAberto] = useState(false);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [rascunho, setRascunho] = useState("");
  const [enviando, setEnviando] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);

  // A conversa sobrevive à troca de tela (mesma aba), não ao fechar o navegador.
  useEffect(() => {
    try {
      const salvo = sessionStorage.getItem(CHAVE);
      if (salvo) setMensagens(JSON.parse(salvo));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(CHAVE, JSON.stringify(mensagens.slice(-30)));
    } catch {}
    fimRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mensagens, enviando]);
  useEffect(() => {
    if (aberto) setTimeout(() => campoRef.current?.focus(), 150);
  }, [aberto]);

  async function enviar(texto: string) {
    const pergunta = texto.trim();
    if (!pergunta || enviando) return;
    const nova: Mensagem = { papel: "usuario", texto: pergunta };
    const historico = [...mensagens, nova];
    setMensagens(historico);
    setRascunho("");
    setEnviando(true);
    try {
      const res = await fetch("/api/ajuda/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mensagens: historico
            .filter((m) => !m.erro)
            .slice(-12)
            .map((m) => ({ papel: m.papel, texto: m.texto.slice(0, 2000) })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Não consegui responder agora.");
      setMensagens((m) => [
        ...m,
        { papel: "ajuda", texto: json.resposta, artigos: json.artigos, encontrou: json.encontrou },
      ]);
    } catch (err) {
      setMensagens((m) => [
        ...m,
        {
          papel: "ajuda",
          texto: err instanceof Error ? err.message : "Não consegui responder agora.",
          erro: true,
          encontrou: false,
        },
      ]);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        aria-label="Abrir a ajuda"
        title="Ajuda"
        className="flex h-10 items-center gap-1.5 rounded-md px-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:px-2.5"
      >
        <LifeBuoy className="h-5 w-5" />
        <span className="hidden text-sm font-medium md:inline">Ajuda</span>
      </button>

      <Sheet open={aberto} onOpenChange={setAberto}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b border-border px-5 py-4 pr-12">
            <SheetTitle className="flex items-center gap-2 text-base">
              <LifeBuoy className="h-4 w-4 text-primary" /> Ajuda
            </SheetTitle>
            <SheetDescription>
              Pergunte como fazer qualquer coisa na Central de Receita. A resposta vem da{" "}
              <a href="/ajuda" target="_blank" rel="noopener" className="text-primary underline-offset-2 hover:underline">
                Central de Ajuda
              </a>
              , com o link do passo a passo.
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {mensagens.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Algumas dúvidas comuns:</p>
                <div className="flex flex-wrap gap-2">
                  {SUGESTOES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => enviar(s)}
                      className="rounded-full border border-border px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {mensagens.map((m, i) =>
                  m.papel === "usuario" ? (
                    <div key={i} className="flex justify-end">
                      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-primary-foreground">
                        {m.texto}
                      </div>
                    </div>
                  ) : (
                    <div key={i} className="space-y-2">
                      <div
                        className={cn(
                          "max-w-[95%] rounded-2xl rounded-bl-md border px-3.5 py-2.5 text-sm leading-relaxed text-muted-foreground",
                          m.erro ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-muted/40",
                        )}
                      >
                        <Texto texto={m.texto} />
                      </div>
                      {m.artigos?.length ? (
                        <div className="flex flex-col gap-1.5">
                          {m.artigos.map((a) => (
                            <a
                              key={a.slug}
                              href={a.url}
                              target="_blank"
                              rel="noopener"
                              className="group flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:border-primary/50 hover:bg-primary/5"
                            >
                              <BookOpen className="h-4 w-4 shrink-0 text-primary" />
                              <span className="min-w-0 flex-1">
                                <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                                  Passo a passo
                                </span>
                                <span className="block truncate font-medium text-foreground">{a.titulo}</span>
                              </span>
                              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
                            </a>
                          ))}
                        </div>
                      ) : null}
                      {m.encontrou === false ? (
                        <a
                          href={SUPORTE_WA}
                          target="_blank"
                          rel="noopener"
                          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                        >
                          <MessageCircle className="h-4 w-4" /> Falar com o suporte
                        </a>
                      ) : null}
                    </div>
                  ),
                )}
                {enviando ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Procurando na Central de Ajuda…
                  </div>
                ) : null}
                <div ref={fimRef} />
              </div>
            )}
          </div>

          <form
            className="border-t border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              enviar(rascunho);
            }}
          >
            <div className="flex items-end gap-2 rounded-xl border border-border bg-background px-3 py-2 focus-within:border-primary/60">
              <textarea
                ref={campoRef}
                value={rascunho}
                onChange={(e) => setRascunho(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    enviar(rascunho);
                  }
                }}
                rows={1}
                maxLength={2000}
                placeholder="Escreva sua dúvida…"
                aria-label="Sua dúvida"
                className="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <button
                type="submit"
                disabled={!rascunho.trim() || enviando}
                aria-label="Enviar pergunta"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <a href={SUPORTE_WA} target="_blank" rel="noopener" className="hover:text-foreground">
                Prefere falar com uma pessoa? Suporte no WhatsApp
              </a>
              {mensagens.length ? (
                <button
                  type="button"
                  onClick={() => setMensagens([])}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  <RotateCcw className="h-3 w-3" /> Nova conversa
                </button>
              ) : null}
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
