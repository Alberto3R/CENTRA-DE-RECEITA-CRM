"use client";

import type { Deal, PipelineStage } from "@/types";
import Link from "next/link";
import { Calendar, Check, MessageSquare, X } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { buttonVariants } from "@/components/ui/button";
import { WaCallButton } from "@/components/whatsapp/wa-call-button";
import { TelnyxCallButton } from "@/components/telnyx/telnyx-call-button";
import { StartTemplateButton } from "@/components/whatsapp/start-template-button";

type TagLite = { id: string; name: string; color: string };

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
  isOverlay?: boolean;
}

// As tags vêm embutidas no contato via
// `contact:contacts(*, contact_tags(tag:tags(id, name, color)))`.
// No funil são só exibidas; inserir/remover fica no negócio aberto.
function contactTags(deal: Deal): TagLite[] {
  const cts = (deal.contact as unknown as { contact_tags?: { tag: TagLite | null }[] } | null)
    ?.contact_tags;
  return (cts ?? []).map((ct) => ct.tag).filter((t): t is TagLite => !!t);
}

// Conversa mais recente do contato, embutida no mesmo select
// (`conversations(id, last_message_at)`). Se existir, o card leva pra ela
// em vez de oferecer iniciar uma nova.
function latestConversationId(deal: Deal): string | null {
  const convs = (deal.contact as unknown as {
    conversations?: { id: string; last_message_at: string | null }[];
  } | null)?.conversations;
  if (!convs?.length) return null;
  return convs.reduce((a, b) =>
    (b.last_message_at ?? "") > (a.last_message_at ?? "") ? b : a,
  ).id;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("pt-BR", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function initials(name?: string, fallback?: string) {
  const source = (name || fallback || "?").trim();
  if (!source) return "?";
  return source.charAt(0).toUpperCase();
}

export function DealCard({ deal, stage, onEdit, isOverlay }: DealCardProps) {
  const contactLabel = deal.contact?.name || deal.contact?.phone || "Sem contato";
  const assigneeLabel = deal.assignee?.full_name || null;
  const tags = contactTags(deal);
  const conversationId = latestConversationId(deal);

  return (
    <div
      role="button"
      tabIndex={isOverlay ? -1 : 0}
      onClick={(e) => {
        // `onClick` still fires after a non-drag tap because the PointerSensor
        // requires 5px movement before it counts as a drag.
        if (isOverlay) return;
        e.stopPropagation();
        onEdit(deal);
      }}
      onKeyDown={(e) => {
        if (isOverlay) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onEdit(deal);
        }
      }}
      className={`group relative w-full cursor-pointer rounded-xl border border-border/50 bg-muted/70 pl-4 pr-3 py-3 text-left shadow-sm transition-all ${
        isOverlay
          ? "shadow-xl"
          : "hover:-translate-y-0.5 hover:border-border hover:bg-muted hover:shadow-lg"
      }`}
    >
      {/* 4px left accent bar using stage color */}
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: stage?.color ?? "#94a3b8" }}
      />

      <div className="flex items-start justify-between gap-2">
        <h4 className="flex-1 text-sm font-semibold leading-snug text-foreground break-words">
          {deal.title}
        </h4>
        {deal.status === "won" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
            <Check className="h-3 w-3" />
            Ganho
          </span>
        )}
        {deal.status === "lost" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">
            <X className="h-3 w-3" />
            Perdido
          </span>
        )}
      </div>

      {/* Contact row */}
      <div className="mt-2 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground">
          {initials(deal.contact?.name, deal.contact?.phone)}
        </span>
        <span className="truncate text-xs text-muted-foreground">{contactLabel}</span>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-sm font-bold text-primary">
          {formatCurrency(deal.value, deal.currency)}
        </span>
        {deal.expected_close_date && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Calendar className="h-3 w-3" />
            {formatDate(deal.expected_close_date)}
          </span>
        )}
      </div>

      {/* Tags do contato — só exibição no funil (inserir fica no negócio) */}
      {tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {tags.map((t) => (
            <span
              key={t.id}
              className="rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{ backgroundColor: `${t.color}20`, color: t.color }}
            >
              {t.name}
            </span>
          ))}
        </div>
      )}

      {assigneeLabel && (
        <div className="mt-2 flex items-center justify-end">
          <span
            title={assigneeLabel}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary"
          >
            {initials(assigneeLabel)}
          </span>
        </div>
      )}

      {/* Ações rápidas do card: ligar (WhatsApp) e iniciar conversa com
          modelo. stopPropagation no pointer/click pra não abrir o negócio
          nem iniciar o drag do kanban. */}
      {deal.contact?.id && !isOverlay && (
        <div
          className="mt-3 flex items-center gap-1 border-t border-border/50 pt-2"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <WaCallButton contactId={deal.contact.id} compact />
          <TelnyxCallButton contactId={deal.contact.id} compact />
          {conversationId ? (
            <Link
              href={`/inbox?c=${conversationId}`}
              title="Abrir conversa"
              aria-label="Abrir conversa"
              className={buttonVariants({
                variant: "ghost",
                size: "icon-sm",
                className: "text-muted-foreground hover:text-primary",
              })}
            >
              <MessageSquare className="h-4 w-4" />
            </Link>
          ) : (
            <StartTemplateButton contactId={deal.contact.id} />
          )}
        </div>
      )}
    </div>
  );
}
