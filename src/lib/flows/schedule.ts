// Quando um nó de espera volta a acordar.
//
// Lógica pura, separada do motor, porque é a parte que erra em silêncio: um
// "+1 dia" disparado às 22h vira mensagem às 22h do dia seguinte, e ninguém
// descobre isso lendo o código do engine — descobre pelo lead respondendo
// "que horas são essas".

/** Janela em que a régua PODE falar. Fora dela, o toque espera. */
export interface JanelaComercial {
  /** "09:00" — hora local de abertura. */
  inicio: string;
  /** "19:00" — a partir daqui, empurra para o próximo dia útil. */
  fim: string;
  /** Dias permitidos, padrão Dom=0 … Sáb=6. Default: seg a sex. */
  dias_semana?: number[];
  /** IANA. Default: America/Sao_Paulo. */
  timezone?: string;
}

export interface EsperaConfig {
  dias?: number;
  horas?: number;
  minutos?: number;
  janela?: JanelaComercial;
}

const TZ_PADRAO = "America/Sao_Paulo";
const DIAS_UTEIS = [1, 2, 3, 4, 5];

interface PartesLocais {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  diaSemana: number;
}

/** Quebra um instante nas partes do relógio de parede daquele fuso. */
export function partesNoFuso(quando: Date, timezone: string): PartesLocais {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const partes = Object.fromEntries(
    fmt.formatToParts(quando).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const semana: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    ano: Number(partes.year),
    mes: Number(partes.month),
    dia: Number(partes.day),
    // 24h no en-US devolve "24" para a meia-noite; normalizamos para 0.
    hora: Number(partes.hour) % 24,
    minuto: Number(partes.minute),
    diaSemana: semana[partes.weekday] ?? 0,
  };
}

/**
 * O instante UTC correspondente a uma hora de parede naquele fuso.
 *
 * Duas passadas de propósito: o deslocamento do fuso depende do próprio
 * instante, então a primeira estimativa pode cair do lado errado de uma
 * virada (o Brasil não tem horário de verão desde 2019, mas a função é
 * usada por conta, e o dia em que alguém plugar um fuso que tem não pode
 * ser o dia em que a cadência dispara na hora errada).
 */
export function horaLocalParaUtc(
  ano: number,
  mes: number,
  dia: number,
  hora: number,
  minuto: number,
  timezone: string,
): Date {
  let palpite = Date.UTC(ano, mes - 1, dia, hora, minuto, 0, 0);
  for (let i = 0; i < 2; i += 1) {
    const p = partesNoFuso(new Date(palpite), timezone);
    const obtido = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, 0, 0);
    const alvo = Date.UTC(ano, mes - 1, dia, hora, minuto, 0, 0);
    const erro = alvo - obtido;
    if (erro === 0) break;
    palpite += erro;
  }
  return new Date(palpite);
}

function minutosDe(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m ?? 0);
}

/**
 * Empurra o instante para dentro da janela: antes da abertura, sobe para a
 * abertura do mesmo dia; a partir do fechamento (ou em dia não permitido),
 * vai para a abertura do próximo dia permitido.
 */
export function dentroDaJanela(quando: Date, janela: JanelaComercial): Date {
  const tz = janela.timezone ?? TZ_PADRAO;
  const dias = janela.dias_semana?.length ? janela.dias_semana : DIAS_UTEIS;
  const abre = minutosDe(janela.inicio);
  const fecha = minutosDe(janela.fim);

  let cursor = quando;
  // 14 saltos cobrem qualquer configuração sã (inclusive "só segunda").
  for (let i = 0; i < 14; i += 1) {
    const p = partesNoFuso(cursor, tz);
    const agora = p.hora * 60 + p.minuto;
    const diaPermitido = dias.includes(p.diaSemana);

    if (diaPermitido && agora >= abre && agora < fecha) return cursor;

    if (diaPermitido && agora < abre) {
      return horaLocalParaUtc(p.ano, p.mes, p.dia, Math.floor(abre / 60), abre % 60, tz);
    }
    // Fechado hoje (ou dia não permitido): tenta a abertura do dia seguinte.
    const amanha = new Date(
      horaLocalParaUtc(p.ano, p.mes, p.dia, 12, 0, tz).getTime() + 24 * 3600_000,
    );
    const pa = partesNoFuso(amanha, tz);
    cursor = horaLocalParaUtc(
      pa.ano, pa.mes, pa.dia, Math.floor(abre / 60), abre % 60, tz,
    );
  }
  return cursor;
}

/** Quando o run deve voltar a andar. */
export function proximoRetorno(agora: Date, cfg: EsperaConfig): Date {
  const espera =
    (cfg.dias ?? 0) * 86400_000 +
    (cfg.horas ?? 0) * 3600_000 +
    (cfg.minutos ?? 0) * 60_000;
  const bruto = new Date(agora.getTime() + espera);
  return cfg.janela ? dentroDaJanela(bruto, cfg.janela) : bruto;
}
