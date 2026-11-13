"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, ImageOff, Megaphone, PlayCircle } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { adCardFromAttribution, type AdCard } from "@/lib/acquisition/ad-referral";
import { cn } from "@/lib/utils";

// Cartão do ANÚNCIO de onde o lead veio (Click-to-WhatsApp / post com botão
// de WhatsApp): foto do criativo, título, texto e link do post. É o que o
// vendedor via só no celular — "qual anúncio o cliente marcou, qual produto".
// Vale para qualquer conta e qualquer canal (API oficial e QR/Z-API): os dois
// webhooks gravam o criativo em `lead_attribution.raw`.

/**
 * Anúncio mais recente do contato. `refreshKey` refaz a busca enquanto ainda
 * não achou nada — a atribuição é gravada logo DEPOIS da 1ª mensagem, então a
 * conversa pode abrir um instante antes de ela existir.
 */
export function useAdCard(contactId: string | null | undefined, refreshKey?: unknown) {
  // Resultado guardado junto com o contato a que pertence: trocar de conversa
  // invalida na hora, sem efeito que zere o estado.
  const [res, setRes] = useState<{ id: string; card: AdCard | null } | null>(null);
  const current = contactId && res?.id === contactId ? res : null;
  const found = !!current?.card;

  useEffect(() => {
    if (!contactId || found) return;
    let alive = true;
    (async () => {
      const { data } = await createClient()
        .from("lead_attribution")
        .select("source, ad_id, landing_url, raw")
        .eq("contact_id", contactId)
        .in("source", ["ctwa", "whatsapp-post"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (alive) setRes({ id: contactId, card: data ? adCardFromAttribution(data) : null });
    })();
    return () => {
      alive = false;
    };
  }, [contactId, refreshKey, found]);

  return { card: current?.card ?? null, loading: !!contactId && !current };
}

function label(card: AdCard) {
  return card.isPost ? "Veio de um post" : "Veio do anúncio";
}

function Thumb({ card, className }: { card: AdCard; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (!card.imageUrl || broken) {
    return (
      <div
        className={cn(
          "flex shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground",
          className,
        )}
        title="O anúncio chegou sem imagem — abra o link para ver o post"
      >
        {card.imageUrl ? <ImageOff className="size-4" /> : <Megaphone className="size-4" />}
      </div>
    );
  }
  return (
    <a
      href={card.imageUrl}
      target="_blank"
      rel="noreferrer"
      className={cn("relative block shrink-0 overflow-hidden rounded-md bg-muted", className)}
      title="Abrir a imagem do anúncio"
    >
      <img
        src={card.imageUrl}
        alt={card.headline ?? "Imagem do anúncio"}
        className="h-full w-full object-cover"
        onError={() => setBroken(true)}
      />
      {card.isVideo && (
        <PlayCircle className="absolute inset-0 m-auto size-6 text-white drop-shadow" />
      )}
    </a>
  );
}

function AdLink({ card }: { card: AdCard }) {
  if (!card.url) return null;
  return (
    <a
      href={card.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
    >
      Ver {card.isPost ? "post" : "anúncio"}
      <ExternalLink className="size-3" />
    </a>
  );
}

/** Faixa no topo da conversa: compacta, abre para mostrar o criativo inteiro. */
export function AdReferralBanner({
  contactId,
  refreshKey,
}: {
  contactId: string;
  refreshKey?: unknown;
}) {
  const { card } = useAdCard(contactId, refreshKey);
  // A conversa monta a faixa com `key={contactId}`: trocar de conversa
  // recomeça recolhida.
  const [open, setOpen] = useState(false);
  if (!card) return null;

  return (
    <div className="border-b border-border bg-card/95 px-3 py-2 sm:px-4">
      <div className="flex items-center gap-3">
        <Thumb card={card} className="size-10" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Megaphone className="size-3" />
            {label(card)}
          </p>
          <p className="truncate text-sm text-foreground">
            {card.headline ?? card.body ?? "Anúncio sem título"}
          </p>
        </div>
        <AdLink card={card} />
        {(card.body || card.imageUrl) && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            title={open ? "Recolher" : "Ver o anúncio inteiro"}
            aria-expanded={open}
          >
            {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          {card.imageUrl && <Thumb card={card} className="h-40 w-full sm:w-40" />}
          {card.body && (
            <p className="max-h-40 min-w-0 flex-1 overflow-y-auto whitespace-pre-line text-sm text-muted-foreground">
              {card.body}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Cartão inteiro — barra lateral do inbox e aba Origem do contato. */
export function AdReferralCard({ card }: { card: AdCard }) {
  const [more, setMore] = useState(false);
  const longBody = (card.body?.length ?? 0) > 160;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {card.imageUrl ? (
        <Thumb card={card} className="aspect-square max-h-56 w-full rounded-none" />
      ) : null}
      <div className="space-y-1.5 p-3">
        <p className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <Megaphone className="size-3" />
          {label(card)}
        </p>
        {card.headline && <p className="text-sm font-medium text-foreground">{card.headline}</p>}
        {card.body && (
          <p
            className={cn(
              "whitespace-pre-line text-xs text-muted-foreground",
              !more && longBody && "line-clamp-4",
            )}
          >
            {card.body}
          </p>
        )}
        {longBody && (
          <button
            type="button"
            onClick={() => setMore((v) => !v)}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {more ? "ver menos" : "ver mais"}
          </button>
        )}
        {!card.imageUrl && (
          <p className="text-xs text-muted-foreground">
            Sem imagem gravada — o link abre o post com a foto.
          </p>
        )}
        <AdLink card={card} />
      </div>
    </div>
  );
}

/** Versão que busca sozinha (barra lateral do inbox). Some se não for anúncio. */
export function ContactAdReferral({ contactId }: { contactId: string }) {
  const { card } = useAdCard(contactId);
  if (!card) return null;
  return <AdReferralCard card={card} />;
}
