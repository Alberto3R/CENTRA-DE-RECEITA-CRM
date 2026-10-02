"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";

const MIN_PASSWORD = 8;

// Destino do link de recuperação (forgot-password → /auth/callback →
// /reset-password). O callback já trocou o `code` por uma sessão de
// recuperação; aqui o usuário só escolhe a senha nova. Sem esta página o
// link terminava num 404 e não havia como recuperar o acesso.
export default function ResetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();

  const [temSessao, setTemSessao] = useState<boolean | null>(null);
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Link antigo (fluxo implícito, token no #hash) também cai aqui: o
    // client detecta e dispara PASSWORD_RECOVERY.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) setTemSessao(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      setTemSessao((atual) => atual || !!data.session);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (senha.length < MIN_PASSWORD) {
      setError(`A senha deve ter pelo menos ${MIN_PASSWORD} caracteres.`);
      return;
    }
    if (senha !== confirma) {
      setError("A senha e a confirmação não coincidem.");
      return;
    }
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.updateUser({ password: senha });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    router.replace("/dashboard");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          <CardTitle className="text-xl text-foreground">Criar nova senha</CardTitle>
          <CardDescription className="text-muted-foreground">
            {temSessao === false
              ? "Este link expirou ou já foi usado."
              : "Escolha a senha nova da sua conta"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {temSessao === false ? (
            <Link href="/forgot-password">
              <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
                Pedir um link novo
              </Button>
            </Link>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {error && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                  {error}
                </div>
              )}

              <div className="flex flex-col gap-2">
                <Label htmlFor="senha" className="text-muted-foreground">
                  Nova senha
                </Label>
                <Input
                  id="senha"
                  type="password"
                  autoComplete="new-password"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  required
                  className="border-border bg-muted text-foreground focus-visible:border-primary focus-visible:ring-primary/20"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="confirma" className="text-muted-foreground">
                  Confirme a nova senha
                </Label>
                <Input
                  id="confirma"
                  type="password"
                  autoComplete="new-password"
                  value={confirma}
                  onChange={(e) => setConfirma(e.target.value)}
                  required
                  className="border-border bg-muted text-foreground focus-visible:border-primary focus-visible:ring-primary/20"
                />
              </div>

              <Button
                type="submit"
                disabled={loading || temSessao === null}
                className="mt-2 h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {loading ? "Salvando..." : "Salvar senha e entrar"}
              </Button>
            </form>
          )}

          <Link
            href="/login"
            className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para entrar
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
