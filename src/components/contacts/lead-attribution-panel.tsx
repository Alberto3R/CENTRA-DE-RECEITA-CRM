"use client";

import { useEffect, useState } from "react";
import { Loader2, Megaphone, MessageCircle } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { adCardFromAttribution } from "@/lib/acquisition/ad-referral";
import { AdReferralCard } from "./ad-referral-card";

// Mostra a ORIGEM do lead (atribuição). Os dados são capturados pela
// captação (/api/leads) e pelo webhook (ctwa_clid), mas até aqui não
// apareciam em lugar nenhum. Lê a `lead_attribution` mais recente do
// contato e exibe campanha, ângulo, UTMs, classificação e se veio de
// anúncio Click-to-WhatsApp.

interface Attribution {
  source: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  ang: string | null;
  classificacao: string | null;
  ad_id: string | null;
  ctwa_clid: string | null;
  landing_url: string | null;
  raw: unknown;
  created_at: string | null;
}

const CLASSIF: Record<string, { label: string; cls: string }> = {
  verde: { label: "Verde (qualificado)", cls: "bg-emerald-500/15 text-emerald-500" },
  amarelo: { label: "Amarelo (em avaliação)", cls: "bg-amber-500/15 text-amber-500" },
  vermelho: { label: "Vermelho (off-gate)", cls: "bg-red-500/15 text-red-500" },
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex flex-col gap-0.5 border-b border-border/60 py-2 last:border-0">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm text-foreground break-words">{value}</span>
    </div>
  );
}

export function LeadAttributionPanel({ contactId }: { contactId: string }) {
  const supabase = createClient();
  const [attr, setAttr] = useState<Attribution | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("lead_attribution")
        .select(
          "source, utm_source, utm_medium, utm_campaign, utm_content, utm_term, ang, classificacao, ad_id, ctwa_clid, landing_url, raw, created_at",
        )
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (alive) {
        setAttr((data as Attribution) ?? null);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [contactId, supabase]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-1 py-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Carregando…
      </div>
    );
  }

  if (!attr) {
    return (
      <p className="px-1 py-4 text-sm text-muted-foreground">
        Sem dados de origem para este contato. Leads de tráfego pago e de
        anúncios Click-to-WhatsApp trazem a atribuição automaticamente.
      </p>
    );
  }

  const fromCtwa = !!attr.ctwa_clid;
  const classif = attr.classificacao ? CLASSIF[attr.classificacao.toLowerCase()] : null;
  const when = attr.created_at
    ? new Date(attr.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    : null;

  const adCard = adCardFromAttribution(attr);

  return (
    <div className="space-y-1">
      {adCard && (
        <div className="mb-3">
          <AdReferralCard card={adCard} />
        </div>
      )}
      {fromCtwa && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">
          <MessageCircle className="size-4 shrink-0" />
          Veio de um anúncio Click-to-WhatsApp (conversão devolvida à Meta)
        </div>
      )}
      {!fromCtwa && attr.source && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
          <Megaphone className="size-4 shrink-0 text-muted-foreground" />
          Fonte: <span className="font-medium">{attr.source}</span>
        </div>
      )}

      <Row
        label="Classificação"
        value={
          classif ? (
            <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${classif.cls}`}>
              {classif.label}
            </span>
          ) : (
            attr.classificacao
          )
        }
      />
      <Row label="Campanha" value={attr.utm_campaign} />
      <Row label="Ângulo" value={attr.ang} />
      <Row label="Criativo / conteúdo" value={attr.utm_content} />
      <Row label="Mídia" value={attr.utm_medium} />
      <Row label="Origem (utm_source)" value={attr.utm_source} />
      <Row label="Termo" value={attr.utm_term} />
      <Row label="Anúncio (ID)" value={attr.ad_id} />
      <Row
        label="Página de entrada"
        value={
          attr.landing_url ? (
            <a
              href={attr.landing_url}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-2 hover:underline"
            >
              {attr.landing_url}
            </a>
          ) : null
        }
      />
      <Row label="Capturado em" value={when} />
    </div>
  );
}
