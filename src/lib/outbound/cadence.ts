// Cadência outbound padrão (estilo SpectraX). `dia` = offset em dias desde a
// inscrição do lead; `canal` = o toque a fazer. É o fallback do sistema quando
// a conta ainda não configurou a sua própria cadência (tabela cadence_steps).
// Editável por conta no Painel Outbound → Cadência.

export interface CadenceStep {
  dia: number;
  canal: string;
}

export const DEFAULT_CADENCE: CadenceStep[] = [
  { dia: 0, canal: "Ligação" },
  { dia: 1, canal: "WhatsApp" },
  { dia: 2, canal: "Ligação" },
  { dia: 4, canal: "E-mail" },
  { dia: 6, canal: "Ligação" },
  { dia: 8, canal: "WhatsApp (última tentativa)" },
];
