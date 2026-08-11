"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarClock, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { extractVariableIndices } from "@/lib/whatsapp/template-validators";
import { renderTemplateBody } from "@/lib/inbox/schedule";
import type { MessageTemplate } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ScheduleMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  contactId: string;
  channelId?: string | null;
  onScheduled: () => void;
}

/**
 * Um template só é agendável se TODAS as suas variáveis estiverem no
 * corpo. O envio server-side (engineSendTemplate) manda apenas os
 * parâmetros de body — variável em header ou em botão de URL seria
 * descartada e a Meta recusaria a mensagem. Como o disparo acontece
 * dias depois, essa falha só apareceria quando já fosse tarde; melhor
 * barrar agora e dizer por quê.
 */
function unsupportedReason(t: MessageTemplate): string | null {
  if (t.header_type === "text" && t.header_content) {
    if (extractVariableIndices(t.header_content).length > 0) {
      return "Tem variável no cabeçalho";
    }
  }
  if (t.header_type && t.header_type !== "text") {
    return "Tem mídia no cabeçalho";
  }
  const hasUrlVar = (t.buttons ?? []).some(
    (b) => b.type === "URL" && extractVariableIndices(b.url ?? "").length > 0,
  );
  if (hasUrlVar) return "Tem variável em botão";
  return null;
}

/** datetime-local mínimo: daqui a 5 minutos, no fuso do navegador. */
function minLocalDateTime(): string {
  const d = new Date(Date.now() + 5 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ScheduleMessageDialog({
  open,
  onOpenChange,
  conversationId,
  contactId,
  channelId,
  onScheduled,
}: ScheduleMessageDialogProps) {
  const { accountId } = useAuth();
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<MessageTemplate | null>(null);
  const [params, setParams] = useState<string[]>([]);
  const [when, setWhen] = useState("");
  // Piso do seletor, congelado quando o modelo é escolhido. Guardar em
  // estado (em vez de recalcular no render) mantém o componente puro —
  // Date.now() a cada render dá resultado instável.
  const [minWhen, setMinWhen] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const supabase = createClient();
      let q = supabase
        .from("message_templates")
        .select("*")
        .eq("account_id", accountId)
        .eq("status", "APPROVED");
      if (channelId) q = q.eq("channel_id", channelId);
      const { data } = await q.order("name");
      if (cancelled) return;
      setTemplates((data as MessageTemplate[] | null) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, accountId, channelId]);

  /**
   * Reset ao fechar — sem isto o template escolhido na vez anterior
   * reaparece já selecionado. Fica no handler, não num efeito: limpar
   * estado é consequência da ação de fechar, não sincronização com um
   * sistema externo.
   */
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setSelected(null);
        setParams([]);
        setWhen("");
        setMinWhen("");
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );

  const bodyVars = useMemo(
    () => (selected ? extractVariableIndices(selected.body_text) : []),
    [selected],
  );

  const preview = useMemo(
    () => (selected ? renderTemplateBody(selected.body_text, params) : ""),
    [selected, params],
  );

  const missingParam = bodyVars.some((_, i) => !(params[i] ?? "").trim());
  // Comparação de string funciona: datetime-local é sempre
  // YYYY-MM-DDTHH:mm, que ordena lexicograficamente igual ao tempo.
  const whenValid = !!when && !!minWhen && when >= minWhen;

  const handleConfirm = useCallback(async () => {
    if (!selected || !accountId || !whenValid || missingParam) return;
    setSaving(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const { error } = await supabase.from("scheduled_messages").insert({
      account_id: accountId,
      conversation_id: conversationId,
      contact_id: contactId,
      channel_id: channelId ?? null,
      template_name: selected.name,
      template_language: selected.language ?? "pt_BR",
      template_params: bodyVars.map((_, i) => params[i] ?? ""),
      preview,
      scheduled_at: new Date(when).toISOString(),
      created_by: session?.user?.id ?? null,
    });

    setSaving(false);
    if (error) {
      toast.error("Não foi possível agendar a mensagem.");
      return;
    }
    toast.success("Mensagem agendada.");
    handleOpenChange(false);
    onScheduled();
  }, [
    selected,
    accountId,
    whenValid,
    missingParam,
    conversationId,
    contactId,
    channelId,
    bodyVars,
    params,
    preview,
    when,
    handleOpenChange,
    onScheduled,
  ]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-4" />
            {selected ? "Quando enviar" : "Agendar mensagem"}
          </DialogTitle>
          <DialogDescription>
            {selected
              ? "A mensagem sai automaticamente no horário escolhido."
              : "Só modelos aprovados podem ser agendados — depois de 24h sem resposta do lead, a Meta recusa mensagem livre."}
          </DialogDescription>
        </DialogHeader>

        {!selected ? (
          loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Carregando modelos…
            </div>
          ) : templates.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nenhum modelo aprovado neste canal. Crie e envie um para
              aprovação em Configurações › Modelos.
            </p>
          ) : (
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {templates.map((t) => {
                const blocked = unsupportedReason(t);
                return (
                  <button
                    key={t.id}
                    type="button"
                    disabled={!!blocked}
                    onClick={() => {
                      const floor = minLocalDateTime();
                      setSelected(t);
                      setParams([]);
                      setMinWhen(floor);
                      setWhen(floor);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {t.name}
                      </p>
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {t.body_text}
                      </p>
                    </div>
                    {blocked ? (
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        {blocked}
                      </Badge>
                    ) : (
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                );
              })}
            </div>
          )
        ) : (
          <div className="space-y-3">
            {bodyVars.map((n, i) => (
              <div key={n} className="grid gap-1.5">
                <Label className="text-muted-foreground">
                  Variável {`{{${n}}}`}
                </Label>
                <Input
                  value={params[i] ?? ""}
                  onChange={(e) => {
                    const next = [...params];
                    next[i] = e.target.value;
                    setParams(next);
                  }}
                  placeholder={`Valor de {{${n}}}`}
                  className="bg-muted text-foreground"
                />
              </div>
            ))}

            <div className="grid gap-1.5">
              <Label className="text-muted-foreground">Data e hora</Label>
              <Input
                type="datetime-local"
                value={when}
                min={minWhen}
                onChange={(e) => setWhen(e.target.value)}
                className="bg-muted text-foreground"
              />
              {when && !whenValid && (
                <p className="text-xs text-red-400">
                  Escolha um horário no futuro.
                </p>
              )}
            </div>

            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                O lead vai receber
              </p>
              <p className="whitespace-pre-wrap text-sm text-foreground">
                {preview}
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          {selected && (
            <Button
              variant="ghost"
              onClick={() => setSelected(null)}
              disabled={saving}
              className="mr-auto"
            >
              <ArrowLeft className="size-4" />
              Trocar modelo
            </Button>
          )}
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancelar
          </Button>
          {selected && (
            <Button
              onClick={handleConfirm}
              disabled={saving || missingParam || !whenValid}
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CalendarClock className="size-4" />
              )}
              Agendar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
