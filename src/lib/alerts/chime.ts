/**
 * Aviso sonoro de mensagem nova.
 *
 * Sintetizado no WebAudio em vez de tocar um arquivo: são dois bipes
 * curtos, não precisa de asset no bundle nem de request extra, e não
 * esbarra na política de autoplay de mídia (o AudioContext acorda no
 * primeiro clique que o usuário der no app, o que sempre acontece antes
 * de ele ficar esperando mensagem).
 */

type WindowWithLegacyAudio = Window &
  typeof globalThis & { webkitAudioContext?: typeof AudioContext };

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const w = window as WindowWithLegacyAudio;
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

function beep(audio: AudioContext, freq: number, startAt: number, dur: number) {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  // Envelope curto: ataque de 10ms e decaimento exponencial. Sem isso o
  // corte seco do oscilador estala.
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.12, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);
  osc.connect(gain).connect(audio.destination);
  osc.start(startAt);
  osc.stop(startAt + dur + 0.02);
}

/** Toca o aviso. Silencioso (sem lançar) se o navegador não deixar. */
export function playChime(): void {
  const audio = getContext();
  if (!audio) return;
  try {
    // Suspenso é o estado normal antes de qualquer gesto do usuário.
    if (audio.state === "suspended") void audio.resume();
    const t = audio.currentTime + 0.01;
    beep(audio, 880, t, 0.12);
    beep(audio, 1174.7, t + 0.13, 0.16);
  } catch {
    // Áudio é enfeite: nunca pode derrubar a tela.
  }
}
