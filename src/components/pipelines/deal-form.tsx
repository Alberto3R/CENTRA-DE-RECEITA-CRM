"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { CURRENCIES } from "@/lib/currency";
import { DEFAULT_LOSS_REASONS } from "@/lib/deals/loss-reasons";
import type {
  Contact,
  Conversation,
  Deal,
  DealStatus,
  PipelineStage,
  Profile,
  Tag,
} from "@/types";
import { TagPicker, TagPills } from "@/components/contacts/tag-picker";
import { DealNotes } from "@/components/pipelines/deal-notes";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { DealHistory } from "@/components/pipelines/deal-history";
import {
  Check,
  X,
  Trash2,
  MessageSquare,
  DollarSign,
  Loader2,
  Phone,
  Mail,
} from "lucide-react";
import { toast } from "sonner";

interface DealFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: Deal | null;
  pipelineId: string;
  stages: PipelineStage[];
  defaultStageId?: string;
  /** Pre-selects the contact when creating a deal (used from the inbox). */
  defaultContactId?: string;
  /**
   * Freezes the contact selection. Callers that already know the contact
   * (the inbox sidebar) pass this so the form does not load every contact
   * in the account just to render a dropdown the user must not change.
   */
  lockContact?: boolean;
  onSaved: () => void;
}

export function DealForm({
  open,
  onOpenChange,
  deal,
  pipelineId,
  stages,
  defaultStageId,
  defaultContactId,
  lockContact = false,
  onSaved,
}: DealFormProps) {
  const supabase = createClient();
  const { accountId, defaultCurrency } = useAuth();

  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [contactId, setContactId] = useState("");
  const [stageId, setStageId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [notes, setNotes] = useState("");

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [contactTags, setContactTags] = useState<Tag[]>([]);
  const [linkedConversation, setLinkedConversation] =
    useState<Conversation | null>(null);

  // Which contact the form is pinned to when `lockContact` is on. Derived
  // from props (not state) so the load effect can depend on it directly.
  const lockedContactId = deal?.contact_id ?? defaultContactId ?? null;

  const [saving, setSaving] = useState(false);
  const [statusAction, setStatusAction] = useState<DealStatus | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lostReasonOpen, setLostReasonOpen] = useState(false);
  const [lossReasons, setLossReasons] = useState<string[]>(DEFAULT_LOSS_REASONS);
  const [lostReason, setLostReason] = useState(DEFAULT_LOSS_REASONS[0]);

  // Reset the form fields every time the sheet opens or its input
  // props change. This is a legitimate prop-driven sync; the rule is
  // over-cautious here, hence the block-level disable.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    setLostReasonOpen(false);
    if (deal) {
      setTitle(deal.title);
      setValue(String(deal.value ?? ""));
      setCurrency(deal.currency || defaultCurrency);
      // contact_id is nullable when the contact has been deleted
      // (migration 004: ON DELETE SET NULL). "" means "no selection".
      setContactId(deal.contact_id ?? "");
      setStageId(deal.stage_id);
      setAssignedTo(deal.assigned_to ?? "");
      setExpectedCloseDate(deal.expected_close_date ?? "");
      setNotes(deal.notes ?? "");
    } else {
      setTitle("");
      setValue("");
      setCurrency(defaultCurrency);
      setContactId(defaultContactId ?? "");
      setStageId(defaultStageId || stages[0]?.id || "");
      setAssignedTo("");
      setExpectedCloseDate("");
      setNotes("");
    }
  }, [open, deal, defaultStageId, defaultContactId, stages, defaultCurrency]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Motivos de perda da conta (fallback: lista padrão do sistema).
  useEffect(() => {
    if (!open || !accountId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("loss_reasons")
        .select("reason")
        .eq("account_id", accountId)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (cancelled) return;
      const list = ((data as { reason: string }[] | null) ?? []).map(
        (r) => r.reason,
      );
      const resolved = list.length > 0 ? list : DEFAULT_LOSS_REASONS;
      setLossReasons(resolved);
      setLostReason(resolved[0]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, accountId, supabase]);

  // Load supporting data once the sheet is open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      // With the contact locked we only need the single selected row —
      // loading the whole address book would be wasted work.
      const contactsQuery =
        lockContact && lockedContactId
          ? supabase.from("contacts").select("*").eq("id", lockedContactId)
          : supabase.from("contacts").select("*").order("name");

      const [c, p] = await Promise.all([
        contactsQuery,
        supabase.from("profiles").select("*").order("full_name"),
      ]);
      if (cancelled) return;
      setContacts((c.data ?? []) as Contact[]);
      setProfiles((p.data ?? []) as Profile[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supabase, lockContact, lockedContactId]);

  // Fetch linked conversation for the selected contact (newest open one).
  // Clearing on no-selection is sync with prop state; the populated
  // case runs setLinkedConversation inside the async fetch callback.
  useEffect(() => {
    if (!open || !contactId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLinkedConversation(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("conversations")
        .select("*")
        .eq("contact_id", contactId)
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setLinkedConversation((data as Conversation | null) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, contactId, supabase]);

  // Tags of the selected contact, for the inline picker below the contact
  // field. Reloads whenever the selection changes.
  useEffect(() => {
    if (!open || !contactId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setContactTags([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("contact_tags")
        .select("tags(*)")
        .eq("contact_id", contactId);
      if (cancelled) return;
      // The generated types widen the embedded `tags` relation to an array;
      // the FK is one-to-one, so a single row comes back.
      const rows = (data ?? []) as unknown as { tags: Tag | null }[];
      setContactTags(rows.map((r) => r.tags).filter((t): t is Tag => !!t));
    })();
    return () => {
      cancelled = true;
    };
  }, [open, contactId, supabase]);

  const handleTagsChange = useCallback((_ids: string[], nextTags: Tag[]) => {
    setContactTags(nextTags);
  }, []);

  async function handleSave() {
    if (!title.trim() || !contactId || !stageId) {
      toast.error("Título, contato e etapa são obrigatórios");
      return;
    }
    setSaving(true);

    const payload = {
      title: title.trim(),
      value: parseFloat(value) || 0,
      currency,
      contact_id: contactId,
      pipeline_id: pipelineId,
      stage_id: stageId,
      assigned_to: assignedTo || null,
      expected_close_date: expectedCloseDate || null,
    };

    if (deal) {
      // `notes` fica DE FORA no update: num negócio existente as notas
      // vivem em `deal_notes` e o painel <DealNotes> salva sozinho.
      // `deals.notes` é só o espelho derivado — reenviá-lo daqui gravaria
      // por cima de texto que o usuário nem editou nesta tela.
      const { error } = await supabase
        .from("deals")
        .update(payload)
        .eq("id", deal.id);
      if (error) {
        toast.error("Falha ao salvar o negócio");
        setSaving(false);
        return;
      }
    } else {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        toast.error("Você não está conectado");
        setSaving(false);
        return;
      }
      if (!accountId) {
        toast.error("Seu perfil não está vinculado a uma conta.");
        setSaving(false);
        return;
      }
      const { error } = await supabase
        .from("deals")
        .insert({
          ...payload,
          // Só na criação: o trigger de captura no banco transforma este
          // texto na primeira nota do negócio.
          notes: notes.trim() || null,
          user_id: user.id,
          account_id: accountId,
          status: "open",
        });
      if (error) {
        toast.error("Falha ao criar o negócio");
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    toast.success(deal ? "Negócio atualizado" : "Negócio criado");
    onOpenChange(false);
    onSaved();
  }

  async function handleStatusChange(status: DealStatus, reason?: string) {
    if (!deal) return;
    setStatusAction(status);
    const patch: { status: DealStatus; lost_reason?: string | null } = { status };
    if (status === "lost") patch.lost_reason = reason?.trim() || null;
    const { error } = await supabase
      .from("deals")
      .update(patch)
      .eq("id", deal.id);
    setStatusAction(null);
    if (error) {
      toast.error("Falha ao atualizar o status do negócio");
      return;
    }
    toast.success(
      status === "won" ? "Marcado como ganho" : status === "lost" ? "Marcado como perdido" : "Negócio reaberto",
    );
    onOpenChange(false);
    onSaved();
  }

  async function handleDelete() {
    if (!deal) return;
    setDeleting(true);
    const { error } = await supabase.from("deals").delete().eq("id", deal.id);
    setDeleting(false);
    if (error) {
      toast.error("Falha ao excluir o negócio");
      return;
    }
    toast.success("Negócio excluído");
    setConfirmDelete(false);
    onOpenChange(false);
    onSaved();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-popover border-border text-popover-foreground sm:max-w-lg w-full p-0"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-border/50 p-4">
            <SheetTitle className="text-popover-foreground">
              {deal ? "Editar negócio" : "Novo negócio"}
            </SheetTitle>
          </SheetHeader>

          <Tabs defaultValue="dados" className="flex min-h-0 flex-1 flex-col">
            {deal && (
              <TabsList className="mx-4 mt-3 grid shrink-0 grid-cols-2">
                <TabsTrigger value="dados">Dados</TabsTrigger>
                <TabsTrigger value="historico">Histórico</TabsTrigger>
              </TabsList>
            )}
            <TabsContent
              value="dados"
              className="mt-0 flex-1 space-y-4 overflow-y-auto p-4"
            >
            <div className="grid gap-2">
              <Label className="text-muted-foreground">Título</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Título do negócio"
                className="border-border bg-muted text-foreground"
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Contato</Label>
              <select
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                disabled={lockContact}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-70"
              >
                <option value="">Selecione um contato</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.phone}
                  </option>
                ))}
              </select>

              {(() => {
                const c = contacts.find((x) => x.id === contactId);
                if (!c) return null;
                return (
                  <div className="mt-1 flex flex-col gap-1 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-sm">
                    <a
                      href={`tel:${c.phone}`}
                      className="inline-flex items-center gap-2 text-foreground hover:text-primary"
                    >
                      <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      {c.phone || (
                        <span className="text-muted-foreground">Sem telefone</span>
                      )}
                    </a>
                    {c.email ? (
                      <a
                        href={`mailto:${c.email}`}
                        className="inline-flex items-center gap-2 text-foreground hover:text-primary"
                      >
                        <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        {c.email}
                      </a>
                    ) : (
                      <span className="inline-flex items-center gap-2 text-muted-foreground">
                        <Mail className="h-3.5 w-3.5 shrink-0" />
                        Sem e-mail
                      </span>
                    )}
                  </div>
                );
              })()}

              {linkedConversation && (
                <Link
                  href="/inbox"
                  className="mt-1 inline-flex items-center gap-1.5 self-start rounded-md bg-primary/10 px-2 py-1 text-xs text-primary hover:bg-primary/20"
                >
                  <MessageSquare className="h-3 w-3" />
                  Ver conversa
                </Link>
              )}

              {/* Tags do contato. Ficam na pessoa, não no negócio — o
                  negócio já se classifica por etapa/pipeline/status. */}
              {contactId && (
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <TagPills
                    tags={contactTags}
                    empty="Nenhuma tag neste contato"
                  />
                  <TagPicker
                    contactId={contactId}
                    selectedTagIds={contactTags.map((t) => t.id)}
                    onChange={handleTagsChange}
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-[1fr_110px] gap-3">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">Valor</Label>
                <div className="relative">
                  <DollarSign className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="number"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="0"
                    className="border-border bg-muted pl-7 text-foreground"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label className="text-muted-foreground">Moeda</Label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Data prevista de fechamento</Label>
              <Input
                type="date"
                value={expectedCloseDate}
                onChange={(e) => setExpectedCloseDate(e.target.value)}
                className="border-border bg-muted text-foreground"
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Etapa</Label>
              <select
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">Responsável</Label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
              >
                <option value="">Sem responsável</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
            </div>

            {/*
              Negócio já criado → notas de verdade (múltiplas, com título),
              da tabela deal_notes. Negócio novo ainda não tem id, então
              segue no campo simples; o trigger de captura no banco
              transforma esse texto na primeira nota.
            */}
            {deal?.id && accountId ? (
              <DealNotes dealId={deal.id} accountId={accountId} />
            ) : (
              <div className="grid gap-2">
                <Label className="text-muted-foreground">Notas</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Adicionar notas..."
                  className="min-h-[100px] border-border bg-muted text-foreground"
                />
              </div>
            )}

            {deal && (
              <div className="space-y-2 rounded-lg border border-border bg-muted/50 p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Status
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    onClick={() => handleStatusChange("won")}
                    disabled={!!statusAction || deal.status === "won"}
                    className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {statusAction === "won" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Check className="mr-1 h-4 w-4" />
                        Marcar como ganho
                      </>
                    )}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setLostReasonOpen((v) => !v)}
                    disabled={!!statusAction || deal.status === "lost"}
                    className="flex-1 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {statusAction === "lost" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <X className="mr-1 h-4 w-4" />
                        Marcar como perdido
                      </>
                    )}
                  </Button>
                </div>

                {lostReasonOpen && deal.status !== "lost" && (
                  <div className="space-y-2 rounded-lg border border-red-500/30 bg-red-500/5 p-2">
                    <p className="text-xs text-muted-foreground">Motivo da perda</p>
                    <select
                      value={lostReason}
                      onChange={(e) => setLostReason(e.target.value)}
                      className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                    >
                      {lossReasons.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        onClick={() => handleStatusChange("lost", lostReason)}
                        disabled={!!statusAction}
                        className="flex-1 bg-red-600 text-white hover:bg-red-700"
                      >
                        {statusAction === "lost" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Confirmar perda"
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setLostReasonOpen(false)}
                        className="text-muted-foreground"
                      >
                        Cancelar
                      </Button>
                    </div>
                  </div>
                )}
                {deal.status && deal.status !== "open" && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleStatusChange("open")}
                    disabled={!!statusAction}
                    className="w-full text-muted-foreground hover:text-foreground"
                  >
                    Reabrir negócio
                  </Button>
                )}
              </div>
            )}
            </TabsContent>
            {deal && (
              <TabsContent
                value="historico"
                className="mt-0 flex-1 overflow-y-auto p-4"
              >
                <DealHistory dealId={deal.id} />
              </TabsContent>
            )}
          </Tabs>

          <div className="border-t border-border/50 bg-popover/80 p-4">
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="flex-1 border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !title.trim() || !contactId || !stageId}
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? "Salvando..." : deal ? "Salvar alterações" : "Criar negócio"}
              </Button>
            </div>

            {deal &&
              (confirmDelete ? (
                <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">
                  <span className="text-red-300">Excluir este negócio?</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      disabled={deleting}
                      className="rounded px-2 py-1 text-muted-foreground hover:bg-muted"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {deleting ? "Excluindo..." : "Confirmar"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="mt-3 flex w-full items-center justify-center gap-1 text-xs text-red-400 hover:text-red-300"
                >
                  <Trash2 className="h-3 w-3" />
                  Excluir negócio
                </button>
              ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
