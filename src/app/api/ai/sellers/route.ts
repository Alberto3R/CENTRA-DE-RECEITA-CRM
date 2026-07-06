// GET  /api/ai/sellers — lista os vendedores (sellers) da conta.
// POST /api/ai/sellers — cria um vendedor.

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import * as store from "@/lib/ai/store";

export async function GET() {
  try {
    const ctx = await requireRole("viewer");
    const sellers = await store.listarSellers(ctx.accountId);
    return NextResponse.json({ sellers });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const bodySchema = z.object({
  nome: z.string().min(1).max(120),
  funcao: z.enum(["gestor", "closer", "sdr", "social_seller"]).default("closer"),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    let body: z.infer<typeof bodySchema>;
    try {
      body = bodySchema.parse(await request.json());
    } catch {
      return NextResponse.json(
        { error: "Corpo inválido: informe `nome` (e opcional `funcao`)." },
        { status: 400 },
      );
    }
    const seller = await store.criarSeller({
      accountId: ctx.accountId,
      nome: body.nome,
      funcao: body.funcao,
    });
    return NextResponse.json({ seller });
  } catch (err) {
    return toErrorResponse(err);
  }
}
