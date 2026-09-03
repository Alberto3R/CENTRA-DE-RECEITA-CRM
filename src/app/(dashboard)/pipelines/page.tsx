"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Pipeline, PipelineStage, Deal } from "@/types";
import { PipelineBoard } from "@/components/pipelines/pipeline-board";
import { PipelineSettings } from "@/components/pipelines/pipeline-settings";
import { DealForm } from "@/components/pipelines/deal-form";
import { PipelineAnalytics } from "@/components/pipelines/pipeline-analytics";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GitBranch, Plus, ChevronDown, Settings, Search } from "lucide-react";
import {
  DateRangePicker,
  dentroDoIntervalo,
  type DateRange,
} from "@/components/ui/date-range-picker";
import { toast } from "sonner";
import { useCan } from "@/hooks/use-can";
import { useAuth } from "@/hooks/use-auth";
import { GatedButton } from "@/components/ui/gated-button";

// Pipeline creation is admin-class (settings-tier write under
// the new RLS); deal creation is operational and only requires
// agent+. The two CTAs gate on different `useCan` capabilities,
// not on different copy.

// Spec-defined seed — name and color per the product spec.
const SPEC_DEFAULT_STAGES = [
  { name: "Novo lead", color: "#3b82f6", position: 0 }, // blue
  { name: "Qualificado", color: "#eab308", position: 1 }, // yellow
  { name: "Proposta enviada", color: "#f97316", position: 2 }, // orange
  { name: "Negociação", color: "#8b5cf6", position: 3 }, // purple
  { name: "Ganho", color: "#22c55e", position: 4 }, // green
];

export default function PipelinesPage() {
  const supabase = createClient();
  const canEditSettings = useCan("edit-settings");
  const canCreateDeals = useCan("send-messages");
  const { accountId } = useAuth();

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);

  // Filtros do board. "custom" abre o calendário ao lado, que preenche
  // `dateRange`; os presets continuam para o uso do dia a dia.
  const [dateFilter, setDateFilter] = useState<
    "all" | "today" | "7d" | "30d" | "custom"
  >("all");
  const [dateRange, setDateRange] = useState<DateRange>({
    from: null,
    to: null,
  });
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  // Situação do negócio no board. Padrão "ativos" ESCONDE os perdidos —
  // um negócio marcado como perdido não deve poluir as colunas do funil.
  // Para revisar/reabrir um perdido, troque para "perdidos" ou "todos".
  const [statusFilter, setStatusFilter] = useState<
    "ativos" | "todos" | "ganhos" | "perdidos"
  >("ativos");
  const [members, setMembers] = useState<{ id: string; full_name: string }[]>([]);
  const [tags, setTags] = useState<{ id: string; name: string }[]>([]);

  // Dialog / sheet state
  const [newPipelineOpen, setNewPipelineOpen] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState("");
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Deal form state is lifted here so both the top-bar "Add Deal" and
  // the per-column "+" trigger the same Sheet.
  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [defaultStageId, setDefaultStageId] = useState<string>("");

  // Guard against double-seeding (React StrictMode double-effect in dev).
  const seedAttempted = useRef(false);

  const loadPipelines = useCallback(async () => {
    const { data, error } = await supabase
      .from("pipelines")
      .select("*")
      .order("created_at");
    if (error) {
      console.error("Failed to load pipelines:", error.message);
      return [];
    }
    return data ?? [];
  }, [supabase]);

  const loadStages = useCallback(
    async (pipelineId: string) => {
      const { data } = await supabase
        .from("pipeline_stages")
        .select("*")
        .eq("pipeline_id", pipelineId)
        .order("position");
      return data ?? [];
    },
    [supabase],
  );

  const loadDeals = useCallback(
    async (pipelineId: string) => {
      const { data } = await supabase
        .from("deals")
        .select(
          "*, contact:contacts(*, contact_tags(tag:tags(id, name, color))), assignee:profiles!deals_assigned_to_fkey(*)",
        )
        .eq("pipeline_id", pipelineId)
        .order("created_at", { ascending: false });
      return (data ?? []) as Deal[];
    },
    [supabase],
  );

  const seedDefaultPipeline = useCallback(async (): Promise<Pipeline | null> => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return null;
    // pipelines.account_id is NOT NULL post-017 with no DB default.
    if (!accountId) return null;

    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .insert({ user_id: user.id, account_id: accountId, name: "Funil de Vendas" })
      .select()
      .single();

    if (error || !pipeline) {
      console.error("Failed to seed pipeline:", error?.message);
      return null;
    }

    const stagesPayload = SPEC_DEFAULT_STAGES.map((s) => ({
      pipeline_id: pipeline.id,
      name: s.name,
      color: s.color,
      position: s.position,
    }));
    await supabase.from("pipeline_stages").insert(stagesPayload);

    return pipeline as Pipeline;
  }, [supabase, accountId]);

  // Initial load + seed-if-empty
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      let list = await loadPipelines();

      if (list.length === 0 && !seedAttempted.current) {
        seedAttempted.current = true;
        const seeded = await seedDefaultPipeline();
        if (seeded) list = await loadPipelines();
      }

      if (cancelled) return;
      setPipelines(list);
      if (list.length > 0) {
        setSelectedPipelineId((prev) =>
          prev && list.some((p) => p.id === prev) ? prev : list[0].id,
        );
      } else {
        setSelectedPipelineId("");
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPipelines, seedDefaultPipeline]);

  // Load stages + deals whenever selected pipeline changes.
  // Clearing on no-selection is a legitimate sync with URL/prop
  // state; the load completion uses async setters inside promise
  // callbacks (not synchronous in the effect body).
  useEffect(() => {
    if (!selectedPipelineId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStages([]);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDeals([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const [s, d] = await Promise.all([
        loadStages(selectedPipelineId),
        loadDeals(selectedPipelineId),
      ]);
      if (cancelled) return;
      setStages(s);
      setDeals(d);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPipelineId, loadStages, loadDeals]);

  // Responsáveis (membros) e tags da conta — alimentam os filtros.
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      const [{ data: m }, { data: t }] = await Promise.all([
        supabase.from("profiles").select("id, full_name").eq("account_id", accountId),
        supabase.from("tags").select("id, name").eq("account_id", accountId).order("name"),
      ]);
      if (cancelled) return;
      setMembers((m as { id: string; full_name: string }[]) ?? []);
      setTags((t as { id: string; name: string }[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, supabase]);

  const filteredDeals = useMemo(() => {
    const now = new Date();
    const cutoff = (days: number) => {
      const c = new Date(now);
      c.setDate(now.getDate() - days);
      return c;
    };
    const q = searchQuery.trim().toLowerCase();
    // Só dígitos, para casar telefone digitado com/sem formatação.
    const qDigits = q.replace(/\D/g, "");
    return deals.filter((d) => {
      if (q) {
        const c = d.contact;
        const alvos = [
          d.title,
          c?.name,
          c?.email,
          c?.phone,
        ]
          .filter(Boolean)
          .map((s) => (s as string).toLowerCase());
        const phoneDigits = (
          c?.phone_normalized || c?.phone || ""
        ).replace(/\D/g, "");
        const casa =
          alvos.some((s) => s.includes(q)) ||
          (qDigits.length >= 3 && phoneDigits.includes(qDigits));
        if (!casa) return false;
      }
      if (dateFilter !== "all") {
        const created = new Date(d.created_at);
        if (dateFilter === "custom") {
          // Período escolhido no calendário. Enquanto só a primeira ponta
          // foi clicada o filtro já vale como "a partir de".
          if (!dentroDoIntervalo(created, dateRange)) return false;
        } else if (dateFilter === "today") {
          if (created.toDateString() !== now.toDateString()) return false;
        } else if (created < cutoff(dateFilter === "7d" ? 7 : 30)) return false;
      }
      if (assigneeFilter === "__none__") {
        if (d.assigned_to != null) return false;
      } else if (assigneeFilter && d.assigned_to !== assigneeFilter) return false;
      if (tagFilter) {
        const cts = (
          d.contact as unknown as { contact_tags?: { tag: { id: string } | null }[] } | null
        )?.contact_tags;
        if (!cts?.some((ct) => ct.tag?.id === tagFilter)) return false;
      }
      return true;
    });
  }, [deals, dateFilter, dateRange, assigneeFilter, tagFilter, searchQuery]);

  // Negócios exibidos NO BOARD. Diferente de `filteredDeals` (que alimenta
  // a régua de análise do topo com todos os status, senão "Perdidos no mês"
  // zeraria), aqui aplicamos o filtro de situação — que por padrão remove
  // os perdidos do funil.
  const boardDeals = useMemo(() => {
    switch (statusFilter) {
      case "ativos":
        return filteredDeals.filter((d) => d.status !== "lost");
      case "ganhos":
        return filteredDeals.filter((d) => d.status === "won");
      case "perdidos":
        return filteredDeals.filter((d) => d.status === "lost");
      default:
        return filteredDeals;
    }
  }, [filteredDeals, statusFilter]);

  const filtroAtivo =
    dateFilter !== "all" ||
    !!assigneeFilter ||
    !!tagFilter ||
    statusFilter !== "ativos" ||
    !!searchQuery.trim();

  const refreshPipelines = useCallback(async () => {
    const list = await loadPipelines();
    setPipelines(list);
    if (list.length === 0) setSelectedPipelineId("");
    else if (!list.some((p) => p.id === selectedPipelineId))
      setSelectedPipelineId(list[0].id);
  }, [loadPipelines, selectedPipelineId]);

  const refreshStages = useCallback(async () => {
    if (!selectedPipelineId) return;
    setStages(await loadStages(selectedPipelineId));
  }, [loadStages, selectedPipelineId]);

  const refreshDeals = useCallback(async () => {
    if (!selectedPipelineId) return;
    setDeals(await loadDeals(selectedPipelineId));
  }, [loadDeals, selectedPipelineId]);

  const handleDealMoved = useCallback(
    async (dealId: string, newStageId: string) => {
      // Optimistic update — board already animated; just persist.
      setDeals((prev) =>
        prev.map((d) => (d.id === dealId ? { ...d, stage_id: newStageId } : d)),
      );
      const { error } = await supabase
        .from("deals")
        .update({ stage_id: newStageId })
        .eq("id", dealId);
      if (error) {
        toast.error("Falha ao mover negócio");
        refreshDeals();
      }
    },
    [supabase, refreshDeals],
  );

  const handleAddDeal = useCallback(
    (stageId?: string) => {
      setEditingDeal(null);
      setDefaultStageId(stageId ?? stages[0]?.id ?? "");
      setDealFormOpen(true);
    },
    [stages],
  );

  const handleEditDeal = useCallback((deal: Deal) => {
    setEditingDeal(deal);
    setDefaultStageId(deal.stage_id);
    setDealFormOpen(true);
  }, []);

  async function handleCreatePipeline() {
    const name = newPipelineName.trim();
    if (!name) return;
    setCreating(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      setCreating(false);
      return;
    }
    // pipelines.account_id is NOT NULL post-017 with no DB default.
    if (!accountId) {
      toast.error("Seu perfil não está vinculado a uma conta.");
      setCreating(false);
      return;
    }

    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .insert({ user_id: user.id, account_id: accountId, name })
      .select()
      .single();

    if (error || !pipeline) {
      toast.error("Falha ao criar funil");
      setCreating(false);
      return;
    }

    const stagesPayload = SPEC_DEFAULT_STAGES.map((s) => ({
      pipeline_id: pipeline.id,
      name: s.name,
      color: s.color,
      position: s.position,
    }));
    await supabase.from("pipeline_stages").insert(stagesPayload);

    setNewPipelineName("");
    setNewPipelineOpen(false);
    setSelectedPipelineId(pipeline.id);
    await refreshPipelines();
    setCreating(false);
    toast.success("Funil criado");
  }

  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 w-48 animate-pulse rounded bg-muted" />
          <div className="h-9 w-28 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="flex gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-96 w-72 animate-pulse rounded-xl bg-muted/50" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Pipeline selector dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors data-[popup-open]:bg-muted"
            >
              <GitBranch className="h-4 w-4 text-primary" />
              <span className="font-semibold">
                {selectedPipeline?.name ?? "Selecionar funil"}
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-64 border-border bg-popover text-popover-foreground"
            >
              {pipelines.length === 0 && (
                <DropdownMenuItem disabled className="text-muted-foreground">
                  Nenhum funil ainda
                </DropdownMenuItem>
              )}
              {pipelines.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => setSelectedPipelineId(p.id)}
                  className={
                    p.id === selectedPipelineId
                      ? "text-primary"
                      : "text-popover-foreground"
                  }
                >
                  <GitBranch className="mr-2 h-3.5 w-3.5" />
                  {p.name}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator className="bg-border" />
              {selectedPipeline && (
                <DropdownMenuItem
                  onClick={() => setSettingsOpen(true)}
                  className="text-popover-foreground"
                >
                  <Settings className="mr-2 h-3.5 w-3.5" />
                  Gerenciar funis
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-2">
          <GatedButton
            variant="outline"
            canAct={canEditSettings}
            gateReason="create pipelines"
            onClick={() => setNewPipelineOpen(true)}
            className="border-border bg-card text-foreground hover:bg-muted"
          >
            <Plus className="mr-1 h-4 w-4" />
            Adicionar funil
          </GatedButton>
          <GatedButton
            canAct={canCreateDeals}
            gateReason="create deals"
            disabled={!selectedPipelineId || stages.length === 0}
            onClick={() => handleAddDeal()}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            Adicionar negócio
          </GatedButton>
        </div>
      </div>

      {/* Filtros do board */}
      {selectedPipelineId ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar negócio: nome, e-mail, telefone..."
              className="h-9 border-border bg-card pl-8 text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <span className="text-xs font-medium text-muted-foreground">Filtros</span>
          <select
            value={dateFilter}
            onChange={(e) => {
              const next = e.target.value as typeof dateFilter;
              setDateFilter(next);
              // Sair do período personalizado zera o intervalo, senão o
              // calendário volta preenchido de uma consulta antiga.
              if (next !== "custom") setDateRange({ from: null, to: null });
            }}
            className="h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground outline-none focus:border-primary"
          >
            <option value="all">Data: todas</option>
            <option value="today">Criados hoje</option>
            <option value="7d">Últimos 7 dias</option>
            <option value="30d">Últimos 30 dias</option>
            <option value="custom">Período no calendário…</option>
          </select>
          {dateFilter === "custom" ? (
            <DateRangePicker
              value={dateRange}
              onChange={setDateRange}
              placeholder="Escolher período"
            />
          ) : null}
          <select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            className="h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground outline-none focus:border-primary"
          >
            <option value="">Responsável: todos</option>
            <option value="__none__">Sem responsável</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name || "Sem nome"}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground outline-none focus:border-primary"
          >
            <option value="ativos">Situação: ativos</option>
            <option value="todos">Todos (inclui perdidos)</option>
            <option value="ganhos">Só ganhos</option>
            <option value="perdidos">Só perdidos</option>
          </select>
          {tags.length > 0 ? (
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-foreground outline-none focus:border-primary"
            >
              <option value="">Tag: todas</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          ) : null}
          {filtroAtivo ? (
            <button
              onClick={() => {
                setDateFilter("all");
                setDateRange({ from: null, to: null });
                setAssigneeFilter("");
                setTagFilter("");
                setStatusFilter("ativos");
                setSearchQuery("");
              }}
              className="text-xs text-primary hover:underline"
            >
              Limpar
            </button>
          ) : null}
          <span className="ml-auto font-mono text-xs text-muted-foreground">
            {boardDeals.length} de {deals.length} negócios
          </span>
        </div>
      ) : null}

      {/* Board */}
      {pipelines.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20">
          <GitBranch className="h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium text-foreground">
            Nenhum funil ainda
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Crie um funil para começar a acompanhar negócios
          </p>
          <GatedButton
            canAct={canEditSettings}
            gateReason="create pipelines"
            onClick={() => setNewPipelineOpen(true)}
            className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            Criar funil
          </GatedButton>
        </div>
      ) : (
        <>
          <PipelineAnalytics stages={stages} deals={filteredDeals} />
          <PipelineBoard
            stages={stages}
            deals={boardDeals}
            onDealMoved={handleDealMoved}
            onAddDeal={handleAddDeal}
            onEditDeal={handleEditDeal}
          />
        </>
      )}

      {/* New Pipeline Dialog */}
      <Dialog open={newPipelineOpen} onOpenChange={setNewPipelineOpen}>
        <DialogContent className="sm:max-w-sm bg-popover border-border">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">Novo funil</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-muted-foreground">Nome do funil</Label>
            <Input
              value={newPipelineName}
              onChange={(e) => setNewPipelineName(e.target.value)}
              placeholder="ex.: Vendas Enterprise"
              className="mt-2 bg-muted border-border text-foreground"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreatePipeline();
              }}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              As etapas padrão (Novo lead → Ganho) serão criadas automaticamente.
            </p>
          </div>
          <DialogFooter className="bg-popover/50 border-border">
            <Button
              variant="outline"
              onClick={() => setNewPipelineOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleCreatePipeline}
              disabled={creating || !newPipelineName.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {creating ? "Criando..." : "Criar funil"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pipeline Settings */}
      {selectedPipeline && (
        <PipelineSettings
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          pipeline={selectedPipeline}
          stages={stages}
          onPipelinesChanged={refreshPipelines}
          onStagesChanged={refreshStages}
          onCreateNewPipeline={() => {
            setSettingsOpen(false);
            setNewPipelineOpen(true);
          }}
        />
      )}

      {/* Deal Form (Sheet) */}
      <DealForm
        open={dealFormOpen}
        onOpenChange={setDealFormOpen}
        deal={editingDeal}
        pipelineId={selectedPipelineId}
        stages={stages}
        defaultStageId={defaultStageId}
        onSaved={refreshDeals}
      />
    </div>
  );
}
