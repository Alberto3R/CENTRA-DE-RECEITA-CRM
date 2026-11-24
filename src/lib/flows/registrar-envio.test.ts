import { describe, expect, it } from "vitest";
import { montarMensagemDeTemplate, registrarTemplateNaConversa, renderizarCorpo } from "./registrar-envio";

describe("renderizarCorpo", () => {
  it("troca os {{n}} pelos parâmetros", () => {
    expect(renderizarCorpo("Oi, {{1}}! Sua inscrição está confirmada.", ["Ana"])).toBe(
      "Oi, Ana! Sua inscrição está confirmada.",
    );
  });
  it("parâmetro que falta vira vazio, sem deixar {{2}} no balão", () => {
    expect(renderizarCorpo("{{1}} · {{2}}", ["Ana"])).toBe("Ana · ");
  });
  it("sem corpo devolve null", () => {
    expect(renderizarCorpo(null, ["Ana"])).toBeNull();
    expect(renderizarCorpo(undefined, [])).toBeNull();
  });
});

describe("montarMensagemDeTemplate", () => {
  it("grava como template do bot com o id da Meta", () => {
    expect(
      montarMensagemDeTemplate({
        conversationId: "c1",
        templateName: "eqv_inscricao_aula_confirmada",
        bodyText: "Oi, {{1}}!",
        params: ["Ana"],
        waMessageId: "wamid.X",
      }),
    ).toEqual({
      conversation_id: "c1",
      sender_type: "bot",
      content_type: "template",
      content_text: "Oi, Ana!",
      template_name: "eqv_inscricao_aula_confirmada",
      message_id: "wamid.X",
      status: "sent",
    });
  });
});

// Cliente falso mínimo: registra inserts/updates e devolve as linhas que o
// teste preparou para cada tabela.
function fakeDb(conversas: { id: string; channel_id: string | null }[]) {
  const inserts: { table: string; row: unknown }[] = [];
  const updates: { table: string; row: unknown }[] = [];
  const db = {
    from(table: string) {
      const filtros: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (col: string, v: unknown) => {
          filtros[col] = v;
          return q;
        },
        order: () => q,
        limit: () => q,
        maybeSingle: async () => {
          if (table === "accounts") return { data: { owner_user_id: "dono" } };
          const c = conversas.find((x) => !("channel_id" in filtros) || x.channel_id === filtros.channel_id);
          return { data: c ? { id: c.id } : null };
        },
        insert: (row: unknown) => {
          inserts.push({ table, row });
          return {
            select: () => ({ single: async () => ({ data: { id: "nova" } }) }),
            then: (r: (v: { error: null }) => void) => r({ error: null }),
          };
        },
        update: (row: unknown) => {
          updates.push({ table, row });
          return { eq: async () => ({ error: null }) };
        },
      };
      return q;
    },
  };
  return { db, inserts, updates };
}

const base = {
  accountId: "a",
  contactId: "ct",
  channelId: "ch",
  templateName: "eqv_inscricao_aula_confirmada",
  bodyText: "Oi, {{1}}!",
  params: ["Ana"],
  waMessageId: "wamid.X",
};

describe("registrarTemplateNaConversa", () => {
  it("usa a conversa do contato no canal", async () => {
    const { db, inserts, updates } = fakeDb([{ id: "conv1", channel_id: "ch" }]);
    const r = await registrarTemplateNaConversa(db, base);
    expect(r).toEqual({ ok: true, conversationId: "conv1" });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ table: "messages", row: { conversation_id: "conv1", message_id: "wamid.X" } });
    expect(updates[0]).toMatchObject({ table: "conversations", row: { last_message_text: "Oi, Ana!" } });
  });

  it("cai para qualquer conversa do contato quando não há uma no canal", async () => {
    const { db, inserts } = fakeDb([{ id: "antiga", channel_id: null }]);
    const r = await registrarTemplateNaConversa(db, base);
    expect(r).toEqual({ ok: true, conversationId: "antiga" });
    expect(inserts.map((i) => i.table)).toEqual(["messages"]);
  });

  it("cria a conversa quando o contato não tem nenhuma", async () => {
    const { db, inserts } = fakeDb([]);
    const r = await registrarTemplateNaConversa(db, base);
    expect(r).toEqual({ ok: true, conversationId: "nova" });
    expect(inserts.map((i) => i.table)).toEqual(["conversations", "messages"]);
    expect(inserts[0].row).toMatchObject({ account_id: "a", user_id: "dono", contact_id: "ct", channel_id: "ch" });
  });
});
