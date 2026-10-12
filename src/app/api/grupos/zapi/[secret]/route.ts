import { after, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import {
  describePlan,
  validatePlan,
  type GroupAction,
} from '@/lib/grupos/actions';
import { executePlan } from '@/lib/grupos/execute';
import { accountContext, planRequest } from '@/lib/grupos/planner';
import {
  extractLinkCode,
  isCancel,
  isConfirm,
  isMention,
  stripMentions,
} from '@/lib/grupos/text';
import { sendGroupText, type ZapiInbound } from '@/lib/grupos/zapi';
import { MODELOS } from '@/lib/pipelines/modelos';

// ============================================================
// POST /api/grupos/zapi/[secret] — webhook "Ao receber" da Z-API do número do
// Agente 3R (migration 116).
//
// A Z-API não assina o webhook: a autenticação é o segredo no caminho
// (ZAPI_WEBHOOK_SECRET) + o instanceId conferido com ZAPI_INSTANCE_ID.
// Responde 200 na hora e processa em after() — a IA leva alguns segundos e
// a Z-API não pode ficar esperando (reentrega). Reentrega é deduplicada pelo
// message_id único em group_agent_requests.
//
// Fluxo: marcado → (código de vínculo? vincula) → (grupo sem conta? explica)
// → IA planeja → mostra o plano → "ok" de QUEM PEDIU (até 30 min) → executa.
// ============================================================

export const maxDuration = 120;

const CONFIRM_WINDOW_MIN = 30;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _admin: any = null;
function admin() {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _admin;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ secret: string }> }
) {
  const { secret } = await params;
  const expected = process.env.ZAPI_WEBHOOK_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: ZapiInbound;
  try {
    body = (await request.json()) as ZapiInbound;
  } catch {
    return NextResponse.json({ ok: true, ignored: 'invalid json' });
  }

  if (
    process.env.ZAPI_INSTANCE_ID &&
    body.instanceId &&
    body.instanceId !== process.env.ZAPI_INSTANCE_ID
  ) {
    return NextResponse.json({ error: 'instance mismatch' }, { status: 401 });
  }
  const text = body.text?.message?.trim();
  if (
    !body.isGroup ||
    body.fromMe ||
    body.isNewsletter ||
    !text ||
    !body.phone ||
    !body.messageId
  ) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  after(async () => {
    try {
      await handle(body, text);
    } catch (e) {
      console.error('[grupos] falha ao processar', e);
    }
  });
  return NextResponse.json({ ok: true });
}

async function handle(m: ZapiInbound, text: string) {
  const db = admin();
  const groupJid = m.phone!;
  const sender = m.participantPhone || m.participantLid || null;
  const senderName = m.senderName || sender || 'alguém';
  const reply = (msg: string) => sendGroupText(groupJid, msg, m.messageId);

  // Grupo: registra na primeira mensagem, mantém o nome atualizado.
  const { data: group } = await db
    .from('whatsapp_groups')
    .upsert(
      { group_jid: groupJid, name: m.chatName ?? null },
      { onConflict: 'group_jid' }
    )
    .select('id, account_id, active')
    .single();
  if (!group || group.active === false) return;

  // 1) Resposta a um plano pendente de QUEM PEDIU (não precisa marcar de novo).
  if (sender && (isConfirm(text) || isCancel(text))) {
    const desde = new Date(
      Date.now() - CONFIRM_WINDOW_MIN * 60_000
    ).toISOString();
    const { data: pend } = await db
      .from('group_agent_requests')
      .select('id, account_id, plan')
      .eq('group_id', group.id)
      .eq('requester_phone', sender)
      .eq('status', 'awaiting_confirmation')
      .gte('created_at', desde)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pend) {
      if (isCancel(text)) {
        await db
          .from('group_agent_requests')
          .update({ status: 'cancelled', decided_at: new Date().toISOString() })
          .eq('id', pend.id);
        await reply('Combinado, cancelei. Nada foi feito.');
        return;
      }
      // Trava contra duplo "ok": só quem virar o status executa.
      const { data: claimed } = await db
        .from('group_agent_requests')
        .update({ status: 'executing', decided_at: new Date().toISOString() })
        .eq('id', pend.id)
        .eq('status', 'awaiting_confirmation')
        .select('id')
        .maybeSingle();
      if (!claimed) return;
      const results = await executePlan(
        db,
        pend.account_id,
        (pend.plan ?? []) as GroupAction[]
      );
      const okAll = results.every((r) => r.ok);
      await db
        .from('group_agent_requests')
        .update({ status: okAll ? 'done' : 'failed', result: results })
        .eq('id', pend.id);
      await reply(
        `${okAll ? 'Feito ✅' : 'Fiz o que deu, veja abaixo:'}\n\n${results.map((r) => `${r.ok ? '✅' : '⚠️'} ${r.texto}`).join('\n')}`
      );
      return;
    }
  }

  // 2) Daqui pra frente, só quando o agente é marcado.
  const botIds = [
    process.env.ZAPI_BOT_PHONE,
    process.env.ZAPI_BOT_LID,
    m.connectedPhone,
  ];
  if (!isMention(text, botIds)) return;

  const pedido = stripMentions(text);
  const { data: req, error: dupErr } = await db
    .from('group_agent_requests')
    .insert({
      group_id: group.id,
      account_id: group.account_id,
      message_id: m.messageId,
      requester_phone: sender,
      requester_name: senderName,
      request_text: pedido || text,
      status: 'answered',
    })
    .select('id')
    .single();
  if (dupErr || !req) return; // reentrega do mesmo message_id
  const finish = (patch: Record<string, unknown>) =>
    db.from('group_agent_requests').update(patch).eq('id', req.id);

  // 3) Código de vínculo.
  const code = extractLinkCode(text);
  if (code) {
    const { data: lc } = await db
      .from('group_link_codes')
      .select('code, account_id, expires_at, used_at, accounts(name)')
      .eq('code', code)
      .maybeSingle();
    if (!lc || lc.used_at || new Date(lc.expires_at) < new Date()) {
      await reply(
        'Esse código não vale (expirou ou já foi usado). Gere um novo em Configurações → Agente no grupo.'
      );
      return;
    }
    if (group.account_id && group.account_id !== lc.account_id) {
      await reply(
        'Este grupo já está ligado a outra conta. Para trocar, um admin precisa desligar o grupo no CRM antes.'
      );
      return;
    }
    await db
      .from('whatsapp_groups')
      .update({
        account_id: lc.account_id,
        linked_at: new Date().toISOString(),
        linked_by_phone: sender,
      })
      .eq('id', group.id);
    await db
      .from('group_link_codes')
      .update({ used_at: new Date().toISOString(), used_by_group: group.id })
      .eq('code', code);
    await finish({ account_id: lc.account_id });
    const nome = (lc.accounts as { name?: string } | null)?.name ?? 'a conta';
    await reply(
      `Pronto! Este grupo agora está ligado a *${nome}*. É só me marcar com o pedido, por exemplo: "@Assistente cria a tag Cliente VIP".`
    );
    return;
  }

  // 4) Grupo ainda sem conta.
  if (!group.account_id) {
    await finish({ status: 'not_linked' });
    await reply(
      'Ainda não sei de qual conta do CRM é este grupo. Um admin da conta gera um código em *Configurações → Agente no grupo* e manda aqui me marcando: "@Assistente VINCULAR-XXXXXX".'
    );
    return;
  }

  // 5) Planeja.
  try {
    const contexto = await accountContext(db, group.account_id);
    const out = await planRequest({ pedido, contexto, quemPediu: senderName });
    const uso = { tokens_in: out.tokens_in, tokens_out: out.tokens_out };
    if (out.kind === 'answer') {
      await finish({ status: 'answered', summary: out.texto, result: uso });
      await reply(out.texto);
      return;
    }
    const { acoes, erros } = validatePlan(
      out.acoes,
      MODELOS.map((x) => x.id)
    );
    if (acoes.length === 0) {
      await finish({
        status: 'answered',
        summary: out.resumo,
        result: { ...uso, erros },
      });
      await reply(
        `Entendi o pedido, mas não consegui montar algo que eu possa executar${erros.length ? `: ${erros.map((e) => e.erro).join('; ')}` : ''}. Pode detalhar?`
      );
      return;
    }
    // Um plano novo substitui o anterior ainda pendente da mesma pessoa.
    if (sender) {
      await db
        .from('group_agent_requests')
        .update({ status: 'cancelled', decided_at: new Date().toISOString() })
        .eq('group_id', group.id)
        .eq('requester_phone', sender)
        .eq('status', 'awaiting_confirmation');
    }
    await finish({
      status: 'awaiting_confirmation',
      plan: acoes,
      summary: out.resumo,
      result: { ...uso, erros },
    });
    const nomeModelo = (id: string) =>
      MODELOS.find((x) => x.id === id)?.nome ?? id;
    await reply(
      [
        out.resumo
          ? `Entendi: ${out.resumo}`
          : 'Entendi. Vou fazer o seguinte:',
        '',
        describePlan(acoes, nomeModelo),
        erros.length
          ? `\nFica de fora: ${erros.map((e) => e.erro).join('; ')}.`
          : '',
        '',
        `*${senderName}*, responda *ok* para eu fazer ou *cancelar*. (vale por ${CONFIRM_WINDOW_MIN} min)`,
      ]
        .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
        .join('\n')
    );
  } catch (e) {
    await finish({
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
    });
    await reply(
      'Tive um problema para entender o pedido agora. A equipe 3R já foi avisada pelo registro; pode tentar de novo em alguns minutos.'
    );
  }
}
