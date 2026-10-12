// Executor das ações do agente de grupo (service role). Cada ação usa a mesma
// lógica da tela do CRM — funil via criarFunilPadrao, template via os mesmos
// validadores/montadores do /api/whatsapp/templates/submit — para o agente
// nunca criar algo que a interface não criaria.

import { criarFunilPadrao } from '@/lib/ccc/setup-funil';
import { funcaoInfo } from '@/lib/pipelines/funcoes';
import { resolveChannelConfig } from '@/lib/whatsapp/channel';
import { decrypt } from '@/lib/whatsapp/encryption';
import { submitMessageTemplate } from '@/lib/whatsapp/meta-api';
import {
  validateTemplatePayload,
  type TemplatePayload,
} from '@/lib/whatsapp/template-validators';
import { buildMetaTemplatePayload } from '@/lib/whatsapp/template-components';
import { normalizeStatus } from '@/lib/whatsapp/template-status-normalize';
import type { GroupAction } from './actions';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export interface ActionResult {
  ok: boolean;
  texto: string;
}

const TERMINAIS = new Set(['ganho', 'perdido', 'reativacao']);

async function ownerId(db: Db, accountId: string): Promise<string | null> {
  const { data } = await db
    .from('account_members')
    .select('user_id')
    .eq('account_id', accountId)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle();
  return data?.user_id ?? null;
}

async function findPipeline(db: Db, accountId: string, nome: string) {
  const { data } = await db
    .from('pipelines')
    .select('id, name')
    .eq('account_id', accountId);
  const alvo = nome.trim().toLowerCase();
  const lista = (data ?? []) as { id: string; name: string }[];
  return (
    lista.find((p) => p.name.toLowerCase() === alvo) ??
    lista.find((p) => p.name.toLowerCase().includes(alvo)) ??
    null
  );
}

async function criarFunil(
  db: Db,
  accountId: string,
  a: Extract<GroupAction, { tipo: 'criar_funil' }>
): Promise<ActionResult> {
  const r = await criarFunilPadrao({
    supabase: db,
    accountId,
    nomePipeline: a.nome,
    modeloId: a.modelo_id,
    etapas: a.etapas?.map((e) => ({
      name: e.nome,
      funcao: e.funcao,
      is_connection: e.funcao === 'conexao',
      color: funcaoInfo(e.funcao).cor,
      dias_max: funcaoInfo(e.funcao).diasPadrao,
    })),
  });
  if (!r.ok) return { ok: false, texto: `Funil *${a.nome}*: ${r.error}` };
  if (r.reused)
    return {
      ok: true,
      texto: `Funil *${r.nome}* já existia, não criei outro.`,
    };
  return {
    ok: true,
    texto: `Funil *${r.nome}* criado com ${r.etapas?.length ?? 0} etapas.`,
  };
}

async function adicionarEtapa(
  db: Db,
  accountId: string,
  a: Extract<GroupAction, { tipo: 'adicionar_etapa' }>
): Promise<ActionResult> {
  const p = await findPipeline(db, accountId, a.funil);
  if (!p) return { ok: false, texto: `Não achei o funil "${a.funil}".` };
  const { data: stages } = await db
    .from('pipeline_stages')
    .select('id, name, position, funcao')
    .eq('pipeline_id', p.id)
    .order('position');
  const lista = (stages ?? []) as {
    id: string;
    name: string;
    position: number;
    funcao: string;
  }[];
  if (lista.some((s) => s.name.toLowerCase() === a.nome.toLowerCase())) {
    return {
      ok: true,
      texto: `A etapa *${a.nome}* já existe no funil *${p.name}*.`,
    };
  }
  // Etapa de andamento entra antes de Ganho/Perdido/Reativação; terminal vai pro fim.
  const primeiraTerminal = lista.find((s) => TERMINAIS.has(s.funcao));
  const pos =
    !TERMINAIS.has(a.funcao) && primeiraTerminal
      ? primeiraTerminal.position
      : (lista.at(-1)?.position ?? -1) + 1;
  for (const s of lista.filter((s) => s.position >= pos).reverse()) {
    await db
      .from('pipeline_stages')
      .update({ position: s.position + 1 })
      .eq('id', s.id);
  }
  const info = funcaoInfo(a.funcao);
  const { error } = await db.from('pipeline_stages').insert({
    pipeline_id: p.id,
    name: a.nome,
    position: pos,
    funcao: a.funcao,
    is_connection: a.funcao === 'conexao',
    color: info.cor,
    dias_max: info.diasPadrao,
  });
  if (error) return { ok: false, texto: `Etapa *${a.nome}*: ${error.message}` };
  return {
    ok: true,
    texto: `Etapa *${a.nome}* adicionada ao funil *${p.name}*.`,
  };
}

async function criarTag(
  db: Db,
  accountId: string,
  a: Extract<GroupAction, { tipo: 'criar_tag' }>
): Promise<ActionResult> {
  const { data: existe } = await db
    .from('tags')
    .select('id')
    .eq('account_id', accountId)
    .ilike('name', a.nome)
    .maybeSingle();
  if (existe) return { ok: true, texto: `A tag *${a.nome}* já existia.` };
  const user = await ownerId(db, accountId);
  if (!user) return { ok: false, texto: 'Conta sem dono definido.' };
  const { error } = await db
    .from('tags')
    .insert({
      account_id: accountId,
      user_id: user,
      name: a.nome,
      color: a.cor ?? '#6366f1',
    });
  if (error) return { ok: false, texto: `Tag *${a.nome}*: ${error.message}` };
  return { ok: true, texto: `Tag *${a.nome}* criada.` };
}

async function criarTemplate(
  db: Db,
  accountId: string,
  a: Extract<GroupAction, { tipo: 'criar_template' }>
): Promise<ActionResult> {
  const user = await ownerId(db, accountId);
  if (!user) return { ok: false, texto: 'Conta sem dono definido.' };
  const config = await resolveChannelConfig(db, accountId, null);
  if (!config?.waba_id)
    return {
      ok: false,
      texto: 'A conta não tem WhatsApp oficial conectado para criar template.',
    };

  const payload: TemplatePayload = {
    name: a.nome,
    category: a.categoria,
    language: a.idioma,
    body_text: a.corpo,
    ...(a.rodape ? { footer_text: a.rodape } : {}),
    ...(a.exemplos?.length ? { sample_values: { body: a.exemplos } } : {}),
  };
  try {
    validateTemplatePayload(payload);
  } catch (e) {
    return {
      ok: false,
      texto: `Template *${a.nome}*: ${e instanceof Error ? e.message : 'inválido'}`,
    };
  }

  const row = {
    account_id: accountId,
    channel_id: config.id,
    user_id: user,
    name: payload.name,
    category: payload.category,
    language: payload.language,
    body_text: payload.body_text,
    footer_text: payload.footer_text ?? null,
    sample_values: payload.sample_values ?? null,
    last_submitted_at: new Date().toISOString(),
  };

  try {
    const meta = await submitMessageTemplate({
      wabaId: config.waba_id,
      accessToken: decrypt(config.access_token),
      payload: buildMetaTemplatePayload(payload),
    });
    await db
      .from('message_templates')
      .upsert(
        {
          ...row,
          status: normalizeStatus(meta.status),
          meta_template_id: meta.id,
          submission_error: null,
        },
        { onConflict: 'channel_id,name,language' }
      );
    return {
      ok: true,
      texto: `Template *${a.nome}* enviado para aprovação da Meta (status: ${meta.status}).`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'falha na Meta';
    await db
      .from('message_templates')
      .upsert(
        {
          ...row,
          status: 'DRAFT',
          meta_template_id: null,
          submission_error: msg,
        },
        { onConflict: 'channel_id,name,language' }
      );
    return {
      ok: false,
      texto: `Template *${a.nome}*: a Meta recusou (${msg}). Ficou salvo como rascunho no CRM.`,
    };
  }
}

export async function executePlan(
  db: Db,
  accountId: string,
  acoes: GroupAction[]
): Promise<ActionResult[]> {
  const out: ActionResult[] = [];
  for (const a of acoes) {
    try {
      if (a.tipo === 'criar_funil')
        out.push(await criarFunil(db, accountId, a));
      else if (a.tipo === 'adicionar_etapa')
        out.push(await adicionarEtapa(db, accountId, a));
      else if (a.tipo === 'criar_tag')
        out.push(await criarTag(db, accountId, a));
      else if (a.tipo === 'criar_template')
        out.push(await criarTemplate(db, accountId, a));
    } catch (e) {
      out.push({
        ok: false,
        texto: `Erro inesperado: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
  return out;
}
