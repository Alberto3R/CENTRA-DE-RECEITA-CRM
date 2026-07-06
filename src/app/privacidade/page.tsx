// Política de Privacidade — RASCUNHO. Revisar com jurídico antes de publicar.
// Rota pública (não está na lista protegida do middleware). Preencher os
// campos [ENTRE COLCHETES] com os dados da entidade legal antes de ir ao ar.

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Privacidade",
};

const ATUALIZADO_EM = "6 de julho de 2026";

export default function PoliticaPrivacidade() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-foreground">
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
            operada por{" "}
            <strong>
              Jano Marketing Direto e Treinamento em Desenvolvimento
              Profissional e Gerencial Ltda
            </strong>{" "}
            (nome fantasia Sales 3R Performance Comercial), inscrita no CNPJ{" "}
            <strong>43.317.252/0001-51</strong>, com sede na Av. Pres. Juscelino
            Kubitschek, 1327, Andar 4, Conj. 41, Vila Nova Conceição, São
            Paulo/SP, CEP 04.543-011 (&quot;Central de Receita&quot;,
            &quot;nós&quot;). Esta Política explica como tratamos dados pessoais,
            em conformidade com a Lei nº 13.709/2018 (LGPD).
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
            <strong>contato@sales3r.com.br</strong>. Para dados de contatos que
            você gerencia como Controladora, atendemos às suas instruções.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold">6. Retenção e eliminação</h2>
          <p>
            Mantemos os dados enquanto a conta estiver ativa. Após o
            encerramento, os dados são eliminados ou anonimizados em{" "}
            <strong>90</strong> dias, salvo obrigação legal de retenção.
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
            Encarregado pelo tratamento de dados:{" "}
            <strong>Alberto Oliveira</strong>, contato{" "}
            <strong>contato@sales3r.com.br</strong>.
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
