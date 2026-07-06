// Política de Privacidade — RASCUNHO. Revisar com jurídico antes de publicar.
// Rota pública (não está na lista protegida do middleware). Preencher os
// campos [ENTRE COLCHETES] com os dados da entidade legal antes de ir ao ar.

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Privacidade",
};

const ATUALIZADO_EM = "[DATA]";

export default function PoliticaPrivacidade() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-foreground">
      <div className="mb-8 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
        ⚠️ <strong>Rascunho.</strong> Este documento é um ponto de partida e
        precisa de revisão jurídica (LGPD) e do preenchimento dos dados da
        empresa antes de ser publicado.
      </div>

      <h1 className="text-2xl font-semibold tracking-tight">
        Política de Privacidade — Central de Receita
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Última atualização: {ATUALIZADO_EM}
      </p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed text-foreground/90">
        <section>
          <h2 className="text-lg font-semibold">1. Quem somos</h2>
          <p>
            A Central de Receita é uma plataforma de CRM e Gestão Comercial
            operada por <strong>[RAZÃO SOCIAL]</strong>, inscrita no CNPJ{" "}
            <strong>[CNPJ]</strong>, com sede em <strong>[ENDEREÇO]</strong>{" "}
            (&quot;Central de Receita&quot;, &quot;nós&quot;). Esta Política
            explica como tratamos dados pessoais, em conformidade com a Lei nº
            13.709/2018 (LGPD).
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">
            2. Papéis: controlador e operador
          </h2>
          <p>
            Em relação aos dados dos <strong>seus contatos e clientes</strong>{" "}
            que você insere ou recebe na Central de Receita (nome, telefone,
            mensagens de WhatsApp, negócios), <strong>você (a empresa
            contratante) é a Controladora</strong> e a Central de Receita atua
            como <strong>Operadora</strong>, tratando esses dados conforme suas
            instruções e o Contrato/DPA.
          </p>
          <p className="mt-2">
            Em relação aos dados da sua própria conta de usuário (nome, e-mail,
            dados de cobrança), a Central de Receita é a Controladora.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">3. Dados que tratamos</h2>
          <ul className="ml-5 list-disc space-y-1">
            <li>
              <strong>Conta e acesso:</strong> nome, e-mail, senha (com hash),
              papel na equipe.
            </li>
            <li>
              <strong>Dados comerciais que você gerencia:</strong> contatos,
              telefones, e-mails, empresas, conversas de WhatsApp, negócios e
              anotações.
            </li>
            <li>
              <strong>Integração WhatsApp Business (Meta):</strong> mensagens,
              números e metadados necessários ao atendimento.
            </li>
            <li>
              <strong>Cobrança:</strong> processada pela Stripe; não
              armazenamos o número completo do cartão.
            </li>
            <li>
              <strong>Uso e logs:</strong> registros técnicos para segurança e
              funcionamento do serviço.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold">4. Suboperadores</h2>
          <p>
            Usamos provedores que tratam dados em nosso nome, sob contrato:
            Supabase (banco de dados/autenticação), Vercel (hospedagem), Stripe
            (pagamentos), Meta/WhatsApp (mensageria) e Anthropic (recursos de
            IA do Gestor Comercial). O uso de IA se restringe a processar o
            conteúdo necessário para gerar a análise solicitada.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">5. Seus direitos (LGPD)</h2>
          <p>
            Você pode solicitar confirmação de tratamento, acesso, correção,
            anonimização, portabilidade e eliminação dos seus dados, além de
            revogar consentimento, escrevendo para{" "}
            <strong>[E-MAIL DE CONTATO/DPO]</strong>. Para dados de contatos que
            você gerencia como Controladora, atendemos às suas instruções.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">6. Retenção e eliminação</h2>
          <p>
            Mantemos os dados enquanto a conta estiver ativa. Após o
            encerramento, os dados são eliminados ou anonimizados em{" "}
            <strong>[PRAZO]</strong> dias, salvo obrigação legal de retenção.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">7. Segurança</h2>
          <p>
            Adotamos medidas técnicas como isolamento por conta (RLS),
            criptografia de tokens sensíveis e controle de acesso por papéis.
            Nenhum sistema é 100% imune; comunicaremos incidentes relevantes
            conforme a LGPD.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">8. Encarregado (DPO)</h2>
          <p>
            Encarregado pelo tratamento de dados: <strong>[NOME DO DPO]</strong>
            , contato <strong>[E-MAIL DO DPO]</strong>.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">9. Alterações</h2>
          <p>
            Podemos atualizar esta Política. Mudanças relevantes serão
            comunicadas pelos canais da conta.
          </p>
        </section>
      </div>
    </main>
  );
}
