import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { decrypt } from "@/lib/whatsapp/encryption";
import { getMediaUrl, downloadMedia } from "@/lib/whatsapp/meta-api";
import { transcribeAudio } from "@/lib/ai/transcribe";
import { resolveChannelConfig } from "@/lib/whatsapp/channel";

/**
 * Monta o texto de uma conversa de WhatsApp para análise no Gestor.
 *
 * Diferente de simplesmente ler `content_text` no cliente (que ignora
 * áudios, cujo `content_text` é null), aqui **transcrevemos as mensagens
 * de voz** via ElevenLabs Scribe e cacheamos em `messages.transcript`,
 * para não re-transcrever a cada análise. Demais mídias entram como um
 * marcador curto ([imagem], [documento]…) para não perder o contexto.
 */

const bodySchema = z.object({
  conversationId: z.string().uuid(),
});

interface MsgRow {
  id: string;
  sender_type: string | null;
  content_type: string | null;
  content_text: string | null;
  media_url: string | null;
  transcript: string | null;
}

const MEDIA_LABEL: Record<string, string> = {
  image: "[imagem]",
  document: "[documento]",
  video: "[vídeo]",
  location: "[localização]",
};

function papel(senderType: string | null): string {
  return senderType === "customer" ? "Cliente" : "Vendedor";
}

// media_url é o proxy interno `/api/whatsapp/media/<mediaId>`.
function mediaIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  const id = url.split("/").filter(Boolean).pop();
  return id || null;
}

export async function POST(req: Request) {
  try {
    const ctx = await requireRole("agent");
    const { conversationId } = bodySchema.parse(await req.json());

    const admin = supabaseAdmin();

    // Conversa precisa ser da conta do usuário (escopo de segurança).
    const { data: conv } = await admin
      .from("conversations")
      .select("id, account_id")
      .eq("id", conversationId)
      .maybeSingle();
    if (!conv || conv.account_id !== ctx.accountId) {
      return NextResponse.json(
        { error: "Conversa não encontrada." },
        { status: 404 },
      );
    }

    const { data: msgs } = await admin
      .from("messages")
      .select("id, sender_type, content_type, content_text, media_url, transcript")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    const rows = (msgs as MsgRow[] | null) ?? [];
    const audios = rows.filter(
      (m) => m.content_type === "audio" && !m.transcript,
    );

    // Só busca config/token se houver áudio novo para transcrever.
    let accessToken: string | null = null;
    if (audios.length > 0) {
      const config = await resolveChannelConfig(admin, ctx.accountId);
      if (config?.access_token) {
        try {
          accessToken = decrypt(config.access_token);
        } catch {
          accessToken = null;
        }
      }
    }

    // Transcreve os áudios ainda sem transcrição (sequencial: poucos por
    // conversa) e cacheia. Falhas não derrubam a análise — viram marcador.
    for (const m of audios) {
      const mediaId = mediaIdFromUrl(m.media_url);
      if (!accessToken || !mediaId) continue;
      try {
        const info = await getMediaUrl({ mediaId, accessToken });
        const { buffer, contentType } = await downloadMedia({
          downloadUrl: info.url,
          accessToken,
        });
        const blob = new Blob([new Uint8Array(buffer)], {
          type: contentType || info.mimeType || "audio/ogg",
        });
        const texto = await transcribeAudio(blob, "voz.ogg");
        if (texto && texto.trim()) {
          m.transcript = texto.trim();
          await admin
            .from("messages")
            .update({ transcript: m.transcript })
            .eq("id", m.id);
        }
      } catch (e) {
        console.error("[conversa-transcricao] falha ao transcrever áudio", m.id, e);
      }
    }

    const linhas: string[] = [];
    for (const m of rows) {
      const nome = papel(m.sender_type);
      if (m.content_type === "audio") {
        if (m.transcript && m.transcript.trim()) {
          linhas.push(`${nome} (áudio): ${m.transcript.trim()}`);
        } else {
          linhas.push(`${nome}: [áudio não transcrito]`);
        }
        continue;
      }
      if (m.content_text && m.content_text.trim()) {
        linhas.push(`${nome}: ${m.content_text.trim()}`);
        continue;
      }
      const label = m.content_type ? MEDIA_LABEL[m.content_type] : undefined;
      if (label) linhas.push(`${nome}: ${label}`);
    }

    return NextResponse.json({
      texto: linhas.join("\n"),
      total: linhas.length,
      audios: audios.length,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
