import { describe, expect, it } from "vitest";

import { emLotes } from "./booking-sync";

describe("emLotes", () => {
  it("divide no tamanho pedido, com o resto no último lote", () => {
    expect(emLotes([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("lista vazia não gera lote (nenhuma consulta)", () => {
    expect(emLotes([], 100)).toEqual([]);
  });
  it("355 eventos viram 4 consultas de até 100", () => {
    const lotes = emLotes(Array.from({ length: 355 }, (_, i) => `ev${i}`), 100);
    expect(lotes.map((l) => l.length)).toEqual([100, 100, 100, 55]);
  });
});
