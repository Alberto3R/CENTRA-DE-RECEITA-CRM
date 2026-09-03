import { describe, expect, it } from "vitest";

import { buildDealRows, dealTitle } from "./bulk-create";

const base = {
  pipelineId: "pipe-1",
  stageId: "stage-1",
  accountId: "acc-1",
  userId: "user-1",
};

describe("dealTitle", () => {
  it("usa o nome do contato", () => {
    expect(dealTitle({ id: "1", name: "Maria Silva" })).toBe("Maria Silva");
  });

  it("cai no telefone quando o contato veio sem nome", () => {
    expect(dealTitle({ id: "1", name: "  ", phone: "5511999998888" })).toBe(
      "5511999998888",
    );
  });

  it("tem reserva para contato sem nome e sem telefone", () => {
    expect(dealTitle({ id: "1" })).toBe("Contato sem nome");
  });

  it("aplica o prefixo da leva", () => {
    expect(dealTitle({ id: "1", name: "Maria" }, " Setembro ")).toBe(
      "Setembro — Maria",
    );
  });
});

describe("buildDealRows", () => {
  it("monta uma linha por contato com os campos do funil", () => {
    const { rows, skipped } = buildDealRows(
      [
        { id: "c1", name: "Maria" },
        { id: "c2", name: "João" },
      ],
      { ...base, assignedTo: "seller-9", value: 2500, currency: "BRL" },
    );

    expect(skipped).toBe(0);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      user_id: "user-1",
      account_id: "acc-1",
      pipeline_id: "pipe-1",
      stage_id: "stage-1",
      contact_id: "c1",
      title: "Maria",
      value: 2500,
      currency: "BRL",
      assigned_to: "seller-9",
      status: "open",
    });
  });

  it("pula quem já tem negócio no funil", () => {
    const { rows, skipped } = buildDealRows(
      [
        { id: "c1", name: "Maria" },
        { id: "c2", name: "João" },
      ],
      base,
      new Set(["c1"]),
    );

    expect(skipped).toBe(1);
    expect(rows.map((r) => r.contact_id)).toEqual(["c2"]);
  });

  it("pula repetição dentro da própria lista", () => {
    const { rows, skipped } = buildDealRows(
      [
        { id: "c1", name: "Maria" },
        { id: "c1", name: "Maria" },
      ],
      base,
    );

    expect(skipped).toBe(1);
    expect(rows).toHaveLength(1);
  });

  it("assume valor 0, moeda BRL e sem responsável quando não informados", () => {
    const { rows } = buildDealRows([{ id: "c1", name: "Maria" }], base);

    expect(rows[0].value).toBe(0);
    expect(rows[0].currency).toBe("BRL");
    expect(rows[0].assigned_to).toBeNull();
  });
});
