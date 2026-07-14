import {
  Bot,
  CalendarClock,
  Coins,
  CreditCard,
  FileText,
  KeyRound,
  LayoutGrid,
  Palette,
  PlugZap,
  Shield,
  Tags,
  User,
  UsersRound,
  Webhook,
  type LucideIcon,
} from 'lucide-react';

/**
 * Settings information architecture for the redesigned page.
 *
 * The flat tab strip became a grouped left rail with a new Overview
 * landing. The URL query param stays `?tab=` (deep-linkable, and it
 * keeps the existing links in sidebar.tsx / header.tsx working) — we
 * just map the old values onto the new sections.
 */
export const SETTINGS_SECTIONS = [
  'overview',
  'profile',
  'security',
  'appearance',
  'billing',
  'whatsapp',
  'templates',
  'fields',
  'deals',
  'ai-agent',
  'agenda',
  'webhooks',
  'members',
  'api',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const DEFAULT_SECTION: SettingsSection = 'overview';

/** Rail grouping. `adminOnly` items are hidden for non-admins. */
export interface SectionMeta {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  group: 'top' | 'account' | 'workspace';
  /**
   * Só admins+ (owner/admin) veem/abrem. Seções pessoais (perfil, login,
   * aparência) ficam livres pra qualquer papel. Reforçado na página (agent
   * que deep-linkar cai no Perfil) e no rail (some da lista).
   */
  adminOnly?: boolean;
}

export const SECTION_META: Record<SettingsSection, SectionMeta> = {
  overview: { id: 'overview', label: 'Visão geral', icon: LayoutGrid, group: 'top', adminOnly: true },
  profile: { id: 'profile', label: 'Seu perfil', icon: User, group: 'account' },
  security: { id: 'security', label: 'Login e segurança', icon: Shield, group: 'account' },
  appearance: { id: 'appearance', label: 'Aparência', icon: Palette, group: 'account' },
  billing: { id: 'billing', label: 'Assinatura', icon: CreditCard, group: 'account', adminOnly: true },
  whatsapp: { id: 'whatsapp', label: 'WhatsApp', icon: PlugZap, group: 'workspace', adminOnly: true },
  templates: { id: 'templates', label: 'Modelos', icon: FileText, group: 'workspace', adminOnly: true },
  fields: { id: 'fields', label: 'Campos e tags', icon: Tags, group: 'workspace', adminOnly: true },
  deals: { id: 'deals', label: 'Negócios e moeda', icon: Coins, group: 'workspace', adminOnly: true },
  'ai-agent': { id: 'ai-agent', label: 'Agente IA', icon: Bot, group: 'workspace', adminOnly: true },
  agenda: { id: 'agenda', label: 'Agenda (Google)', icon: CalendarClock, group: 'workspace', adminOnly: true },
  webhooks: { id: 'webhooks', label: 'Webhooks', icon: Webhook, group: 'workspace', adminOnly: true },
  members: { id: 'members', label: 'Membros da equipe', icon: UsersRound, group: 'workspace', adminOnly: true },
  api: { id: 'api', label: 'Chaves de API', icon: KeyRound, group: 'workspace', adminOnly: true },
};

/** True quando a seção exige admin+ (usado na página e no rail). */
export function isAdminSection(section: SettingsSection): boolean {
  return SECTION_META[section].adminOnly === true;
}

export const RAIL_GROUPS: { label: string | null; group: SectionMeta['group'] }[] = [
  { label: null, group: 'top' },
  { label: 'Conta', group: 'account' },
  { label: 'Espaço de trabalho', group: 'workspace' },
];

function isSection(value: string | null): value is SettingsSection {
  return !!value && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/**
 * Resolve a raw `?tab=` value to a section. Legacy tabs from the old
 * flat layout collapse onto their new home (Tags + Custom fields → the
 * merged "Fields & tags" section). Anything unknown falls back to the
 * Overview landing.
 */
export function resolveSection(raw: string | null): SettingsSection {
  if (raw === 'tags' || raw === 'custom-fields') return 'fields';
  if (isSection(raw)) return raw;
  return DEFAULT_SECTION;
}
