"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bot, KeyRound, Loader2 } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { GatedButton } from "@/components/ui/gated-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { SettingsPanelHead } from "./settings-panel-head";

/**
 * AI agent settings — per-account persona/config for the auto-reply
 * agent.
 *
 * Reads `GET /api/ai-agent/config` on mount and writes back through
 * `PUT`. The account is resolved server-side from the session, so the
 * UI never sends an account_id. Writes are admin-gated: the API's
 * upsert sits behind an RLS policy that returns 403 for non-admins, so
 * the form mirrors the other workspace panels and disables every
 * control (plus the save) when `canEditSettings` is false.
 *
 * The model API key (ANTHROPIC_API_KEY) lives in the server env, not
 * here — the note in the panel makes that explicit so admins don't go
 * looking for a key field that intentionally doesn't exist.
 */

interface AgentConfig {
  name: string;
  enabled: boolean;
  system_prompt: string;
  model: string;
  max_tokens: number;
  handoff_keyword: string;
  handoff_message: string;
}

interface ChannelLite {
  id: string;
  label: string | null;
  phone_number_id: string;
  is_primary: boolean | null;
}

const DEFAULT_MODEL = "claude-sonnet-4-6";
const MIN_TOKENS = 256;
const MAX_TOKENS = 4000;

const EMPTY: AgentConfig = {
  name: "",
  enabled: false,
  system_prompt: "",
  model: DEFAULT_MODEL,
  max_tokens: 1500,
  handoff_keyword: "",
  handoff_message: "Vou te passar pro nosso time, um instante 🙂",
};

function normalizeConfig(config: Partial<AgentConfig> | null): AgentConfig {
  return {
    name: typeof config?.name === "string" ? config.name : "",
    enabled: config?.enabled === true,
    system_prompt:
      typeof config?.system_prompt === "string" ? config.system_prompt : "",
    model:
      typeof config?.model === "string" && config.model.trim()
        ? config.model
        : DEFAULT_MODEL,
    max_tokens:
      typeof config?.max_tokens === "number" && Number.isFinite(config.max_tokens)
        ? config.max_tokens
        : EMPTY.max_tokens,
    handoff_keyword:
      typeof config?.handoff_keyword === "string" ? config.handoff_keyword : "",
    handoff_message:
      typeof config?.handoff_message === "string"
        ? config.handoff_message
        : EMPTY.handoff_message,
  };
}

export function AiAgentSettings() {
  const { canEditSettings, accountId } = useAuth();
  const supabase = createClient();

  const [form, setForm] = useState<AgentConfig>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Multi-agente: 1 agente por canal.
  const [channels, setChannels] = useState<ChannelLite[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);

  // Carrega a config do agente de UM canal.
  async function loadAgent(channelId: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/ai-agent/config?channelId=${channelId}`);
      if (!res.ok) throw new Error(String(res.status));
      const { config } = (await res.json()) as {
        config: Partial<AgentConfig> | null;
      };
      setForm(normalizeConfig(config));
    } catch {
      toast.error("Falha ao carregar a configuração do agente");
    } finally {
      setLoading(false);
    }
  }

  // No mount: lista os canais, seleciona o primário e carrega o agente dele.
  useEffect(() => {
    if (!accountId) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("whatsapp_config")
        .select("id, label, phone_number_id, is_primary")
        .eq("account_id", accountId)
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: true });
      if (!active) return;
      const rows = (data ?? []) as ChannelLite[];
      setChannels(rows);
      const first = rows[0]?.id ?? null;
      setSelectedChannelId(first);
      if (first) {
        await loadAgent(first);
      } else {
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  function selectChannel(id: string) {
    setSelectedChannelId(id);
    void loadAgent(id);
  }

  function set<K extends keyof AgentConfig>(key: K, value: AgentConfig[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!canEditSettings) return;
    setSaving(true);
    try {
      const res = await fetch("/api/ai-agent/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: selectedChannelId,
          name: form.name.trim(),
          enabled: form.enabled,
          system_prompt: form.system_prompt,
          model: form.model.trim() || DEFAULT_MODEL,
          max_tokens: form.max_tokens,
          handoff_keyword: form.handoff_keyword.trim(),
          handoff_message: form.handoff_message,
        }),
      });

      if (res.status === 403) {
        toast.error("Só administradores podem editar");
        return;
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error || "Falha ao salvar a configuração do agente");
        return;
      }

      const { config } = (await res.json()) as { config: Partial<AgentConfig> | null };
      if (config) setForm(normalizeConfig(config));
      toast.success("Configuração do agente salva");
    } catch {
      toast.error("Falha ao salvar a configuração do agente");
    } finally {
      setSaving(false);
    }
  }

  const disabled = !canEditSettings || loading;

  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Agente IA"
        description="A persona e o comportamento do agente de IA de cada canal. Cada número de WhatsApp tem seu próprio agente (ex.: SDR num, Onboarding noutro)."
      />

      {channels.length > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Canal</span>
          {channels.map((ch) => {
            const active = ch.id === selectedChannelId;
            return (
              <button
                key={ch.id}
                type="button"
                onClick={() => selectChannel(ch.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-muted text-muted-foreground hover:bg-muted/70"
                }`}
              >
                {ch.label || ch.phone_number_id}
                {ch.is_primary && (
                  <span title="Canal primário" className="text-amber-400">
                    ★
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Bot className="size-4 text-primary" />
            Agente de IA
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Defina quando o agente responde, como ele se comporta e quando deve
            passar a conversa para um humano.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Nome do agente */}
          <div className="grid gap-2">
            <Label htmlFor="ai-agent-name" className="text-muted-foreground">
              Nome do agente
            </Label>
            <Input
              id="ai-agent-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              disabled={disabled}
              maxLength={60}
              placeholder="ex.: SDR, Onboarding, Suporte"
            />
          </div>

          {/* Ativar agente */}
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/30 p-4">
            <div className="space-y-1">
              <Label htmlFor="ai-agent-enabled" className="text-foreground">
                Ativar agente
              </Label>
              <p className="text-xs text-muted-foreground">
                Quando ativo, o agente responde automaticamente as novas
                mensagens recebidas.
              </p>
            </div>
            <Switch
              id="ai-agent-enabled"
              checked={form.enabled}
              onCheckedChange={(v) => set("enabled", !!v)}
              disabled={disabled}
              aria-label={form.enabled ? "Desativar agente" : "Ativar agente"}
            />
          </div>

          {/* Instruções (persona) */}
          <div className="grid gap-2">
            <Label htmlFor="ai-agent-prompt" className="text-muted-foreground">
              Instruções do agente (persona)
            </Label>
            <Textarea
              id="ai-agent-prompt"
              value={form.system_prompt}
              onChange={(e) => set("system_prompt", e.target.value)}
              disabled={disabled}
              rows={10}
              className="min-h-48 resize-y"
              placeholder="Você é o atendente da nossa empresa. Seja cordial, objetivo e use português do Brasil. Responda dúvidas sobre nossos produtos e ajude a agendar reuniões..."
            />
            <p className="text-xs text-muted-foreground">
              É o cérebro do agente: descreva quem ele é, o tom de voz, o que
              pode e o que não pode fazer.
            </p>
          </div>

          {/* Modelo + Máximo de tokens */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="ai-agent-model" className="text-muted-foreground">
                Modelo
              </Label>
              <Input
                id="ai-agent-model"
                value={form.model}
                onChange={(e) => set("model", e.target.value)}
                disabled={disabled}
                placeholder={DEFAULT_MODEL}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="ai-agent-tokens" className="text-muted-foreground">
                Máximo de tokens
              </Label>
              <Input
                id="ai-agent-tokens"
                type="number"
                min={MIN_TOKENS}
                max={MAX_TOKENS}
                value={form.max_tokens}
                onChange={(e) => set("max_tokens", Number(e.target.value))}
                disabled={disabled}
              />
              <p className="text-xs text-muted-foreground">
                Entre {MIN_TOKENS} e {MAX_TOKENS}. Limita o tamanho de cada
                resposta.
              </p>
            </div>
          </div>

          {/* Transferência para humano */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label
                htmlFor="ai-agent-handoff-keyword"
                className="text-muted-foreground"
              >
                Palavra de transferência
              </Label>
              <Input
                id="ai-agent-handoff-keyword"
                value={form.handoff_keyword}
                onChange={(e) => set("handoff_keyword", e.target.value)}
                disabled={disabled}
                placeholder="atendente"
              />
              <p className="text-xs text-muted-foreground">
                Quando o cliente disser isso, o agente passa a conversa para um
                humano.
              </p>
            </div>

            <div className="grid gap-2">
              <Label
                htmlFor="ai-agent-handoff-message"
                className="text-muted-foreground"
              >
                Mensagem ao transferir
              </Label>
              <Input
                id="ai-agent-handoff-message"
                value={form.handoff_message}
                onChange={(e) => set("handoff_message", e.target.value)}
                disabled={disabled}
                placeholder="Vou te passar pro nosso time, um instante 🙂"
              />
              <p className="text-xs text-muted-foreground">
                Enviada ao cliente no momento da transferência.
              </p>
            </div>
          </div>

          {/* Nota: chave de API no servidor */}
          <Alert>
            <KeyRound />
            <AlertTitle>A chave da API fica no servidor</AlertTitle>
            <AlertDescription>
              A chave da Anthropic (ANTHROPIC_API_KEY) é configurada no servidor
              (Vercel), não aqui. Esta tela só define a persona e o comportamento
              do agente.
            </AlertDescription>
          </Alert>

          {!canEditSettings && (
            <p className="text-xs text-muted-foreground">
              Apenas administradores da conta podem editar a configuração do
              agente.
            </p>
          )}

          <GatedButton
            canAct={canEditSettings}
            gateReason="editar o agente de IA"
            onClick={handleSave}
            disabled={saving || loading}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Salvando...
              </>
            ) : (
              "Salvar"
            )}
          </GatedButton>
        </CardContent>
      </Card>
    </section>
  );
}
