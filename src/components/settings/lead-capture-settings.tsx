"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { FileInput, Loader2, Plus, Copy, Trash2, Check } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

// Captação de lead por formulário (self-service por conta). Cada config tem
// um token na URL; a landing posta o lead em POST /api/leads/[token] e ele
// entra no funil na etapa fixa escolhida. 1 form = 1 etapa. Só admins editam.

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
  token: string;
  pipeline_id: string | null;
  stage_id: string | null;
  welcome_template: string | null;
  enabled: boolean;
}

function newToken() {
  return "lf_" + crypto.randomUUID().replace(/-/g, "");
}

const selectCls =
  "h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60";

export function LeadCaptureSettings() {
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
      supabase.from("lead_capture_config").select("*").eq("account_id", accountId).order("created_at"),
    ]);
    setPipelines((ps as Pipeline[]) ?? []);
    setStages((ss as Stage[]) ?? []);
    setConfigs((cs as Cfg[]) ?? []);
    setLoading(false);
  }, [accountId, supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    (typeof window !== "undefined" ? window.location.origin : "");
  const urlFor = (token: string) => `${origin}/api/leads/${token}`;

  function startNew() {
    setEditing({
      id: "",
      name: "",
      token: newToken(),
      pipeline_id: pipelines[0]?.id ?? null,
      stage_id: null,
      welcome_template: "",
      enabled: true,
    });
  }

  async function save() {
    if (!editing || !accountId) return;
    if (!editing.name.trim()) return toast.error("Dê um nome ao formulário");
    if (!editing.pipeline_id) return toast.error("Escolha um funil");
    setSaving(true);
    const row = {
      account_id: accountId,
      name: editing.name.trim(),
      token: editing.token,
      pipeline_id: editing.pipeline_id,
      stage_id: editing.stage_id,
      welcome_template: editing.welcome_template?.trim() || null,
      enabled: editing.enabled,
    };
    const { error } = editing.id
      ? await supabase.from("lead_capture_config").update(row).eq("id", editing.id)
      : await supabase.from("lead_capture_config").insert(row);
    setSaving(false);
    if (error) return toast.error("Falha ao salvar: " + error.message);
    toast.success("Formulário salvo");
    setEditing(null);
    load();
  }

  async function remove(id: string) {
    const { error } = await supabase.from("lead_capture_config").delete().eq("id", id);
    if (error) return toast.error("Falha ao excluir");
    toast.success("Formulário excluído");
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

  if (!canEditSettings) return null;

  return (
    <section className="mt-8 max-w-2xl">
      <div className="mb-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <FileInput className="size-4 text-primary" /> Captação por formulário
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Gere uma URL pra a sua landing postar leads direto num funil, numa etapa fixa. A
          página envia um POST com <code className="text-xs">nome</code>,{" "}
          <code className="text-xs">telefone</code> e (opcional){" "}
          <code className="text-xs">email</code> pra a URL abaixo.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando…
        </div>
      ) : (
        <div className="space-y-4">
          {configs.length > 0 && (
            <div className="space-y-2">
              {configs.map((c) => (
                <Card key={c.id}>
                  <CardContent className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <FileInput className="size-4 text-primary" />
                        {c.name}
                        {!c.enabled && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                            desativado
                          </span>
                        )}
                      </div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        {pipelines.find((p) => p.id === c.pipeline_id)?.name ?? "—"}
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
              <Plus className="size-4" /> Novo formulário
            </Button>
          )}

          {editing && (
            <Card>
              <CardHeader>
                <CardTitle className="text-foreground">
                  {editing.id ? "Editar formulário" : "Novo formulário"}
                </CardTitle>
                <CardDescription className="text-muted-foreground">
                  Escolha o funil e a etapa onde o lead do formulário entra.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">Nome</Label>
                  <Input
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    placeholder="Ex.: Landing Formulações Otológicas"
                  />
                </div>

                <div className="grid gap-2">
                  <Label className="text-muted-foreground">Funil</Label>
                  <select
                    className={selectCls}
                    value={editing.pipeline_id ?? ""}
                    onChange={(e) =>
                      setEditing({ ...editing, pipeline_id: e.target.value, stage_id: null })
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
                  <Label className="text-muted-foreground">Etapa do lead</Label>
                  <select
                    className={selectCls}
                    value={editing.stage_id ?? ""}
                    disabled={!editing.pipeline_id}
                    onChange={(e) => setEditing({ ...editing, stage_id: e.target.value || null })}
                  >
                    <option value="">Primeira etapa do funil</option>
                    {editStages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-2">
                  <Label className="text-muted-foreground">
                    Template de boas-vindas (WhatsApp) — opcional
                  </Label>
                  <Input
                    value={editing.welcome_template ?? ""}
                    onChange={(e) => setEditing({ ...editing, welcome_template: e.target.value })}
                    placeholder="ex.: boas_vindas_lead"
                  />
                  <p className="text-xs text-muted-foreground">
                    Se aprovado na Meta, dispara logo após o cadastro. Vazio = só cria o lead.
                  </p>
                </div>

                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={editing.enabled}
                    onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
                    className="size-4 accent-[var(--primary)]"
                  />
                  Ativo
                </label>

                <div className="grid gap-2">
                  <Label className="text-muted-foreground">URL do formulário (a landing posta aqui)</Label>
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
    </section>
  );
}
