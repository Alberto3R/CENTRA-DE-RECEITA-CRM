"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Webhook, Loader2, Plus, Copy, Trash2, Check } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { SettingsPanelHead } from "./settings-panel-head";
import { LeadCaptureSettings } from "./lead-capture-settings";

// Webhooks de gateway de pagamento (Voomp etc.). Cada config tem um token
// próprio na URL e mapeia eventos do gateway → etapas de um funil. O
// endpoint /api/webhooks/gateway/[token] consome essa config. Só admins
// editam (RLS `admins write gateway config`).

interface Pipeline {
  id: string;
  name: string;
}
interface Stage {
  id: string;
  name: string;
  position: number;
  pipeline_id: string;
}
interface Cfg {
  id: string;
  name: string;
  provider: string;
  token: string;
  pipeline_id: string | null;
  stage_map: Record<string, string>;
  enabled: boolean;
  recovery_template: string | null;
  auto_route_by_name: boolean;
}

function newToken() {
  return "gw_" + crypto.randomUUID().replace(/-/g, "");
}

const selectCls =
  "h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60";

export function WebhooksSettings() {
  const supabase = createClient();
  const { accountId, canEditSettings } = useAuth();

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [configs, setConfigs] = useState<Cfg[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Cfg | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const [{ data: ps }, { data: ss }, { data: cs }] = await Promise.all([
      supabase.from("pipelines").select("id, name").eq("account_id", accountId).order("name"),
      supabase.from("pipeline_stages").select("id, name, position, pipeline_id").order("position"),
      supabase.from("gateway_webhook_config").select("*").eq("account_id", accountId).order("created_at"),
    ]);
    setPipelines((ps as Pipeline[]) ?? []);
    setStages((ss as Stage[]) ?? []);
    setConfigs((cs as Cfg[]) ?? []);
    setLoading(false);
  }, [accountId, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  // Domínio canônico do CRM (NEXT_PUBLIC_SITE_URL = https://vendas.sales3r.com.br)
  // pra a URL do webhook sair sempre na marca, não no host que o admin abriu.
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    (typeof window !== "undefined" ? window.location.origin : "");
  const urlFor = (token: string) => `${origin}/api/webhooks/gateway/${token}`;

  function startNew() {
    setEditing({
      id: "",
      name: "",
      provider: "voomp",
      token: newToken(),
      pipeline_id: pipelines[0]?.id ?? null,
      stage_map: {},
      enabled: true,
      recovery_template: "",
      auto_route_by_name: false,
    });
  }

  // Eventos lógicos (escondem os aliases de trigger de cada gateway —
  // Voomp e Hotmart). A leitura aceita a chave de qualquer provedor pra a
  // config aparecer certa na tela independentemente de quem a criou.
  const map = editing?.stage_map ?? {};
  const compra = map.salePaid ?? map.PURCHASE_APPROVED ?? "";
  const abandono = map.checkoutAbandoned ?? map.PURCHASE_OUT_OF_SHOPPING_CART ?? "";
  const recuperacao = map.waiting_payment ?? map.PURCHASE_BILLET_PRINTED ?? "";
  const refundOn =
    map.saleRefunded === "refund" || map.PURCHASE_REFUNDED === "refund";

  function setEvent(
    kind: "compra" | "abandono" | "recuperacao" | "refund",
    value: string | boolean,
  ) {
    setEditing((prev) => {
      if (!prev) return prev;
      const m = { ...prev.stage_map };
      // Cada evento lógico grava as chaves dos DOIS gateways (Voomp +
      // Hotmart) — o endpoint casa a que o provedor enviar. Assim a mesma
      // config funciona pra Voomp e Hotmart sem o admin escolher aliases.
      if (kind === "compra") {
        for (const k of ["salePaid", "saleApproved", "paid", "PURCHASE_APPROVED", "PURCHASE_COMPLETE"])
          delete m[k];
        if (value) {
          const v = value as string;
          for (const k of ["salePaid", "saleApproved", "paid", "PURCHASE_APPROVED", "PURCHASE_COMPLETE"])
            m[k] = v;
        }
      } else if (kind === "abandono") {
        for (const k of ["checkoutAbandoned", "abandonedCart", "abandonedCheckout", "saleAbandonedCart", "PURCHASE_OUT_OF_SHOPPING_CART"])
          delete m[k];
        if (value) {
          const v = value as string;
          for (const k of ["checkoutAbandoned", "abandonedCart", "abandonedCheckout", "saleAbandonedCart", "PURCHASE_OUT_OF_SHOPPING_CART"])
            m[k] = v;
        }
      } else if (kind === "recuperacao") {
        for (const k of ["waiting_payment", "pixGenerated", "pixCreated", "PURCHASE_BILLET_PRINTED", "PURCHASE_DELAYED"])
          delete m[k];
        if (value) {
          const v = value as string;
          for (const k of ["waiting_payment", "pixGenerated", "pixCreated", "PURCHASE_BILLET_PRINTED", "PURCHASE_DELAYED"])
            m[k] = v;
        }
      } else {
        for (const k of ["saleRefunded", "saleChargeback", "refunded", "chargedback", "PURCHASE_REFUNDED", "PURCHASE_CHARGEBACK", "PURCHASE_PROTEST"])
          delete m[k];
        if (value) {
          for (const k of ["saleRefunded", "saleChargeback", "refunded", "chargedback", "PURCHASE_REFUNDED", "PURCHASE_CHARGEBACK", "PURCHASE_PROTEST"])
            m[k] = "refund";
        }
      }
      return { ...prev, stage_map: m };
    });
  }

  async function save() {
    if (!editing || !accountId) return;
    if (!editing.name.trim()) return toast.error("Dê um nome ao webhook");
    if (!editing.pipeline_id) return toast.error("Escolha um funil");
    setSaving(true);
    const row = {
      account_id: accountId,
      name: editing.name.trim(),
      provider: editing.provider,
      token: editing.token,
      pipeline_id: editing.pipeline_id,
      stage_map: editing.stage_map,
      enabled: editing.enabled,
      recovery_template: editing.recovery_template?.trim() || null,
      auto_route_by_name: editing.auto_route_by_name,
    };
    const { error } = editing.id
      ? await supabase.from("gateway_webhook_config").update(row).eq("id", editing.id)
      : await supabase.from("gateway_webhook_config").insert(row);
    setSaving(false);
    if (error) return toast.error("Falha ao salvar: " + error.message);
    toast.success("Webhook salvo");
    setEditing(null);
    load();
  }

  async function remove(id: string) {
    const { error } = await supabase.from("gateway_webhook_config").delete().eq("id", id);
    if (error) return toast.error("Falha ao excluir");
    toast.success("Webhook excluído");
    if (editing?.id === id) setEditing(null);
    load();
  }

  async function copyUrl(token: string) {
    await navigator.clipboard.writeText(urlFor(token));
    setCopied(true);
    toast.success("URL copiada");
    setTimeout(() => setCopied(false), 1500);
  }

  const editStages = stages.filter((s) => s.pipeline_id === editing?.pipeline_id);

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Webhooks"
        description="Receba vendas e abandonos de um gateway (Voomp etc.) direto num funil — com tag do produto e na etapa do evento. Configure o webhook por produto no gateway apontando para a URL gerada aqui."
      />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando…
        </div>
      ) : !canEditSettings ? (
        <p className="text-sm text-muted-foreground">
          Apenas administradores da conta podem configurar webhooks.
        </p>
      ) : (
        <div className="space-y-4">
          {/* Lista */}
          {configs.length > 0 && (
            <div className="space-y-2">
              {configs.map((c) => (
                <Card key={c.id}>
                  <CardContent className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Webhook className="size-4 text-primary" />
                        {c.name}
                        {!c.enabled && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                            desativado
                          </span>
                        )}
                      </div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        {pipelines.find((p) => p.id === c.pipeline_id)?.name ?? "—"} ·{" "}
                        {c.provider}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => copyUrl(c.token)}>
                        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(c)}>
                        Editar
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => remove(c.id)}>
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {!editing && (
            <Button
              onClick={startNew}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="size-4" /> Novo webhook
            </Button>
          )}

          {/* Editor */}
          {editing && (
            <Card>
              <CardHeader>
                <CardTitle className="text-foreground">
                  {editing.id ? "Editar webhook" : "Novo webhook"}
                </CardTitle>
                <CardDescription className="text-muted-foreground">
                  Escolha o funil e a etapa para cada evento do gateway.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">Nome</Label>
                  <Input
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    placeholder="Ex.: Voomp · Low Tickets"
                  />
                </div>

                <div className="grid gap-2">
                  <Label className="text-muted-foreground">Gateway</Label>
                  <select
                    className={selectCls}
                    value={editing.provider}
                    onChange={(e) => setEditing({ ...editing, provider: e.target.value })}
                  >
                    <option value="voomp">Voomp</option>
                    <option value="hotmart">Hotmart</option>
                  </select>
                </div>

                <div className="grid gap-2">
                  <Label className="text-muted-foreground">Funil</Label>
                  <select
                    className={selectCls}
                    value={editing.pipeline_id ?? ""}
                    onChange={(e) =>
                      setEditing({ ...editing, pipeline_id: e.target.value, stage_map: {} })
                    }
                  >
                    <option value="">Selecione…</option>
                    {pipelines.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-2">
                  <Label className="text-muted-foreground">Compra aprovada → etapa</Label>
                  <select
                    className={selectCls}
                    value={compra}
                    disabled={!editing.pipeline_id}
                    onChange={(e) => setEvent("compra", e.target.value)}
                  >
                    <option value="">Não criar</option>
                    {editStages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-2">
                  <Label className="text-muted-foreground">Carrinho abandonado → etapa</Label>
                  <select
                    className={selectCls}
                    value={abandono}
                    disabled={!editing.pipeline_id}
                    onChange={(e) => setEvent("abandono", e.target.value)}
                  >
                    <option value="">Não criar</option>
                    {editStages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-2">
                  <Label className="text-muted-foreground">
                    PIX não pago / recuperação → etapa
                  </Label>
                  <select
                    className={selectCls}
                    value={recuperacao}
                    disabled={!editing.pipeline_id}
                    onChange={(e) => setEvent("recuperacao", e.target.value)}
                  >
                    <option value="">Não criar</option>
                    {editStages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                {recuperacao && (
                  <div className="grid gap-2">
                    <Label className="text-muted-foreground">
                      Template de recuperação (WhatsApp)
                    </Label>
                    <Input
                      value={editing.recovery_template ?? ""}
                      onChange={(e) =>
                        setEditing({ ...editing, recovery_template: e.target.value })
                      }
                      placeholder="ex.: eqv_pix_pendente"
                    />
                    <p className="text-xs text-muted-foreground">
                      Disparado quando chega um PIX não pago. Vazio = só cria o lead, sem
                      mensagem. O agente assume quando a pessoa responde.
                    </p>
                  </div>
                )}

                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={refundOn}
                    onChange={(e) => setEvent("refund", e.target.checked)}
                    className="size-4 accent-[var(--primary)]"
                  />
                  No reembolso/estorno, marcar o negócio como perdido
                </label>

                <label className="flex items-start gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={editing.auto_route_by_name}
                    onChange={(e) =>
                      setEditing({ ...editing, auto_route_by_name: e.target.checked })
                    }
                    className="mt-0.5 size-4 accent-[var(--primary)]"
                  />
                  <span>
                    Rotear por nome do produto
                    <span className="block text-xs text-muted-foreground">
                      Se existir um funil com o mesmo nome do produto da venda, o lead vai
                      pra lá (e a etapa é escolhida pelo nome das etapas). Sem funil
                      correspondente, cai no funil acima.
                    </span>
                  </span>
                </label>

                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={editing.enabled}
                    onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
                    className="size-4 accent-[var(--primary)]"
                  />
                  Ativo
                </label>

                {/* URL do webhook */}
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">
                    URL do webhook (cole no gateway, em cada produto)
                  </Label>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-muted px-2.5 py-2 text-xs text-foreground">
                      {urlFor(editing.token)}
                    </code>
                    <Button variant="outline" size="sm" onClick={() => copyUrl(editing.token)}>
                      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                    </Button>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <Button
                    onClick={save}
                    disabled={saving}
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    {saving ? <Loader2 className="size-4 animate-spin" /> : "Salvar"}
                  </Button>
                  <Button variant="ghost" onClick={() => setEditing(null)}>
                    Cancelar
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <LeadCaptureSettings />
    </section>
  );
}
