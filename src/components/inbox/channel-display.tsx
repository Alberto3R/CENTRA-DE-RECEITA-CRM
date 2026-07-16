/**
 * Exibição de canal no inbox (Instagram vs WhatsApp).
 *
 * Contato de Instagram não tem telefone — a identidade é o `instagram_id`
 * e o rótulo humano é `@username`. Estes helpers centralizam a decisão de
 * nome/subtítulo/ícone para a lista e o cabeçalho da conversa, para os dois
 * lugares concordarem.
 */

import type { Contact } from "@/types";

type ContactLike = Partial<
  Pick<Contact, "name" | "phone" | "instagram_id" | "instagram_username">
> | null | undefined;

/** É um contato de Instagram? (tem IGSID) */
export function isInstagramContact(contact: ContactLike): boolean {
  return !!contact?.instagram_id;
}

/** @username com arroba, ou null se não houver. */
export function instagramHandle(contact: ContactLike): string | null {
  if (!contact?.instagram_username) return null;
  const u = contact.instagram_username;
  return u.startsWith("@") ? u : `@${u}`;
}

/**
 * Nome exibido: nome do contato > @username (IG) > telefone > fallback.
 */
export function contactDisplayName(contact: ContactLike): string {
  if (!contact) return "Desconhecido";
  if (contact.name) return contact.name;
  if (isInstagramContact(contact)) {
    return instagramHandle(contact) ?? "Instagram";
  }
  return contact.phone || instagramHandle(contact) || "Desconhecido";
}

/**
 * Subtítulo do cabeçalho: @username no Instagram, telefone no WhatsApp.
 */
export function contactSubtitle(contact: ContactLike): string {
  if (!contact) return "";
  if (isInstagramContact(contact)) return instagramHandle(contact) ?? "Instagram";
  return contact.phone || "";
}

/** Inicial para o avatar (ignora o "@" do handle). */
export function contactInitial(contact: ContactLike): string {
  const name = contactDisplayName(contact).replace(/^@/, "");
  return (name.charAt(0) || "?").toUpperCase();
}

/**
 * Glifo do Instagram (SVG inline). Esta versão do lucide-react não exporta
 * o ícone `Instagram`, então desenhamos a câmera aqui — sem dependência.
 */
export function InstagramGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-label="Instagram"
      role="img"
    >
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}
