// /suspenso — tela do acesso cortado.
//
// Para onde o layout do dashboard manda a conta cujo prazo venceu
// (migrações 094/095). O corte de verdade é o RLS; esta página existe
// para o cliente saber POR QUE parou e ter o caminho de volta num
// clique, em vez de encontrar um CRM de listas vazias.
//
// Conta em dia cai aqui por engano (link salvo, refresh) → volta pro
// dashboard.
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentAccount } from "@/lib/auth/account";
import { SuspensoClient } from "./suspenso-client";

export const metadata: Metadata = {
  title: "Acesso suspenso — Central de Receita",
  robots: { index: false, follow: false },
};

export default async function SuspensoPage() {
  // getCurrentAccount lança quando não há conta — não chame redirect()
  // dentro do try, o NEXT_REDIRECT seria engolido pelo catch.
  let ctx: Awaited<ReturnType<typeof getCurrentAccount>> | null = null;
  try {
    ctx = await getCurrentAccount();
  } catch {
    ctx = null;
  }
  if (!ctx) redirect("/comecar");
  if (!ctx.suspension.suspended) redirect("/dashboard");

  return (
    <SuspensoClient
      accountName={ctx.account.name}
      suspendedAt={ctx.suspension.suspendsAt}
      reason={ctx.suspension.reason}
      isOwner={ctx.role === "owner"}
    />
  );
}
