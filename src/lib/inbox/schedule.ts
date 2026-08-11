/**
 * Renderização do corpo de template para o agendamento.
 *
 * Isolado do componente porque é o texto que o lead vai ler dias depois:
 * o `preview` gravado é o que aparece no balão do inbox e na lista de
 * conversas, então um erro aqui só apareceria quando não desse mais
 * para corrigir. Pura, testável.
 */

/**
 * Substitui {{1}}, {{2}}… pelos valores posicionais.
 *
 * Placeholder sem valor é MANTIDO literalmente ({{2}}), e não trocado
 * por vazio: o buraco fica visível na pré-visualização em vez de virar
 * uma frase truncada que parece correta.
 */
export function renderTemplateBody(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_match, raw: string) => {
    const value = params[Number(raw) - 1];
    return value && value.trim().length > 0 ? value : `{{${raw}}}`;
  });
}

/** Rótulo curto de quando a mensagem sai, para o painel de pendentes. */
export function formatScheduleLabel(iso: string, now = new Date()): string {
  const target = new Date(iso);
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return "enviando…";

  const minutes = Math.round(diffMs / 60000);
  if (minutes < 60) return `em ${minutes} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `em ${hours}h`;

  const days = Math.round(hours / 24);
  return days === 1 ? "amanhã" : `em ${days} dias`;
}
