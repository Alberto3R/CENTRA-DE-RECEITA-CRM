// POST /api/ai/analise-call — analisa uma transcrição de call (7 dimensões).
// GET  /api/ai/analise-call — lista as análises recentes da conta.
//
// Padrão de rota de IA premium: requireRole('agent') → assertQuota → validar
// insumo (Haiku) → analisar (Sonnet, método da conta) → persistir → registrar
// uso/custo → consumir quota. Erros tipados via toErrorResponse.

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { assertCreditos, consumirCreditos } from "@/lib/billing/quota";
import { carregarSalesConfig } from "@/lib/ai/config";
import { validarInsumo } from "@/lib/ai/validar-insumo";
import { normalizarTranscricao } from "@/lib/ai/transcricao-extractor";
import {
  analisarCall,
  objetivoDeFuncao,
  type ObjetivoAnalise,
} from "@/lib/ai/analise-call";
import { calcularCustoUsd } from "@/lib/ai/custo";
import * as store from "@/lib/ai/store";

const bodySchema = z.object({
  texto: z.string().min(1).max(200_000, "Transcrição muito longa (máx. ~200 mil caracteres)."),
  sellerId: z.string().uuid().optional(),
  // Deriva a régua do dono da ligação (whatsapp_calls.user_id) quando não há
  // sellerId — usado pela análise das gravações em Ligações.
  callId: z.string().uuid().optional(),
  // Deriva a régua da função (profiles.funcao) do atendente selecionado —
  // usado pela tela "Analisar conversa" (seletor de membro do CRM).
  ownerUserId: z.string().uuid().optional(),
  formato: z.enum(["vtt", "txt"]).optional(),
  origem: z.string().max(200).optional(),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    await assertCreditos(ctx.accountId, "analise-call");

    let body: z.infer<typeof bodySchema>;
    try {
      body = bodySchema.parse(await request.json());
    } catch {
      return NextResponse.json(
        { error: "Corpo inválido: informe `texto` (a transcrição)." },
        { status: 400 },
      );
    }

    // O sellerId vem do cliente e não é confiável — garante que é desta conta
    // e deriva a RÉGUA de análise da função do vendedor (sdr → qualificar+agendar;
    // demais → closer/fechamento).
    let objetivo: ObjetivoAnalise = "closer";
    if (body.sellerId) {
      const seller = await store.buscarSeller(ctx.accountId, body.sellerId);
      if (!seller) {
        return NextResponse.json(
          { error: "Vendedor selecionado não pertence a esta conta." },
          { status: 400 },
        );
      }
      objetivo = objetivoDeFuncao(seller.funcao);
    } else if (body.callId) {
      // Régua pela função de quem fez a ligação.
      objetivo = objetivoDeFuncao(
        await store.funcaoDoDonoDaCall(ctx.accountId, body.callId),
      );
    } else if (body.ownerUserId) {
      // Régua pela função comercial do atendente selecionado (membro do CRM).
      // funcaoDoUsuario escopa por conta — usuário de fora vira null (closer).
      objetivo = objetivoDeFuncao(
        await store.funcaoDoUsuario(ctx.accountId, body.ownerUserId),
      );
    }

    const config = await carregarSalesConfig(ctx.supabase, ctx.accountId);

    const documentId = await store.inserirDocumento({
      accountId: ctx.accountId,
      tipo: "call_transcript",
      origem: body.origem ?? "colado no app",
      status: "recebido",
    });

    // Triagem barata (Haiku) — rejeita lixo antes do Sonnet.
    const validacao = await validarInsumo(body.texto);
    await store.registrarUso({
      accountId: ctx.accountId,
      capacidade: "analise_call.validacao",
      uso: validacao.uso,
      custoUsd: calcularCustoUsd(
        validacao.uso.modelo,
        validacao.uso.tokens_in,
        validacao.uso.tokens_out,
      ),
    });
    if (!validacao.valido) {
      await store.atualizarStatusDocumento(ctx.accountId, documentId, "rejeitado");
      return NextResponse.json(
        {
          error: `Insumo não parece uma transcrição de call analisável (${validacao.tipo_detectado}). ${validacao.motivo}`,
        },
        { status: 422 },
      );
    }
    await store.atualizarStatusDocumento(ctx.accountId, documentId, "validado");

    try {
      const { textoNormalizado } = normalizarTranscricao(body.texto, body.formato);
      const resultado = await analisarCall(textoNormalizado, config, objetivo);

      const salva = await store.inserirAnalise({
        accountId: ctx.accountId,
        documentId,
        sellerId: body.sellerId ?? null,
        tipo: "call",
        analise: resultado.analise,
        promptVersao: resultado.promptVersao,
        metodo: config.metodoNome,
        customizado: config.customizado,
      });
      await store.registrarUso({
        accountId: ctx.accountId,
        capacidade: "analise_call.analise",
        uso: resultado.uso,
        custoUsd: calcularCustoUsd(
          resultado.uso.modelo,
          resultado.uso.tokens_in,
          resultado.uso.tokens_out,
        ),
      });
      await store.atualizarStatusDocumento(ctx.accountId, documentId, "processado");
      await consumirCreditos(ctx.accountId, "analise-call");

      return NextResponse.json({
        id: salva.id,
        criadoEm: salva.created_at,
        analise: resultado.analise,
      });
    } catch (e) {
      // Análise falhou (timeout/refusal/schema): não deixa o documento preso em
      // 'validado'.
      await store
        .atualizarStatusDocumento(ctx.accountId, documentId, "rejeitado")
        .catch(() => {});
      throw e;
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function GET() {
  try {
    const ctx = await requireRole("viewer");
    const analises = await store.listarAnalises(ctx.accountId);
    return NextResponse.json({ analises });
  } catch (err) {
    return toErrorResponse(err);
  }
}
