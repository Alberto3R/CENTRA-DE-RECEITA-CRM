/**
 * Transcrição de áudio (áudio → texto) via **ElevenLabs Scribe** (STT).
 * Usamos a assinatura ElevenLabs que a operação já tem. Requer
 * ELEVENLABS_API_KEY no ambiente — sem ela, a transcrição fica desativada
 * (o player de gravação continua funcionando).
 *
 * Com diarização (diarize=true), montamos a transcrição em turnos
 * ("Falante 1: …" / "Falante 2: …"), o que melhora a análise do Gestor.
 */
interface ScribeWord {
  text: string;
  type?: string; // 'word' | 'spacing' | 'audio_event'
  speaker_id?: string;
}
interface ScribeResponse {
  text?: string;
  language_code?: string;
  words?: ScribeWord[];
}

export async function transcribeAudio(
  audio: Blob,
  filename = "call.webm",
): Promise<string> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    throw new Error(
      "Transcrição indisponível: configure ELEVENLABS_API_KEY no ambiente para habilitar.",
    );
  }
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model_id", "scribe_v1");
  form.append("language_code", "por");
  form.append("diarize", "true");

  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": key },
    body: form,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Falha na transcrição (${res.status}): ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as ScribeResponse;
  return diarizado(data) || (data.text ?? "").trim();
}

/**
 * Monta "Falante N: fala" a partir dos words diarizados. Retorna "" quando
 * não há diarização útil (< 2 falantes) — aí o chamador usa o texto corrido.
 */
function diarizado(data: ScribeResponse): string {
  const words = data.words;
  if (!Array.isArray(words) || words.length === 0) return "";
  const speakers = [
    ...new Set(words.map((w) => w.speaker_id).filter(Boolean)),
  ] as string[];
  if (speakers.length < 2) return "";
  const label = new Map(speakers.map((s, i) => [s, `Falante ${i + 1}`]));

  const lines: string[] = [];
  let cur: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    const txt = buf.join("").trim();
    if (cur !== null && txt) lines.push(`${label.get(cur)}: ${txt}`);
    buf = [];
  };
  for (const w of words) {
    if (w.type === "spacing") {
      buf.push(w.text);
      continue;
    }
    const sp = w.speaker_id ?? cur;
    if (sp !== cur) {
      flush();
      cur = sp;
    }
    buf.push(w.text);
  }
  flush();
  return lines.join("\n");
}
