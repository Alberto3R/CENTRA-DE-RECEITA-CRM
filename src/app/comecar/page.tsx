// /comecar — onde um login SEM conta escolhe um plano e compra. A conta é
// criada no pagamento (webhook → provision_account). Quem já tem conta é
// mandado pro /dashboard; quem não está logado, pro /login (middleware).
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentAccount } from "@/lib/auth/account";
import { createClient } from "@/lib/supabase/server";
import { PricingClient } from "./pricing-client";

export const metadata: Metadata = {
  title: "Escolha seu plano — Central de Receita",
  robots: { index: false, follow: false },
};

export default async function ComecarPage() {
  // getCurrentAccount lança se não houver conta — NÃO chame redirect() dentro
  // do try (o NEXT_REDIRECT seria engolido pelo catch).
  let hasAccount = false;
  try {
    await getCurrentAccount();
    hasAccount = true;
  } catch {
    hasAccount = false;
  }
  if (hasAccount) redirect("/dashboard");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <PricingClient email={user.email ?? ""} />;
}
