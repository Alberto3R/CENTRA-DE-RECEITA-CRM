"use client";

import { useState } from "react";
import { Loader2, MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";

import type { MessageTemplate } from "@/types";
import { Button } from "@/components/ui/button";
import {
  TemplatePicker,
  type TemplateSendValues,
} from "@/components/inbox/template-picker";

/**
 * Botão "Iniciar conversa com modelo". Abre o TemplatePicker; ao escolher,
 * acha/cria a conversa do contato e dispara o template. Pensado pro card de
 * negócio (leads importados sem conversa prévia — o toque de reaquecimento).
 */
function renderBody(body: string | undefined, params: string[]): string {
  return (body ?? "").replace(/\{\{(\d+)\}\}/g, (_, n) => {
    const v = params[Number(n) - 1];
    return v && v.trim() ? v : `{{${n}}}`;
  });
}

export function StartTemplateButton({ contactId }: { contactId: string }) {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);

  async function handleSelect(
    template: MessageTemplate,
    values: TemplateSendValues,
  ) {
    setSending(true);
    try {
      // 1) acha/cria a conversa
      const cRes = await fetch("/api/whatsapp/start-conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId }),
      });
      const cData = (await cRes.json().catch(() => ({}))) as {
        conversationId?: string;
        error?: string;
      };
      if (!cRes.ok || !cData.conversationId) {
        throw new Error(cData.error ?? "não foi possível iniciar a conversa");
      }

      // 2) envia o template
      const sRes = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: cData.conversationId,
          message_type: "template",
          template_name: template.name,
          template_language: template.language,
          template_message_params: {
            body: values.body,
            headerText: values.headerText,
            buttonParams: values.buttonParams,
          },
          template_params: values.body,
          content_text: renderBody(template.body_text, values.body),
        }),
      });
      const sData = (await sRes.json().catch(() => ({}))) as { error?: string };
      if (!sRes.ok) throw new Error(sData.error ?? `HTTP ${sRes.status}`);

      toast.success("Conversa iniciada — modelo enviado.");
      setOpen(false);
    } catch (e) {
      toast.error(
        `Falha ao enviar modelo: ${e instanceof Error ? e.message : "erro"}`,
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        title="Iniciar conversa com modelo"
        aria-label="Iniciar conversa com modelo"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="text-muted-foreground hover:text-primary"
      >
        {sending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <MessageSquarePlus className="h-4 w-4" />
        )}
      </Button>
      <TemplatePicker open={open} onOpenChange={setOpen} onSelect={handleSelect} />
    </>
  );
}
