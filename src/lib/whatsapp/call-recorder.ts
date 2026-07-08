/**
 * Gravador de ligação WhatsApp (WebRTC, lado do navegador).
 *
 * Mixa o áudio LOCAL (microfone do SDR) + REMOTO (o lead) num único stream
 * via Web Audio API e grava com MediaRecorder → Blob (audio/webm/opus).
 * O upload pro Storage e o vínculo com whatsapp_calls ficam no chamador.
 *
 * Best-effort: qualquer falha aqui NUNCA pode derrubar a chamada.
 */

export interface CallRecorder {
  /** Encerra a gravação e resolve com o Blob (ou null se vazio/falhou). */
  stop: () => Promise<Blob | null>;
}

export function startCallRecording(
  local: MediaStream | null,
  remote: MediaStream | null,
): CallRecorder | null {
  try {
    if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
      return null;
    }
    const AC: typeof AudioContext =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;

    const ctx = new AC();
    const dest = ctx.createMediaStreamDestination();
    let tracks = 0;
    for (const s of [local, remote]) {
      if (s && s.getAudioTracks().length) {
        try {
          ctx.createMediaStreamSource(s).connect(dest);
          tracks++;
        } catch {
          /* stream sem áudio utilizável — ignora */
        }
      }
    }
    if (tracks === 0) {
      void ctx.close().catch(() => {});
      return null;
    }

    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
    const rec = mime
      ? new MediaRecorder(dest.stream, { mimeType: mime })
      : new MediaRecorder(dest.stream);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };
    rec.start(1000); // coleta em fatias de 1s (evita perder o buffer no stop)

    return {
      stop: () =>
        new Promise<Blob | null>((resolve) => {
          const finish = () => {
            void ctx.close().catch(() => {});
            resolve(
              chunks.length
                ? new Blob(chunks, { type: mime || "audio/webm" })
                : null,
            );
          };
          if (rec.state === "inactive") {
            finish();
            return;
          }
          rec.onstop = finish;
          try {
            rec.stop();
          } catch {
            finish();
          }
        }),
    };
  } catch (e) {
    console.error("[call-recorder] falhou ao iniciar:", e);
    return null;
  }
}
