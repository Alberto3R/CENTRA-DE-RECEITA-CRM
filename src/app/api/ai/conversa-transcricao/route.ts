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

// media_url legado = proxy interno `/api/whatsapp/media/<mediaId>` (Meta).
// media_url atual = URL absoluta do Supabase Storage (o webhook baixa e salva
// a mídia lá). Distinguimos pelos dois formatos ao baixar os bytes do áudio.
function mediaIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  const id = url.split("/").filter(Boolean).pop();
  return id || null;
}

function isAbsoluteUrl(url: string | null): boolean {
  return !!url && /^https?:\/\//i.test(url);
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

    // O token da Meta só é necessário para os áudios LEGADOS (proxy
    // /api/whatsapp/media/<id>). Os atuais ficam no Supabase Storage (URL
    // absoluta) e são baixados direto, sem token.
    const precisaMeta = audios.some((m) => !isAbsoluteUrl(m.media_url));
    let accessToken: string | null = null;
    if (precisaMeta) {
      const config = await resolveChannelConfig(admin, ctx.accountId);
      if (config?.access_token) {
        try {
          accessToken = decrypt(config.access_token);
        } catch {
          accessToken = null;
        }
      }
    }

    // Baixa os bytes do áudio, escolhendo a fonte pela forma da media_url:
    //  - URL absoluta  → Supabase Storage (fetch direto, sem token);
    //  - caminho proxy → Meta Graph API (getMediaUrl + downloadMedia).
    async function baixarAudio(
      m: MsgRow,
    ): Promise<{ buffer: ArrayBuffer | Buffer; type: string } | null> {
      if (isAbsoluteUrl(m.media_url)) {
        const res = await fetch(m.media_url as string);
        if (!res.ok) {
          throw new Error(`storage fetch ${res.status}`);
        }
        return {
          buffer: await res.arrayBuffer(),
          type: res.headers.get("content-type") || "audio/ogg",
        };
      }
      const mediaId = mediaIdFromUrl(m.media_url);
      if (!accessToken || !mediaId) return null;
      const info = await getMediaUrl({ mediaId, accessToken });
      const { buffer, contentType } = await downloadMedia({
        downloadUrl: info.url,
        accessToken,
      });
      return { buffer, type: contentType || info.mimeType || "audio/ogg" };
    }

    // Transcreve os áudios ainda sem transcrição (sequencial: poucos por
    // conversa) e cacheia. Falhas não derrubam a análise — viram marcador.
    let transcritos = 0;
    for (const m of audios) {
      try {
        const audio = await baixarAudio(m);
        if (!audio) continue;
        const blob = new Blob([new Uint8Array(audio.buffer as ArrayBuffer)], {
          type: audio.type,
        });
        const texto = await transcribeAudio(blob, "voz.ogg");
        if (texto && texto.trim()) {
          m.transcript = texto.trim();
          await admin
            .from("messages")
            .update({ transcript: m.transcript })
            .eq("id", m.id);
          transcritos += 1;
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
      audios: audios.length, // áudios que precisavam de transcrição
      transcritos, // quantos REALMENTE foram transcritos agora
      falhas: audios.length - transcritos, // não transcritos (viram marcador)
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
