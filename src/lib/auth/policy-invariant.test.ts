/**
 * Invariante que sustenta a impersonation somente-leitura.
 *
 * A migration 084 concede leitura ao platform admin com esta cláusula:
 *
 *     min_role = 'viewer' AND target_account_id = current_impersonation()
 *
 * Ela só é segura porque NENHUMA policy de escrita usa o `min_role`
 * default (`viewer`). Toda INSERT/UPDATE/DELETE passa 'agent' ou
 * 'admin', e por isso a cláusula é FALSE para elas.
 *
 * Isso é uma convenção — e convenção quebra em silêncio. Uma policy
 * nova escrita como `FOR UPDATE USING (is_account_member(account_id))`
 * abriria escrita cross-tenant para o admin de plataforma sem nenhum
 * sinal: o código compila, os testes passam, a tela funciona.
 *
 * Este teste lê os .sql do repositório e reprova esse caso no PR, antes
 * de a migration chegar em qualquer banco. Sem precisar de conexão.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/** Operações em que conceder acesso significa permitir escrita. */
const WRITE_OPS = new Set(["INSERT", "UPDATE", "DELETE", "ALL"]);

interface Policy {
  name: string;
  table: string;
  operation: string;
  body: string;
  file: string;
}

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * Reproduz CREATE/DROP POLICY na ordem das migrations e devolve as
 * policies que sobrevivem.
 *
 * O replay importa: a 001 criou policies `FOR ALL` que a 017 dropou.
 * Sem reproduzir os DROPs, o teste reprovaria por causa de SQL que já
 * não está em vigor.
 */
function effectivePolicies(): Map<string, Policy> {
  const live = new Map<string, Policy>();

  for (const file of migrationFiles()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");

    // Uma varredura só, preservando a ordem relativa de CREATE e DROP
    // dentro do arquivo — a 001 dropa e recria a mesma policy.
    const stmt =
      /(CREATE|DROP)\s+POLICY\s+(?:IF\s+EXISTS\s+)?("[^"]+"|[\w]+)\s+ON\s+([\w.]+)([^;]*);/gi;

    let m: RegExpExecArray | null;
    while ((m = stmt.exec(sql)) !== null) {
      const [, verb, rawName, table, rest] = m;
      const name = rawName.replace(/"/g, "");
      const key = `${table.toLowerCase()}.${name.toLowerCase()}`;

      if (verb.toUpperCase() === "DROP") {
        live.delete(key);
        continue;
      }

      const forMatch = /\bFOR\s+(SELECT|INSERT|UPDATE|DELETE|ALL)\b/i.exec(rest);
      live.set(key, {
        name,
        table,
        // Sem cláusula FOR, o Postgres assume ALL — o caso mais permissivo.
        operation: (forMatch?.[1] ?? "ALL").toUpperCase(),
        body: rest,
        file,
      });
    }
  }

  return live;
}

/**
 * Extrai as chamadas a is_account_member de um trecho de SQL e diz
 * quantos argumentos cada uma recebeu.
 */
function isAccountMemberCalls(body: string): { argCount: number }[] {
  const calls: { argCount: number }[] = [];
  const needle = "is_account_member(";
  let idx = body.toLowerCase().indexOf(needle);

  while (idx !== -1) {
    // Percorre até fechar os parênteses, contando vírgulas no nível 0.
    let depth = 0;
    let commas = 0;
    let hasContent = false;
    let i = idx + needle.length - 1;

    for (; i < body.length; i++) {
      const c = body[i];
      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) break;
      } else if (c === "," && depth === 1) commas++;
      else if (depth === 1 && c.trim() !== "") hasContent = true;
    }

    calls.push({ argCount: hasContent ? commas + 1 : 0 });
    idx = body.toLowerCase().indexOf(needle, i);
  }

  return calls;
}

describe("invariante das policies de RLS", () => {
  const policies = [...effectivePolicies().values()];

  it("encontra as policies do schema (guarda contra parser quebrado)", () => {
    // Se o parser parar de casar, todos os testes abaixo passariam por
    // vacuidade — que é o pior desfecho possível para um teste de
    // segurança. Este piso garante que ele está lendo de verdade.
    expect(policies.length).toBeGreaterThan(100);
    expect(
      policies.filter((p) => isAccountMemberCalls(p.body).length > 0).length,
    ).toBeGreaterThan(100);
  });

  it("nenhuma policy de escrita usa o min_role default", () => {
    const violations = policies
      .filter((p) => WRITE_OPS.has(p.operation))
      .filter((p) =>
        isAccountMemberCalls(p.body).some((c) => c.argCount === 1),
      )
      .map(
        (p) =>
          `${p.file}: policy "${p.name}" em ${p.table} (FOR ${p.operation}) ` +
          `chama is_account_member(account_id) sem min_role — isso concederia ` +
          `ESCRITA a um platform admin impersonando. Passe 'agent' ou 'admin'.`,
      );

    expect(violations).toEqual([]);
  });

  it("as policies de leitura usam o default, senão a impersonation não lê nada", () => {
    // O outro lado da moeda: se as de SELECT passassem 'agent', a
    // cláusula `min_role = 'viewer'` nunca casaria e o painel abriria
    // vazio. Falha barulhenta é melhor que painel misteriosamente vazio.
    const selects = policies.filter((p) => p.operation === "SELECT");
    const withCalls = selects.filter(
      (p) => isAccountMemberCalls(p.body).length > 0,
    );
    expect(withCalls.length).toBeGreaterThan(20);

    const defaulted = withCalls.filter((p) =>
      isAccountMemberCalls(p.body).some((c) => c.argCount === 1),
    );
    // Nem toda SELECT precisa ser legível na impersonation (convites de
    // conta, por exemplo, exigem 'admin' de propósito), mas a maioria sim.
    expect(defaulted.length).toBeGreaterThan(withCalls.length / 2);
  });
});

describe("migration 084 — a cláusula de impersonation", () => {
  const sql = readFileSync(
    join(MIGRATIONS_DIR, "084_platform_admin_impersonation.sql"),
    "utf8",
  );

  it("restringe a impersonation a min_role = 'viewer'", () => {
    // Tirar esta condição transformaria a impersonation em acesso de
    // escrita a todos os tenants. É a linha mais sensível do schema.
    expect(sql).toMatch(/min_role\s*=\s*'viewer'/);
    expect(sql).toMatch(/target_account_id\s*=\s*current_impersonation\(\)/);
  });

  it("preserva a checagem de membro original", () => {
    // A cláusula nova é um OR ADICIONADO — se o EXISTS sobre profiles
    // sumisse, usuários comuns perderiam acesso à própria conta.
    expect(sql).toMatch(/FROM\s+profiles\s+p/i);
    expect(sql).toMatch(/p\.user_id\s*=\s*auth\.uid\(\)/);
  });

  it("mantém as tabelas de plataforma sem policy alguma", () => {
    // RLS ligado + zero policies = inalcançável pelo papel `authenticated`.
    // Uma policy adicionada aqui exporia quem é admin, ou pior, deixaria
    // alguém se autopromover.
    expect(sql).toMatch(/ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(
      /ALTER TABLE impersonation_sessions ENABLE ROW LEVEL SECURITY/,
    );
    expect(sql).not.toMatch(/CREATE POLICY[\s\S]*ON platform_admins/);
    expect(sql).not.toMatch(/CREATE POLICY[\s\S]*ON impersonation_sessions/);
  });
});
