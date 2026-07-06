// Parser de transcrições para .txt e .vtt (WebVTT do Google Meet).
// Portado do head comercIAl. Normaliza qualquer entrada em uma lista de turnos
// { falante, timestamp, fala } e produz um texto normalizado que a análise consome.
// Também usado para serializar uma conversa do CRM (messages) em texto analisável.

export interface Turno {
  /** Nome/identificador do falante. "Desconhecido" quando não há marcação. */
  falante: string;
  /** Timestamp do turno no formato [mm:ss] ou [hh:mm:ss]. "" se indisponível. */
  timestamp: string;
  /** Texto falado neste turno. */
  fala: string;
}

export type FormatoTranscricao = "vtt" | "txt";

export interface NormalizacaoResultado {
  formato: FormatoTranscricao;
  turnos: Turno[];
  /** Texto pronto para enviar ao modelo: "[ts] Falante: fala" por linha. */
  textoNormalizado: string;
}

/**
 * Detecta o formato e normaliza. Heurística de detecção: presença do header
 * "WEBVTT" ou de timestamps de cue (00:00:00.000 --> 00:00:05.000) => vtt.
 */
export function normalizarTranscricao(
  conteudo: string,
  hintFormato?: FormatoTranscricao,
): NormalizacaoResultado {
  const formato = hintFormato ?? detectarFormato(conteudo);
  const turnos = formato === "vtt" ? parseVtt(conteudo) : parseTxt(conteudo);
  return {
    formato,
    turnos,
    textoNormalizado: turnosParaTexto(turnos),
  };
}

// ---------------------------------------------------------------------------
// Detecção de formato
// ---------------------------------------------------------------------------

const RE_CUE_VTT =
  /^\s*(?:\d{2}:)?\d{2}:\d{2}[.,]\d{3}\s*-->\s*(?:\d{2}:)?\d{2}:\d{2}[.,]\d{3}/m;

function detectarFormato(conteudo: string): FormatoTranscricao {
  if (/^﻿?WEBVTT/.test(conteudo) || RE_CUE_VTT.test(conteudo)) {
    return "vtt";
  }
  return "txt";
}

// ---------------------------------------------------------------------------
// WebVTT (Google Meet, Fireflies export, etc.)
// ---------------------------------------------------------------------------

const RE_TIMELINE_VTT =
  /^\s*((?:\d{2}:)?\d{2}:\d{2})[.,]\d{3}\s*-->\s*(?:\d{2}:)?\d{2}:\d{2}[.,]\d{3}/;

/** Captura "Falante: fala" no início de uma linha de texto do cue. */
const RE_FALANTE = /^\s*([^:<>\n]{1,60}?):\s*(.*)$/;

/** Remove tags inline do WebVTT (<v Fulano>, <00:00:01.000>, <c>, etc.). */
function limparTagsVtt(linha: string): string {
  return linha.replace(/<[^>]+>/g, "").trim();
}

/** Extrai falante de uma tag <v Fulano> caso presente na linha. */
function falanteDaTagV(linha: string): string | null {
  const nome = linha.match(/<v\s+([^>]+)>/i)?.[1]?.trim();
  return nome ? nome : null;
}

function parseVtt(conteudo: string): Turno[] {
  const linhas = conteudo.replace(/^﻿/, "").split(/\r?\n/);
  const turnos: Turno[] = [];

  let timestampAtual = "";
  let falanteTagAtual: string | null = null;

  for (const linha of linhas) {
    const mTime = linha.match(RE_TIMELINE_VTT);
    if (mTime) {
      const ts = mTime[1];
      if (ts) timestampAtual = formatarTimestamp(ts);
      falanteTagAtual = null;
      continue;
    }

    // Pula header, NOTE, números de cue e linhas vazias.
    const bruto = linha.trim();
    if (
      bruto === "" ||
      /^WEBVTT/.test(bruto) ||
      /^NOTE(\s|$)/.test(bruto) ||
      /^\d+$/.test(bruto)
    ) {
      continue;
    }

    // Falante pode vir via tag <v Fulano> ou prefixo "Fulano:".
    const falanteTag = falanteDaTagV(linha);
    if (falanteTag) falanteTagAtual = falanteTag;

    const texto = limparTagsVtt(linha);
    if (texto === "") continue;

    let falante = falanteTagAtual ?? "Desconhecido";
    let fala = texto;

    const mFal = texto.match(RE_FALANTE);
    if (mFal && !falanteTag) {
      falante = (mFal[1] ?? "").trim() || falante;
      fala = (mFal[2] ?? "").trim();
    }
    if (fala === "") continue;

    // Mescla com o turno anterior se mesmo falante e mesmo timestamp (continuação).
    const ultimo = turnos[turnos.length - 1];
    if (
      ultimo &&
      ultimo.falante === falante &&
      ultimo.timestamp === timestampAtual
    ) {
      ultimo.fala += " " + fala;
    } else {
      turnos.push({ falante, timestamp: timestampAtual, fala });
    }
  }

  return turnos;
}

// ---------------------------------------------------------------------------
// TXT (transcrição em texto puro)
// ---------------------------------------------------------------------------

// Linha típica: "[00:12] João: bom dia" ou "00:12 João: bom dia" ou "João: bom dia".
const RE_TS_PREFIXO = /^\s*\[?((?:\d{1,2}:)?\d{1,2}:\d{2})\]?\s*/;

function parseTxt(conteudo: string): Turno[] {
  const linhas = conteudo.replace(/^﻿/, "").split(/\r?\n/);
  const turnos: Turno[] = [];

  for (const linhaBruta of linhas) {
    const linha = linhaBruta.trim();
    if (linha === "") continue;

    let resto = linha;
    let timestamp = "";

    const mTs = resto.match(RE_TS_PREFIXO);
    if (mTs) {
      const ts = mTs[1];
      if (ts) timestamp = formatarTimestamp(ts);
      resto = resto.slice((mTs[0] ?? "").length);
    }

    let falante = "Desconhecido";
    let fala = resto.trim();

    const mFal = resto.match(RE_FALANTE);
    if (mFal) {
      falante = (mFal[1] ?? "").trim() || falante;
      fala = (mFal[2] ?? "").trim();
    }
    if (fala === "") continue;

    // Continuação do mesmo falante sem novo timestamp -> mescla.
    const ultimo = turnos[turnos.length - 1];
    if (
      ultimo &&
      ultimo.falante === falante &&
      (timestamp === "" || timestamp === ultimo.timestamp)
    ) {
      ultimo.fala += " " + fala;
    } else {
      turnos.push({ falante, timestamp, fala });
    }
  }

  return turnos;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normaliza um timestamp para [mm:ss] ou [hh:mm:ss]. Remove milissegundos e
 * zera componentes de hora redundantes (00:12:34 -> 12:34).
 */
function formatarTimestamp(ts: string): string {
  const partes = ts.split(":").map((p) => p.trim());
  if (partes.length === 3) {
    const hh = partes[0] ?? "";
    const mm = partes[1] ?? "";
    const ss = partes[2] ?? "";
    if (hh === "00") return `[${pad2(mm)}:${pad2(ss)}]`;
    return `[${pad2(hh)}:${pad2(mm)}:${pad2(ss)}]`;
  }
  if (partes.length === 2) {
    const mm = partes[0] ?? "";
    const ss = partes[1] ?? "";
    return `[${pad2(mm)}:${pad2(ss)}]`;
  }
  return `[${ts}]`;
}

function pad2(v: string): string {
  return v.length === 1 ? `0${v}` : v;
}

/** Serializa turnos em texto consumível pelo modelo. */
function turnosParaTexto(turnos: Turno[]): string {
  return turnos
    .map((t) => {
      const ts = t.timestamp ? `${t.timestamp} ` : "";
      return `${ts}${t.falante}: ${t.fala}`;
    })
    .join("\n");
}
