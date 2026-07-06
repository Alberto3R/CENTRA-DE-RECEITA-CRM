// Camada de persistência dos módulos de IA — escreve com a SERVICE ROLE.
//
// Portado do repositorio.ts do head comercIAl, reescrito para o schema unificado
// do WACRM: `tenant_id` -> `account_id`, tabelas prefixadas `ai_`.
//
// ⚠️ A service role IGNORA o RLS. Por isso TODA função aqui recebe `accountId`
// explícito (resolvido por requireRole no caller) e o usa em TODO insert/select/
// update — é o código que garante o isolamento multi-tenant nesta camada,
// exatamente como o api-context.ts já documenta para a API pública.

import { supabaseAdmin } from "@/lib/flows/admin-client";

import type { AnaliseCall } from "./analise-call";
import type { UsoTokens } from "./anthropic";
import type { AnaliseResumida } from "./coaching";
import type { DealFunil } from "./pauta-funil/forecast";
import type { LinhaVendedor } from "./raio-x/matriz";

/** As 7 dimensões canônicas (para extrair scores do resumo de coaching). */
const DIMENSOES_KEYS = [
  "abertura_rapport",
  "qualificacao_fit",
  "spin",
  "apresentacao",
  "preco",
  "objecoes",
  "fechamento_proximos_passos",
] as const;

export type AiDocumentoTipo =
  | "call_transcript"
  | "whatsapp_txt"
  | "whatsapp_print"
  | "roleplay";

export type AiDocumentoStatus =
  | "recebido"
  | "validado"
  | "rejeitado"
  | "processado";

/** Cria a linha em `ai_documents` e devolve o id. */
export async function inserirDocumento(p: {
  accountId: string;
  tipo: AiDocumentoTipo;
  origem?: string;
  storagePath?: string;
  status?: AiDocumentoStatus;
  conversationId?: string | null;
}): Promise<string> {
  if (p.storagePath && !p.storagePath.startsWith(`${p.accountId}/`)) {
    throw new Error(
      "storage_path deve começar com o prefixo <account_id>/ (isolamento de Storage).",
    );
  }
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("ai_documents")
    .insert({
      account_id: p.accountId,
      tipo: p.tipo,
      origem: p.origem ?? null,
      storage_path: p.storagePath ?? null,
      status: p.status ?? "recebido",
      conversation_id: p.conversationId ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Falha ao inserir documento: ${error?.message ?? "sem dados"}`);
  }
  return data.id as string;
}

/** Atualiza o status do documento, sempre escopado à conta. */
export async function atualizarStatusDocumento(
  accountId: string,
  documentId: string,
  status: AiDocumentoStatus,
): Promise<void> {
  const admin = supabaseAdmin();
  const { error } = await admin
    .from("ai_documents")
    .update({ status })
    .eq("id", documentId)
    .eq("account_id", accountId);
  if (error) {
    throw new Error(`Falha ao atualizar status do documento: ${error.message}`);
  }
}

export interface AnaliseSalva {
  id: string;
  created_at: string;
}

/** Persiste a análise das dimensões em `ai_analyses`. */
export async function inserirAnalise(p: {
  accountId: string;
  documentId: string;
  sellerId?: string | null;
  conversationId?: string | null;
  tipo: string;
  analise: AnaliseCall;
  promptVersao: string;
  metodo: string;
  customizado: boolean;
}): Promise<AnaliseSalva> {
  const admin = supabaseAdmin();
  const a = p.analise;
  const { data, error } = await admin
    .from("ai_analyses")
    .insert({
      account_id: p.accountId,
      document_id: p.documentId,
      seller_id: p.sellerId ?? null,
      conversation_id: p.conversationId ?? null,
      tipo: p.tipo,
      dimensoes: a.dimensoes,
      nota: a.nota,
      perda_estimada_reais: a.perda_estimada_reais,
      perda_memoria_calculo: a.perda_memoria_calculo,
      // `prescricoes` (jsonb) guarda o pacote acionável + o snapshot do método
      // usado (rastreio de regressão de prompt — ver plano de fusão, Risco 1).
      prescricoes: {
        prescricoes: a.prescricoes,
        proximos_passos: a.proximos_passos,
        dados_faltantes: a.dados_faltantes,
        dados_crm: a.dados_crm,
        prompt_versao: p.promptVersao,
        metodo: p.metodo,
        customizado: p.customizado,
      },
      disposicao: "pendente",
    })
    .select("id, created_at")
    .single();
  if (error || !data) {
    throw new Error(`Falha ao inserir análise: ${error?.message ?? "sem dados"}`);
  }
  return { id: data.id as string, created_at: data.created_at as string };
}

/**
 * Registra o uso de IA (tokens + custo estimado) em `usage_events` — telemetria
 * de custo (base do fair use e da margem dos planos). A contagem de quota
 * (unidades faturáveis) vive em src/lib/billing/quota.ts.
 * Telemetria não pode derrubar a operação principal: loga e segue.
 */
export async function registrarUso(p: {
  accountId: string;
  capacidade: string;
  uso: UsoTokens;
  custoUsd: number;
}): Promise<void> {
  const admin = supabaseAdmin();
  const { error } = await admin.from("ai_usage_events").insert({
    account_id: p.accountId,
    capacidade: p.capacidade,
    modelo: p.uso.modelo,
    tokens_in: p.uso.tokens_in,
    tokens_out: p.uso.tokens_out,
    custo_usd: p.custoUsd,
  });
  if (error) {
    console.error(`[usage_events] falha ao registrar uso: ${error.message}`);
  }
}

export interface AnaliseResumo {
  id: string;
  created_at: string;
  nota: string | null;
  tipo: string | null;
  seller_id: string | null;
  conversation_id: string | null;
  perda_estimada_reais: number | null;
}

/** Lista as análises recentes da conta (para a lista no app). */
export async function listarAnalises(
  accountId: string,
  limite = 20,
): Promise<AnaliseResumo[]> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("ai_analyses")
    .select(
      "id, created_at, nota, tipo, seller_id, conversation_id, perda_estimada_reais",
    )
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(limite);
  if (error) {
    throw new Error(`Falha ao listar análises: ${error.message}`);
  }
  return (data ?? []) as AnaliseResumo[];
}

export interface SellerLite {
  id: string;
  nome: string;
  funcao: string;
}

/** Lista os vendedores da conta (para vincular a análise a um seller). */
export async function listarSellers(accountId: string): Promise<SellerLite[]> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("sellers")
    .select("id, nome, funcao")
    .eq("account_id", accountId)
    .order("nome", { ascending: true });
  if (error) {
    throw new Error(`Falha ao listar vendedores: ${error.message}`);
  }
  return (data ?? []) as SellerLite[];
}

/**
 * true se o seller pertence à conta. Evita vincular uma análise a um vendedor de
 * OUTRA conta (o sellerId vem do cliente e não é confiável).
 */
export async function sellerPertenceAConta(
  accountId: string,
  sellerId: string,
): Promise<boolean> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("sellers")
    .select("id")
    .eq("id", sellerId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) {
    throw new Error(`Falha ao verificar vendedor: ${error.message}`);
  }
  return Boolean(data);
}

// ---------------------------------------------------------------------------
// Motor DESENVOLVE — sellers, coaching, PDI.
// ---------------------------------------------------------------------------

/** Cria um vendedor (seller) na conta. */
export async function criarSeller(p: {
  accountId: string;
  nome: string;
  funcao: string;
}): Promise<SellerLite> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("sellers")
    .insert({ account_id: p.accountId, nome: p.nome, funcao: p.funcao })
    .select("id, nome, funcao")
    .single();
  if (error || !data) {
    throw new Error(`Falha ao criar vendedor: ${error?.message ?? "sem dados"}`);
  }
  return data as SellerLite;
}

/** Busca um vendedor da conta (nome + função). null se não existir nela. */
export async function buscarSeller(
  accountId: string,
  sellerId: string,
): Promise<SellerLite | null> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("sellers")
    .select("id, nome, funcao")
    .eq("id", sellerId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) throw new Error(`Falha ao buscar vendedor: ${error.message}`);
  return (data as SellerLite | null) ?? null;
}

/**
 * Resume as análises (call/whatsapp) de um vendedor no formato que o coaching
 * consome: data, nota, scores por dimensão e prescrições recentes.
 */
export async function resumirAnalisesDoSeller(
  accountId: string,
  sellerId: string,
): Promise<AnaliseResumida[]> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("ai_analyses")
    .select("created_at, nota, dimensoes, prescricoes")
    .eq("account_id", accountId)
    .eq("seller_id", sellerId)
    .in("tipo", ["call", "whatsapp"])
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Falha ao ler análises do vendedor: ${error.message}`);

  return (data ?? []).map((a) => {
    const dims = (a.dimensoes ?? {}) as Record<string, { score?: number }>;
    const scores: AnaliseResumida["scores"] = {};
    for (const k of DIMENSOES_KEYS) {
      const s = dims[k]?.score;
      if (typeof s === "number") scores[k] = s;
    }
    const presc = (a.prescricoes ?? {}) as {
      prescricoes?: { o_que_dizer?: string }[];
    };
    return {
      data: String(a.created_at).slice(0, 10),
      nota: (a.nota as string | null) ?? null,
      scores,
      prescricoes: (presc.prescricoes ?? [])
        .map((p) => p.o_que_dizer)
        .filter((x): x is string => Boolean(x)),
    };
  });
}

/** Persiste um PDI (rascunho) em `ai_pdis`. */
export async function inserirPdi(p: {
  accountId: string;
  sellerId: string;
  parecerTexto: string;
  plano: unknown;
}): Promise<AnaliseSalva> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("ai_pdis")
    .insert({
      account_id: p.accountId,
      seller_id: p.sellerId,
      parecer_texto: p.parecerTexto,
      plano_90d: p.plano,
      status: "rascunho",
    })
    .select("id, created_at")
    .single();
  if (error || !data) {
    throw new Error(`Falha ao inserir PDI: ${error?.message ?? "sem dados"}`);
  }
  return { id: data.id as string, created_at: data.created_at as string };
}

// ---------------------------------------------------------------------------
// Motor CRIA — scripts e objeções (geração).
// ---------------------------------------------------------------------------

/** Persiste um script gerado em `ai_scripts`. */
export async function inserirScript(p: {
  accountId: string;
  tipo: string;
  titulo: string;
  etapas: unknown;
  versoes?: unknown;
}): Promise<AnaliseSalva> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("ai_scripts")
    .insert({
      account_id: p.accountId,
      tipo: p.tipo,
      titulo: p.titulo,
      etapas: p.etapas,
      versoes: p.versoes ?? [],
    })
    .select("id, created_at")
    .single();
  if (error || !data) {
    throw new Error(`Falha ao inserir script: ${error?.message ?? "sem dados"}`);
  }
  return { id: data.id as string, created_at: data.created_at as string };
}

/** Persiste uma objeção + contornos em `ai_objections`. */
export async function inserirObjecao(p: {
  accountId: string;
  origem: string;
  objecao: string;
  contornos: unknown;
  respondidaPor?: string | null;
}): Promise<AnaliseSalva> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("ai_objections")
    .insert({
      account_id: p.accountId,
      origem: p.origem,
      objecao: p.objecao,
      contornos: p.contornos,
      respondida_por: p.respondidaPor ?? null,
    })
    .select("id, created_at")
    .single();
  if (error || !data) {
    throw new Error(`Falha ao inserir objeção: ${error?.message ?? "sem dados"}`);
  }
  return { id: data.id as string, created_at: data.created_at as string };
}

/**
 * Persiste uma análise "genérica" (raio-x, pauta-funil) em `ai_analyses`.
 * `dimensoes` guarda as métricas calculadas; `prescricoes` a interpretação da IA.
 */
export async function inserirAnaliseGenerica(p: {
  accountId: string;
  tipo: string;
  dimensoes: unknown;
  prescricoes: unknown;
}): Promise<AnaliseSalva> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("ai_analyses")
    .insert({
      account_id: p.accountId,
      tipo: p.tipo,
      dimensoes: p.dimensoes,
      nota: null,
      perda_estimada_reais: null,
      perda_memoria_calculo: null,
      prescricoes: p.prescricoes,
      disposicao: "pendente",
    })
    .select("id, created_at")
    .single();
  if (error || !data) {
    throw new Error(`Falha ao inserir análise: ${error?.message ?? "sem dados"}`);
  }
  return { id: data.id as string, created_at: data.created_at as string };
}

// ---------------------------------------------------------------------------
// Motor ANALISA — agregadores que leem o CRM vivo (deals/pipelines/profiles).
// ---------------------------------------------------------------------------

/**
 * Agrega os deals ABERTOS da conta no formato DealFunil (para o cálculo de
 * forecast/pauta). `diasParado` é proxy: dias desde a última atualização.
 */
export async function agregarFunil(
  accountId: string,
  pipelineId?: string,
): Promise<DealFunil[]> {
  const admin = supabaseAdmin();
  let q = admin
    .from("deals")
    .select("title, value, status, expected_close_date, updated_at, stage_id")
    .eq("account_id", accountId)
    .eq("status", "open");
  if (pipelineId) q = q.eq("pipeline_id", pipelineId);
  const { data: deals, error } = await q;
  if (error) throw new Error(`Falha ao ler deals: ${error.message}`);
  const rows = deals ?? [];

  const stageIds = [
    ...new Set(rows.map((d) => d.stage_id).filter((s): s is string => Boolean(s))),
  ];
  const nomeEtapa = new Map<string, string>();
  if (stageIds.length > 0) {
    const { data: stages } = await admin
      .from("pipeline_stages")
      .select("id, name")
      .in("id", stageIds);
    for (const s of stages ?? []) nomeEtapa.set(s.id as string, s.name as string);
  }

  const hoje = Date.now();
  return rows.map((d) => {
    const num = d.value == null ? NaN : Number(d.value);
    const valor = Number.isFinite(num) && num > 0 ? num : undefined;
    const diasParado = d.updated_at
      ? Math.max(0, Math.floor((hoje - new Date(d.updated_at as string).getTime()) / 86400000))
      : undefined;
    return {
      deal: (d.title as string) || "(sem título)",
      valor,
      etapa: d.stage_id ? nomeEtapa.get(d.stage_id as string) : undefined,
      diasParado,
      dataFechamento: (d.expected_close_date as string | null) ?? undefined,
    };
  });
}

/**
 * Agrega métricas por vendedor (assigned_to) no formato LinhaVendedor, a partir
 * dos deals da conta: atividade = nº de deals; conversão = won/(won+lost);
 * ciclo = média de dias até fechar (ganhos); ticket = média do valor (ganhos).
 */
export async function agregarRaioX(accountId: string): Promise<LinhaVendedor[]> {
  const admin = supabaseAdmin();
  const { data: deals, error } = await admin
    .from("deals")
    .select("assigned_to, status, value, created_at, closed_at")
    .eq("account_id", accountId);
  if (error) throw new Error(`Falha ao ler deals: ${error.message}`);

  const { data: profs } = await admin
    .from("profiles")
    .select("id, full_name")
    .eq("account_id", accountId);
  const nome = new Map<string, string>();
  for (const p of profs ?? []) {
    nome.set(p.id as string, (p.full_name as string) || "Sem nome");
  }

  interface Grupo {
    total: number;
    won: number;
    lost: number;
    ciclos: number[];
    tickets: number[];
  }
  const grupos = new Map<string, Grupo>();
  for (const d of deals ?? []) {
    const aid = d.assigned_to as string | null;
    if (!aid) continue;
    const g = grupos.get(aid) ?? { total: 0, won: 0, lost: 0, ciclos: [], tickets: [] };
    g.total += 1;
    if (d.status === "won") {
      g.won += 1;
      const num = Number(d.value);
      if (Number.isFinite(num) && num > 0) g.tickets.push(num);
      if (d.created_at && d.closed_at) {
        const dias =
          (new Date(d.closed_at as string).getTime() -
            new Date(d.created_at as string).getTime()) /
          86400000;
        if (dias >= 0) g.ciclos.push(dias);
      }
    } else if (d.status === "lost") {
      g.lost += 1;
    }
    grupos.set(aid, g);
  }

  const avg = (a: number[]): number | null =>
    a.length > 0 ? a.reduce((x, y) => x + y, 0) / a.length : null;

  return [...grupos.entries()].map(([aid, g]) => ({
    nome: nome.get(aid) ?? "Vendedor",
    atividades: g.total,
    conversao: g.won + g.lost > 0 ? g.won / (g.won + g.lost) : null,
    ciclo: avg(g.ciclos),
    ticket: avg(g.tickets),
  }));
}

/** Persiste uma campanha gerada em `ai_campaigns`. */
export async function inserirCampanha(p: {
  accountId: string;
  tipo: string;
  titulo: string;
  mecanica: unknown;
  copy?: string | null;
}): Promise<AnaliseSalva> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("ai_campaigns")
    .insert({
      account_id: p.accountId,
      tipo: p.tipo,
      titulo: p.titulo,
      mecanica: p.mecanica,
      copy: p.copy ?? null,
    })
    .select("id, created_at")
    .single();
  if (error || !data) {
    throw new Error(`Falha ao inserir campanha: ${error?.message ?? "sem dados"}`);
  }
  return { id: data.id as string, created_at: data.created_at as string };
}

/**
 * Serializa as mensagens de uma conversa do CRM em texto analisável
 * ("[hh:mm] Falante: fala"). Lê `messages` da conversa, escopado pela conta.
 * Usado pelo módulo de análise de WhatsApp (lê o CRM vivo, sem colar nada).
 */
export async function carregarConversaComoTexto(
  accountId: string,
  conversationId: string,
): Promise<{ texto: string; totalMensagens: number }> {
  const admin = supabaseAdmin();

  // Garante que a conversa é da conta antes de ler as mensagens.
  const { data: conv, error: convErr } = await admin
    .from("conversations")
    .select("id, account_id")
    .eq("id", conversationId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (convErr) {
    throw new Error(`Falha ao carregar conversa: ${convErr.message}`);
  }
  if (!conv) {
    throw new Error("Conversa não encontrada nesta conta.");
  }

  const { data: msgs, error: msgErr } = await admin
    .from("messages")
    .select("sender_type, content_type, content_text, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (msgErr) {
    throw new Error(`Falha ao carregar mensagens: ${msgErr.message}`);
  }

  const linhas = (msgs ?? [])
    .map((m) => {
      // Só texto entra na análise; mídia/template viram um marcador curto.
      const texto =
        m.content_type === "text" && typeof m.content_text === "string"
          ? m.content_text.trim()
          : m.content_type !== "text"
            ? `(${m.content_type})`
            : "";
      if (!texto) return null;
      const falante = m.sender_type === "customer" ? "Cliente" : "Vendedor";
      const ts = formatarHora(m.created_at as string | null);
      return `${ts}${falante}: ${texto}`;
    })
    .filter((l): l is string => l !== null);

  return { texto: linhas.join("\n"), totalMensagens: linhas.length };
}

function formatarHora(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `[${hh}:${mm}] `;
}
