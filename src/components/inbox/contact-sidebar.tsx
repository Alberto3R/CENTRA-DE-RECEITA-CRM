"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import type {
  Contact,
  Deal,
  ContactNote,
  Pipeline,
  PipelineStage,
  Tag,
} from "@/types";
import {
  Phone,
  Mail,
  Copy,
  Check,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
  PhoneCall,
  CalendarClock,
  Video,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CallHistory } from "@/components/whatsapp/call-history";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TagPicker, TagPills } from "@/components/contacts/tag-picker";
import { DealForm } from "@/components/pipelines/deal-form";
import { format } from "date-fns";
import {
  InstagramGlyph,
  isInstagramContact,
  contactDisplayName,
  contactInitial,
  contactSubtitle,
} from "./channel-display";

interface ContactSidebarProps {
  contact: Contact | null;
  /**
   * Rendered inside the mobile Sheet instead of as the fixed right rail —
   * drops the fixed width and the left border so it fills the drawer.
   */
  inSheet?: boolean;
}

export function ContactSidebar({ contact, inSheet = false }: ContactSidebarProps) {
  const { accountId } = useAuth();
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [calls, setCalls] = useState<
    { id: string; starts_at: string; meet_link: string | null; status: string }[]
  >([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [dealFormOpen, setDealFormOpen] = useState(false);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch deals, notes, tags and scheduled calls in parallel
    const [dealsRes, notesRes, tagsRes, callsRes] = await Promise.all([
      supabase
        .from("deals")
        .select("*, stage:pipeline_stages(*)")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
      supabase
        .from("scheduled_calls")
        .select("id, starts_at, meet_link, status")
        .eq("contact_id", contact.id)
        .eq("status", "scheduled")
        .order("starts_at", { ascending: true }),
    ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (callsRes.data) setCalls(callsRes.data);
    if (tagsRes.data) {
      const rows = tagsRes.data as unknown as { tags: Tag | null }[];
      setTags(rows.map((ct) => ct.tags).filter((t): t is Tag => !!t));
    }
  }, [contact]);

  // Pipeline padrão da conta (o primeiro, mesma regra da tela de Pipelines)
  // + suas etapas. Necessário para criar negócio e trocar etapa daqui.
  const fetchPipeline = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const { data: pipes } = await supabase
      .from("pipelines")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at")
      .limit(1);

    const first = (pipes?.[0] as Pipeline | undefined) ?? null;
    setPipeline(first);
    if (!first) {
      setStages([]);
      return;
    }

    const { data: st } = await supabase
      .from("pipeline_stages")
      .select("*")
      .eq("pipeline_id", first.id)
      .order("position");
    setStages((st ?? []) as PipelineStage[]);
  }, [accountId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPipeline();
  }, [fetchPipeline]);

  const handleTagsChange = useCallback((_ids: string[], nextTags: Tag[]) => {
    setTags(nextTags);
  }, []);

  const handleStageChange = useCallback(
    async (dealId: string, stage: PipelineStage) => {
      const previous = deals;
      // Otimista: o trigger de deal_stage_events registra o histórico e o
      // sweeper de deal-triggers dispara as automações sozinho.
      setDeals((prev) =>
        prev.map((d) =>
          d.id === dealId ? { ...d, stage_id: stage.id, stage } : d,
        ),
      );

      const supabase = createClient();
      const { error } = await supabase
        .from("deals")
        .update({ stage_id: stage.id })
        .eq("id", dealId);

      if (error) {
        setDeals(previous);
        toast.error("Falha ao mover o negócio");
      }
    },
    [deals],
  );

  // Load on contact change. setContactData/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData]);

  const handleCopyPhone = useCallback(async () => {
    // Copia a identidade do canal: telefone (WhatsApp) ou @username (IG).
    const value = contactSubtitle(contact);
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    if (!accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  const shellClass = inSheet
    ? "flex h-full w-full flex-col bg-card"
    : "flex h-full w-70 flex-col border-l border-border bg-card";

  if (!contact) {
    return (
      <div className={cn(shellClass, "items-center justify-center")}>
        <p className="text-sm text-muted-foreground">Selecione uma conversa</p>
      </div>
    );
  }

  // Robusto p/ Instagram: contato IG não tem telefone (name/phone null) —
  // usa os helpers de canal (nome > @username > telefone > fallback).
  const displayName = contactDisplayName(contact);
  const initials = contactInitial(contact);
  const isInstagram = isInstagramContact(contact);
  const identity = contactSubtitle(contact); // telefone (WhatsApp) ou @username (IG)

  return (
    <div className={shellClass}>
      <ScrollArea className="flex-1">
        <div className="p-4">
          {/* Contact Info */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground">
              {contact.avatar_url ? (
                <img
                  src={contact.avatar_url}
                  alt={displayName}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">
              {displayName}
            </h3>
            {contact.company && (
              <p className="text-xs text-muted-foreground">{contact.company}</p>
            )}
          </div>

          {/* Phone */}
          <div className="mt-4 space-y-2">
            <button
              onClick={handleCopyPhone}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              {isInstagram ? (
                <InstagramGlyph className="h-4 w-4 text-[#E1306C]" />
              ) : (
                <Phone className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="flex-1 text-left">{identity || "—"}</span>
              {copied ? (
                <Check className="h-3 w-3 text-primary" />
              ) : (
                <Copy className="h-3 w-3 text-muted-foreground" />
              )}
            </button>

            {contact.email && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{contact.email}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Tags */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <TagIcon className="h-3 w-3" />
              Tags
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <TagPills tags={tags} />
              <TagPicker
                contactId={contact.id}
                selectedTagIds={tags.map((t) => t.id)}
                onChange={handleTagsChange}
              />
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Active Deals */}
          <div>
            <div className="flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                <DollarSign className="h-3 w-3" />
                Negócios ativos
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-6 gap-1 px-2 text-[10px]"
                onClick={() => setDealFormOpen(true)}
                disabled={!pipeline || stages.length === 0}
                title={
                  pipeline
                    ? "Criar negócio para este contato"
                    : "Crie um pipeline antes de abrir negócios"
                }
              >
                <Plus className="size-3" />
                Novo
              </Button>
            </div>
            <div className="mt-2 space-y-2">
              {deals.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">Nenhum negócio</p>
              ) : (
                deals.map((deal) => (
                  <div
                    key={deal.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="text-sm font-medium text-foreground">
                      {deal.title}
                    </p>
                    <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>
                        {deal.currency ?? "$"}
                        {deal.value.toLocaleString()}
                      </span>
                      {stages.length > 0 ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] transition-opacity hover:opacity-80"
                            style={{
                              backgroundColor: `${deal.stage?.color ?? "#64748b"}20`,
                              color: deal.stage?.color ?? "#64748b",
                            }}
                            aria-label="Mudar etapa"
                          >
                            {deal.stage?.name ?? "Sem etapa"}
                            <ChevronDown className="h-2.5 w-2.5" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="border-border bg-popover"
                          >
                            {stages.map((s) => (
                              <DropdownMenuItem
                                key={s.id}
                                onClick={() => handleStageChange(deal.id, s)}
                                className={cn(
                                  "text-sm",
                                  s.id === deal.stage_id && "font-semibold",
                                )}
                              >
                                <span
                                  className="mr-2 size-2 shrink-0 rounded-full"
                                  style={{ backgroundColor: s.color }}
                                />
                                {s.name}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        deal.stage && (
                          <span
                            className="rounded-full px-1.5 py-0.5 text-[10px]"
                            style={{
                              backgroundColor: `${deal.stage.color}20`,
                              color: deal.stage.color,
                            }}
                          >
                            {deal.stage.name}
                          </span>
                        )
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Calls agendadas (pelo agente de IA) */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <CalendarClock className="h-3 w-3" />
              Calls agendadas
            </div>
            <div className="mt-2 space-y-2">
              {calls.length === 0 ? (
                <p className="px-1 text-xs text-muted-foreground">Nenhuma call marcada</p>
              ) : (
                calls.map((call) => (
                  <div key={call.id} className="rounded-lg bg-muted px-3 py-2">
                    <p className="text-sm font-medium text-foreground">
                      {format(new Date(call.starts_at), "EEE, d 'de' MMM 'às' HH:mm")}
                    </p>
                    {call.meet_link && (
                      <a
                        href={call.meet_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <Video className="h-3 w-3" /> Entrar no Meet
                      </a>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Ligações WhatsApp */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <PhoneCall className="h-3 w-3" />
              Ligações
            </div>
            <div className="mt-2">
              <CallHistory contactId={contact.id} />
            </div>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-border" />

          {/* Notes */}
          <div>
            <div className="flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <StickyNote className="h-3 w-3" />
              Notas
            </div>
            <div className="mt-2">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Adicionar uma nota..."
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
                />
                <Button
                  size="sm"
                  className="h-auto bg-primary px-2 hover:bg-primary/90"
                  onClick={handleAddNote}
                  disabled={!newNote.trim() || addingNote}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              <div className="mt-2 space-y-2">
                {notes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg bg-muted px-3 py-2"
                  >
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                      {note.note_text}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {format(new Date(note.created_at), "MMM d, yyyy HH:mm")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>

      {pipeline && stages.length > 0 && (
        <DealForm
          open={dealFormOpen}
          onOpenChange={setDealFormOpen}
          pipelineId={pipeline.id}
          stages={stages}
          defaultContactId={contact.id}
          lockContact
          onSaved={() => {
            setDealFormOpen(false);
            fetchContactData();
          }}
        />
      )}
    </div>
  );
}
