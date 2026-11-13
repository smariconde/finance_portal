import { existsSync, readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * La cadena de `drizzle-trading/` nace con rollback por migración (ADR 0076):
 * cada entrada del journal tiene su `.sql` y su `rollback/<tag>.down.sql`, y no
 * hay archivos sueltos que el migrador ignoraría.
 */
const FOLDER = "drizzle-trading";
const journal = JSON.parse(
  readFileSync(`${FOLDER}/meta/_journal.json`, "utf8"),
) as { entries: { idx: number; tag: string }[] };

describe("drizzle-trading", () => {
  it("pairs every migration with its rollback", () => {
    for (const { tag } of journal.entries) {
      expect(existsSync(`${FOLDER}/${tag}.sql`), tag).toBe(true);
      expect(existsSync(`${FOLDER}/rollback/${tag}.down.sql`), tag).toBe(true);
    }
  });

  it("has no migration or rollback outside the journal", () => {
    const tags = journal.entries.map((entry) => entry.tag).sort();
    const migrations = readdirSync(FOLDER)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => name.replace(/\.sql$/, ""))
      .sort();
    const rollbacks = readdirSync(`${FOLDER}/rollback`)
      .map((name) => name.replace(/\.down\.sql$/, ""))
      .sort();

    expect(migrations).toEqual(tags);
    expect(rollbacks).toEqual(tags);
  });

  it("keeps the runtime role off the analysis chain", () => {
    // El rol de trading no tiene nada que hacer en la base de análisis.
    for (const name of readdirSync("drizzle").filter((n) =>
      n.endsWith(".sql"),
    )) {
      expect(readFileSync(`drizzle/${name}`, "utf8"), name).not.toContain(
        "finance_portal_trading_runtime",
      );
    }
  });
});
