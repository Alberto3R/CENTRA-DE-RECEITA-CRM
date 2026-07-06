// RAIO-X DE FUNIL — CÁLCULO DA MATRIZ. Portado do head comercIAl.
// Por vendedor, computa ATIVIDADE (volume) × EFICIÊNCIA (conversão) e classifica
// no QUADRANTE usando a MEDIANA do time como corte. A IA só interpreta.

/** Uma linha de vendedor, no formato que o cálculo consome (vem do agregador do CRM). */
export interface LinhaVendedor {
  nome: string;
  /** volume de atividade (ex.: nº de deals). */
  atividades?: number | null;
  /** eficiência/conversão em fração 0..1. */
  conversao?: number | null;
  /** ciclo médio em dias (contexto). */
  ciclo?: number | null;
  /** ticket médio em R$ (contexto). */
  ticket?: number | null;
}

export type Quadrante = "motor" | "skill" | "accountability" | "risco";

export interface VendedorMatriz {
  nome: string;
  atividade: number | null;
  eficiencia: number | null;
  ciclo: number | null;
  ticket: number | null;
  atividadeAlta: boolean;
  eficienciaAlta: boolean;
  quadrante: Quadrante | null;
}

export interface ResumoMatriz {
  vendedores: VendedorMatriz[];
  cortes: { atividade: number | null; eficiencia: number | null };
  contagem: Record<Quadrante, number>;
  porQuadrante: Record<Quadrante, string[]>;
  incompletos: string[];
  vendedorRisco: string | null;
  gargalo: { quadrante: Quadrante; quantidade: number; total: number } | null;
}

function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const ord = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ord.length / 2);
  return ord.length % 2 === 0 ? (ord[meio - 1]! + ord[meio]!) / 2 : ord[meio]!;
}

export function calcularMatriz(linhas: LinhaVendedor[]): ResumoMatriz {
  const atividades = linhas
    .map((l) => l.atividades)
    .filter((v): v is number => typeof v === "number");
  const eficiencias = linhas
    .map((l) => l.conversao)
    .filter((v): v is number => typeof v === "number");

  const corteAtiv = mediana(atividades);
  const corteEfic = mediana(eficiencias);

  const contagem: Record<Quadrante, number> = {
    motor: 0,
    skill: 0,
    accountability: 0,
    risco: 0,
  };
  const porQuadrante: Record<Quadrante, string[]> = {
    motor: [],
    skill: [],
    accountability: [],
    risco: [],
  };
  const incompletos: string[] = [];

  const vendedores: VendedorMatriz[] = linhas.map((l) => {
    const atividade = l.atividades ?? null;
    const eficiencia = l.conversao ?? null;

    const classificavel =
      atividade !== null &&
      eficiencia !== null &&
      corteAtiv !== null &&
      corteEfic !== null;

    let atividadeAlta = false;
    let eficienciaAlta = false;
    let quadrante: Quadrante | null = null;

    if (classificavel) {
      atividadeAlta = atividade >= corteAtiv;
      eficienciaAlta = eficiencia >= corteEfic;
      if (atividadeAlta && eficienciaAlta) quadrante = "motor";
      else if (atividadeAlta && !eficienciaAlta) quadrante = "skill";
      else if (!atividadeAlta && eficienciaAlta) quadrante = "accountability";
      else quadrante = "risco";
      contagem[quadrante] += 1;
      porQuadrante[quadrante].push(l.nome);
    } else {
      incompletos.push(l.nome);
    }

    return {
      nome: l.nome,
      atividade,
      eficiencia,
      ciclo: l.ciclo ?? null,
      ticket: l.ticket ?? null,
      atividadeAlta,
      eficienciaAlta,
      quadrante,
    };
  });

  let vendedorRisco: string | null = null;
  let piorEfic = Infinity;
  for (const v of vendedores) {
    if (v.quadrante === "risco" && v.eficiencia !== null && v.eficiencia < piorEfic) {
      piorEfic = v.eficiencia;
      vendedorRisco = v.nome;
    }
  }

  const totalClassificados =
    contagem.motor + contagem.skill + contagem.accountability + contagem.risco;

  let gargalo: ResumoMatriz["gargalo"] = null;
  if (totalClassificados > 0) {
    const ordemGravidade: Quadrante[] = ["risco", "skill", "accountability", "motor"];
    let melhor: Quadrante = "motor";
    let melhorQtd = -1;
    for (const q of ["risco", "skill", "accountability"] as Quadrante[]) {
      if (contagem[q] > melhorQtd) {
        melhorQtd = contagem[q];
        melhor = q;
      }
    }
    if (melhorQtd <= 0) {
      melhor = "motor";
      melhorQtd = contagem.motor;
    } else {
      for (const q of ordemGravidade) {
        if (q === "motor") break;
        if (contagem[q] === melhorQtd) {
          melhor = q;
          break;
        }
      }
    }
    gargalo = { quadrante: melhor, quantidade: melhorQtd, total: totalClassificados };
  }

  return {
    vendedores,
    cortes: { atividade: corteAtiv, eficiencia: corteEfic },
    contagem,
    porQuadrante,
    incompletos,
    vendedorRisco,
    gargalo,
  };
}
