// Campos de contato disponíveis como variável de modelo ({{1}}, {{2}}, …).
//
// Vive num módulo só porque a resolução acontece em TRÊS lugares — o worker
// server-side, o hook de envio client-side e o preview do assistente. Quando
// cada um tinha o seu próprio mapa, bastava alguém adicionar um campo em um
// deles para o preview mostrar uma coisa e a Meta receber outra.

export interface ContactLike {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  company?: string | null;
}

export const CONTACT_FIELD_OPTIONS = [
  { value: "first_name", label: "Primeiro nome" },
  { value: "name", label: "Nome do contato" },
  { value: "phone", label: "Número de telefone" },
  { value: "email", label: "Endereço de e-mail" },
  { value: "company", label: "Empresa" },
] as const;

/**
 * Primeiro nome, do jeito que uma pessoa escreveria numa mensagem.
 *
 * Existe porque `name` traz o nome completo do formulário e "Oi João Carlos
 * da Silva Pereira, aqui é o Alberto" entrega na primeira linha que aquilo
 * é disparo. Também normaliza o caixa: o lead digita "joão silva" no form e
 * o "Oi joão" que sairia disso tem o mesmo efeito.
 */
export function firstName(full: string | null | undefined): string {
  const token = (full ?? "").trim().split(/\s+/)[0] ?? "";
  if (!token) return "";
  // Só ajusta quando está todo minúsculo ou todo maiúsculo; nome que já veio
  // escrito certo ("McCarthy", "di Souza") fica como está.
  const uniform = token === token.toLowerCase() || token === token.toUpperCase();
  if (!uniform) return token;
  return token.charAt(0).toLocaleUpperCase("pt-BR") + token.slice(1).toLocaleLowerCase("pt-BR");
}

/** Resolve um campo embutido. Campo desconhecido ou vazio devolve "". */
export function resolveContactField(field: string, contact: ContactLike): string {
  if (field === "first_name") return firstName(contact.name);
  const map: Record<string, string | null | undefined> = {
    name: contact.name,
    phone: contact.phone,
    email: contact.email,
    company: contact.company,
  };
  return map[field] ?? "";
}
