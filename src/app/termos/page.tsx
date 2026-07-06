// Termos de Uso — RASCUNHO. Revisar com jurídico antes de publicar.
// Rota pública (não está na lista protegida do middleware). Preencher os
// campos [ENTRE COLCHETES] antes de ir ao ar.

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Termos de Uso",
};

const ATUALIZADO_EM = "6 de julho de 2026";

export default function TermosDeUso() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-foreground">
      <h1 className="text-2xl font-semibold tracking-tight">
        Termos de Uso — Central de Receita
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Última atualização: {ATUALIZADO_EM}
      </p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-foreground/90">
        <section>
          <h2 className="text-lg font-semibold">1. Aceite</h2>
          <p>
            Ao criar uma conta ou usar a Central de Receita, plataforma de CRM e
            Gestão Comercial operada por{" "}
            <strong>
              Jano Marketing Direto e Treinamento em Desenvolvimento
              Profissional e Gerencial Ltda
            </strong>{" "}
            (nome fantasia Sales 3R Performance Comercial, CNPJ{" "}
            <strong>43.317.252/0001-51</strong>), você concorda com estes Termos.
            Se não concordar, não utilize o serviço.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">2. O serviço</h2>
          <p>
            A Central de Receita oferece CRM para WhatsApp, funis de vendas,
            disparos, automações e recursos de Gestão Comercial com IA. Podemos
            evoluir, alterar ou descontinuar funcionalidades, avisando quando a
            mudança for relevante.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">3. Conta e responsabilidade</h2>
          <ul className="ml-5 list-disc space-y-1">
            <li>Você é responsável pela veracidade dos dados e pelo sigilo das credenciais.</li>
            <li>Você responde pelos atos dos usuários que convidar para sua conta.</li>
            <li>É proibido uso ilícito, spam, ou violação das políticas da Meta/WhatsApp.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold">4. Uso do WhatsApp</h2>
          <p>
            O envio de mensagens está sujeito às políticas da Meta/WhatsApp
            Business. Você é responsável por obter o consentimento (opt-in) dos
            destinatários. Bloqueios, limites de qualidade e banimentos
            aplicados pela Meta fogem ao nosso controle.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">5. Planos e pagamento</h2>
          <p>
            Os planos, preços e créditos vigentes são os exibidos no aplicativo.
            A cobrança é recorrente (mensal ou anual) via Stripe. Em caso de
            inadimplência, o acesso a recursos pagos pode ser suspenso. Cancele
            a qualquer momento pelo portal de assinatura; o acesso permanece até
            o fim do período já pago, sem reembolso proporcional, salvo
            disposição legal.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">6. Propriedade dos dados</h2>
          <p>
            Os dados que você insere são seus. Concede-se à Central de Receita
            licença limitada para tratá-los apenas para prestar o serviço,
            conforme a{" "}
            <a className="underline" href="/privacidade">Política de Privacidade</a>
            . Você pode exportar ou solicitar a eliminação dos dados ao encerrar
            a conta.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">7. Recursos de IA</h2>
          <p>
            As análises geradas por IA são apoio à decisão e podem conter erros;
            não substituem julgamento humano. Você é responsável pelo uso das
            recomendações.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">8. Limitação de responsabilidade</h2>
          <p>
            O serviço é fornecido &quot;no estado em que se encontra&quot;. Na
            máxima extensão permitida em lei, nossa responsabilidade fica
            limitada ao valor pago nos <strong>12</strong> meses anteriores ao
            evento.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">9. Vigência e encerramento</h2>
          <p>
            Você pode encerrar a conta a qualquer momento. Podemos suspender ou
            encerrar contas que violem estes Termos ou a lei.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">10. Foro e contato</h2>
          <p>
            Estes Termos são regidos pelas leis brasileiras, foro da comarca de{" "}
            <strong>São Paulo/SP</strong>. Contato:{" "}
            <strong>contato@sales3r.com.br</strong>.
          </p>
        </section>
      </div>
    </main>
  );
}
