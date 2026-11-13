/**
 * Schema de la base de trading
 * ([ADR 0076](../../../../docs/architecture/adr/0076-schwab-read-only-account-trading-journal.md)).
 *
 * Vive aparte del de análisis (`src/server/db/schema.ts`) y migra a su propia
 * carpeta, `drizzle-trading/`, con `pnpm db:trading:generate`. Ninguna tabla
 * cruza las dos bases: cruzar una posición con su valuación se hace en la
 * aplicación.
 *
 * `F11-02` sólo crea la base y el rol de runtime (migración `0000`, escrita a
 * mano). Las tablas llegan con lo que las usa, desde `F11-03`.
 */
export {};
