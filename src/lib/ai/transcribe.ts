/**
 * Transcrição de áudio (áudio → texto). O Claude não transcreve áudio, então
 * usamos OpenAI Whisper (`whisper-1`) como provedor padrão. Requer
 * OPENAI_API_KEY no ambiente — sem ela, a transcrição fica desativada (o
 * player de gravação continua funcionando).
 */
export async function transcribeAudio(
  audio: Blob,
  filename = "call.webm",
): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      "Transcrição indisponível: configure OPENAI_API_KEY no ambiente para habilitar.",
    );
  }
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", "whisper-1");
  form.append("language", "pt");
  form.append("response_format", "text");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Falha na transcrição (${res.status}): ${t.slice(0, 200)}`);
  }
  // response_format=text → corpo é a transcrição pura.
  return (await res.text()).trim();
}
