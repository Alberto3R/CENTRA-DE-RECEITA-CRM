// POST /api/ai/whatsapp — analisa uma CONVERSA REAL do CRM (não exige colar nada).
//
// Este é o ganho central da fusão: o head comercIAl analisava texto digitado;
// aqui a IA lê as `messages` de uma `conversation` que o WhatsApp já capturou.
// Reusa a engine de análise (dimensões do método da conta) sobre a conversa
// serializada em "[hh:mm] Falante: fala".

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { assertCreditos, consumirCreditos } from "@/lib/billing/quota";
import { carregarSalesConfig } from "@/lib/ai/config";
import {
  analisarCall,
  objetivoDeFuncao,
  type ObjetivoAnalise,
} from "@/lib/ai/analise-call";
import { calcularCustoUsd } from "@/lib/ai/custo";
import * as store from "@/lib/ai/store";

const bodySchema = z.object({
  conversationId: z.string().uuid(),
  sellerId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    await assertCreditos(ctx.accountId, "whatsapp");

    let body: z.infer<typeof bodySchema>;
    try {
      body = bodySchema.parse(await request.json());
    } catch {
      return NextResponse.json(
        { error: "Corpo inválido: informe `conversationId`." },
        { status: 400 },
      );
    }

    // Régua de análise: se veio sellerId, usa a função dele; senão, deriva de
    // quem atende a conversa (assigned_agent_id/dono). sdr = qualificar+agendar.
    let objetivo: ObjetivoAnalise = "closer";
    // Além da régua, resolvemos QUEM atendeu: sem `seller_id` a análise fica
    // órfã e o relatório em PDF sai sem o nome de quem vai recebê-lo.
    let sellerId: string | null = body.sellerId ?? null;
    if (body.sellerId) {
      const seller = await store.buscarSeller(ctx.accountId, body.sellerId);
      if (!seller) {
        return NextResponse.json(
          { error: "Vendedor selecionado não pertence a esta conta." },
          { status: 400 },
        );
      }
      objetivo = objetivoDeFuncao(seller.funcao);
    } else {
      const dono = await store.donoDaConversa(
        ctx.accountId,
        body.conversationId,
      );
      objetivo = objetivoDeFuncao(
        await store.funcaoDoUsuario(ctx.accountId, dono),
      );
      sellerId = await store.sellerDoUsuario(ctx.accountId, dono);
    }

    // Lê a conversa do CRM (escopada pela conta) e serializa.
    const { texto, totalMensagens } = await store.carregarConversaComoTexto(
      ctx.accountId,
      body.conversationId,
    );
    if (totalMensagens < 2) {
      return NextResponse.json(
        { error: "Conversa curta demais para analisar (mín. 2 mensagens de texto)." },
        { status: 422 },
      );
    }

    const config = await carregarSalesConfig(ctx.supabase, ctx.accountId);

    const documentId = await store.inserirDocumento({
      accountId: ctx.accountId,
      tipo: "whatsapp_txt",
      origem: "conversa do CRM",
      status: "validado",
      conversationId: body.conversationId,
    });

    try {
      const resultado = await analisarCall(texto, config, objetivo);

      const salva = await store.inserirAnalise({
        accountId: ctx.accountId,
        documentId,
        sellerId,
        conversationId: body.conversationId,
        tipo: "whatsapp",
        analise: resultado.analise,
        promptVersao: resultado.promptVersao,
        metodo: config.metodoNome,
        customizado: config.customizado,
      });
      await store.registrarUso({
        accountId: ctx.accountId,
        capacidade: "analise_whatsapp.analise",
        uso: resultado.uso,
        custoUsd: calcularCustoUsd(
          resultado.uso.modelo,
          resultado.uso.tokens_in,
          resultado.uso.tokens_out,
        ),
      });
      await store.atualizarStatusDocumento(ctx.accountId, documentId, "processado");
      await consumirCreditos(ctx.accountId, "whatsapp");

      return NextResponse.json({
        id: salva.id,
        criadoEm: salva.created_at,
        analise: resultado.analise,
      });
    } catch (e) {
      await store
        .atualizarStatusDocumento(ctx.accountId, documentId, "rejeitado")
        .catch(() => {});
      throw e;
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
