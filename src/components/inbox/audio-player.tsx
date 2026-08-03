"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Player de áudio das mensagens.
 *
 * Substitui o `<audio controls>` nativo, que renderiza o player do sistema
 * operacional dentro da bolha — cinza, com largura fixa, ignorando o tema da
 * página e destoando em light/dark. Aqui tudo é desenhado por nós.
 *
 * Cor: nada é hard-coded. As barras usam `bg-current`, então o player herda
 * `text-primary-foreground` na bolha de saída e `text-foreground` na de
 * entrada, e continua legível se a paleta mudar.
 *
 * A onda é calculada a partir do PCM real quando o navegador consegue
 * decodificar o arquivo, e cai numa onda determinística (derivada da URL)
 * quando não consegue — Safari não decodifica Ogg/Opus de forma confiável, e
 * uma onda plausível é melhor do que um bloco vazio no lugar do player.
 */

const BAR_COUNT = 44;
const SPEEDS = [1, 1.5, 2] as const;

/** Ondinha estável por URL: mesma mensagem, mesmo desenho a cada render. */
function fallbackPeaks(seed: string): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  const peaks: number[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    h = (h * 1103515245 + 12345) | 0;
    const noise = ((h >>> 16) & 0xff) / 255;
    // Envelope senoidal: as pontas ficam mais baixas que o miolo, que é como
    // um recado de voz costuma se parecer — ruído puro parece código de barras.
    const envelope = Math.sin((i / (BAR_COUNT - 1)) * Math.PI);
    peaks.push(0.15 + noise * 0.85 * (0.35 + envelope * 0.65));
  }
  return peaks;
}

/** Reduz o PCM decodificado a BAR_COUNT picos normalizados (0..1). */
function peaksFromBuffer(buffer: AudioBuffer): number[] {
  const data = buffer.getChannelData(0);
  const block = Math.floor(data.length / BAR_COUNT) || 1;
  const peaks: number[] = [];
  let max = 0;
  for (let i = 0; i < BAR_COUNT; i++) {
    let sum = 0;
    const start = i * block;
    const end = Math.min(start + block, data.length);
    // RMS em vez de pico absoluto: um estalo isolado não achata o resto da onda.
    for (let j = start; j < end; j++) sum += data[j] * data[j];
    const rms = Math.sqrt(sum / Math.max(1, end - start));
    peaks.push(rms);
    if (rms > max) max = rms;
  }
  if (max === 0) return peaks.map(() => 0.05);
  return peaks.map((p) => Math.max(0.08, p / max));
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface AudioPlayerProps {
  url: string;
  /** True quando o player está sobre a bolha `bg-primary` (mensagem enviada). */
  onPrimary?: boolean;
  className?: string;
}

export function AudioPlayer({ url, onPrimary, className }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barsRef = useRef<HTMLDivElement | null>(null);

  const [src, setSrc] = useState<string | null>(null);
  const [peaks, setPeaks] = useState<number[]>(() => fallbackPeaks(url));
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [failed, setFailed] = useState(false);

  // Carrega os bytes uma vez e usa para as duas coisas: o src do <audio> e a
  // decodificação da onda. Buscar duas vezes dobraria o tráfego de cada áudio.
  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;

    async function load() {
      try {
        // URLs do proxy interno precisam do fetch autenticado (mesmo padrão do
        // MediaImage); URLs públicas do Storage vão direto.
        const isProxied = url.startsWith("/api/");
        if (!isProxied) {
          setSrc(url);
        }

        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = await res.arrayBuffer();
        if (cancelled) return;

        if (isProxied) {
          const blobUrl = URL.createObjectURL(
            new Blob([bytes], {
              type: res.headers.get("content-type") ?? "audio/ogg",
            }),
          );
          revoked = blobUrl;
          setSrc(blobUrl);
        }

        // A decodificação é o único passo que pode falhar sem quebrar o
        // player: se não rolar, ficamos com a onda determinística.
        try {
          const Ctx =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext })
              .webkitAudioContext;
          if (!Ctx) return;
          const ctx = new Ctx();
          const buffer = await ctx.decodeAudioData(bytes.slice(0));
          void ctx.close();
          if (cancelled) return;
          setPeaks(peaksFromBuffer(buffer));
          // A duração do buffer decodificado é confiável; a do elemento <audio>
          // vem como Infinity para Ogg/WebM gravado em stream (sem cabeçalho
          // de duração), que é justamente o formato que o compositor grava.
          if (Number.isFinite(buffer.duration)) setDuration(buffer.duration);
        } catch {
          /* mantém a onda de fallback */
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [url]);

  // Estado de reprodução espelhado do elemento: assim o player continua certo
  // mesmo se o áudio for pausado por fora (outro player, teclado de mídia).
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setCurrent(el.currentTime);
    const onMeta = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) setDuration(el.duration);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setCurrent(0);
      el.currentTime = 0;
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
    };
  }, [src]);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setFailed(true));
    else el.pause();
  }, []);

  const seekToRatio = useCallback(
    (ratio: number) => {
      const el = audioRef.current;
      if (!el || !duration) return;
      const t = Math.min(duration, Math.max(0, ratio * duration));
      el.currentTime = t;
      setCurrent(t);
    },
    [duration],
  );

  const seekFromEvent = useCallback(
    (clientX: number) => {
      const box = barsRef.current?.getBoundingClientRect();
      if (!box || box.width === 0) return;
      seekToRatio((clientX - box.left) / box.width);
    },
    [seekToRatio],
  );

  const cycleSpeed = useCallback(() => {
    const next = (speedIndex + 1) % SPEEDS.length;
    setSpeedIndex(next);
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next];
  }, [speedIndex]);

  if (failed) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg px-3 py-2 text-xs opacity-70",
          className,
        )}
      >
        Áudio indisponível
      </div>
    );
  }

  const progress = duration > 0 ? current / duration : 0;
  const playedBars = Math.round(progress * BAR_COUNT);

  return (
    <div className={cn("flex items-center gap-2.5 py-0.5", className)}>
      {src && <audio ref={audioRef} src={src} preload="metadata" />}

      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pausar áudio" : "Reproduzir áudio"}
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full transition-colors",
          // Sobre a bolha primária não há uma cor de fundo neutra disponível,
          // então usamos a própria cor do texto rebaixada — funciona nas duas
          // superfícies sem precisar de variante de tema.
          onPrimary
            ? "bg-primary-foreground/15 hover:bg-primary-foreground/25"
            : "bg-foreground/10 hover:bg-foreground/20",
        )}
      >
        {playing ? (
          <Pause className="size-4 fill-current" />
        ) : (
          <Play className="size-4 translate-x-px fill-current" />
        )}
      </button>

      <div
        ref={barsRef}
        role="slider"
        tabIndex={0}
        aria-label="Posição do áudio"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(current)}
        aria-valuetext={`${formatTime(current)} de ${formatTime(duration)}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromEvent(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) seekFromEvent(e.clientX);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") seekToRatio(progress + 0.05);
          else if (e.key === "ArrowLeft") seekToRatio(progress - 0.05);
          else if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            toggle();
          } else return;
          e.stopPropagation();
        }}
        className="flex h-8 min-w-[7.5rem] flex-1 cursor-pointer touch-none items-center gap-[2px] outline-none focus-visible:opacity-90"
      >
        {peaks.map((p, i) => (
          <span
            key={i}
            style={{ height: `${Math.max(10, p * 100)}%` }}
            className={cn(
              "w-[3px] flex-1 rounded-full bg-current transition-opacity",
              i < playedBars ? "opacity-100" : "opacity-35",
            )}
          />
        ))}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="text-[10px] tabular-nums opacity-70">
          {/* Antes de tocar mostramos a duração total; durante, o tempo
              decorrido — é a convenção dos apps de mensagem. */}
          {formatTime(current > 0 ? current : duration)}
        </span>
        <button
          type="button"
          onClick={cycleSpeed}
          aria-label="Velocidade de reprodução"
          className={cn(
            "rounded-full px-1.5 py-px text-[10px] font-medium tabular-nums transition-colors",
            onPrimary
              ? "bg-primary-foreground/15 hover:bg-primary-foreground/25"
              : "bg-foreground/10 hover:bg-foreground/20",
          )}
        >
          {SPEEDS[speedIndex]}×
        </button>
      </div>
    </div>
  );
}
