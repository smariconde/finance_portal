import { readFileSync } from "node:fs";

import postgres from "postgres";

/**
 * Compara el journal versionado con las migraciones aplicadas en la base de
 * `DATABASE_DIRECT_URL`, sin escribir nada. Sale con código 1 si falta alguna:
 * un merge a `main` despliega Production, y un código que espera columnas que
 * Neon no tiene rompe cada escritura (lo que pasó el 2026-10-30).
 */
type JournalEntry = {
  readonly idx: number;
  readonly tag: string;
  readonly when: number;
};

const directUrl = process.env.DATABASE_DIRECT_URL?.trim();

if (!directUrl) {
  throw new Error("DATABASE_DIRECT_URL is required to read migration status.");
}

const journal = JSON.parse(
  readFileSync("drizzle/meta/_journal.json", "utf8"),
) as { readonly entries: readonly JournalEntry[] };

const client = postgres(directUrl, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
  idle_timeout: 20,
});

try {
  // El migrador de Drizzle guarda el `when` del journal en `created_at`.
  const rows = await client<{ created_at: string }[]>`
    select created_at::text as created_at from drizzle.__drizzle_migrations
  `;
  const applied = new Set(rows.map((row) => Number(row.created_at)));
  const pending = journal.entries.filter((entry) => !applied.has(entry.when));

  console.log(
    `Aplicadas ${journal.entries.length - pending.length} de ${journal.entries.length}.`,
  );

  if (pending.length > 0) {
    console.log("Pendientes:");
    for (const entry of pending) console.log(`  ${entry.tag}`);
    process.exitCode = 1;
  }
} finally {
  await client.end();
}
