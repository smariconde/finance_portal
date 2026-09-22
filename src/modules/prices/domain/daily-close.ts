import { z } from "zod";

import { calendarDateSchema } from "@/modules/temporal/domain/temporal-version";

/**
 * Un cierre diario **crudo**: el precio tal como se operó ese día, sin ajustar
 * por ningún evento posterior
 * ([ADR 0026](../../../../docs/architecture/adr/0026-daily-prices-source.md)).
 *
 * Que sea crudo es la decisión, no un detalle. La serie que publica la fuente se
 * **reescribe hacia atrás en cada split**: medido sobre NVDA, el cierre del
 * 2024-06-05 se devuelve hoy como 122,44 cuando ese día se operó a 1.224,40,
 * porque la serie viene dividida por el 10:1 del 2024-06-10. Guardar eso metería
 * look-ahead en la base —lo que el contrato point-in-time existe para impedir— y
 * además haría que una fila guardada hoy dejara de coincidir con la misma fila
 * re-descargada mañana, perdiendo la idempotencia de la ingesta.
 *
 * Guardando crudo, la fila es **inmutable**: un split futuro no la toca, porque
 * el crudo es lo que pasó. El ajuste vuelve a ser una decisión de lectura con
 * base declarada, igual que en la
 * [ADR 0012](../../../../docs/architecture/adr/0012-stock-splits-share-basis.md).
 *
 * La fila no guarda apertura, máximo, mínimo ni volumen: el criterio de la
 * [ADR 0018](../../../../docs/architecture/adr/0018-lighter-observation-rows.md)
 * es guardar lo que no se puede reconstruir **y se usa**, y lo que las matrices
 * y las divergencias piden es cierre contra cierre.
 */
export const dailyCloseSchema = z.object({
  securityId: z.uuid(),
  /** Fecha de mercado, no instante: una rueda es un día en su propia zona. */
  marketDate: calendarDateSchema,
  /**
   * Cierre crudo. Se guarda como string decimal para no pasar por un `double`:
   * un precio que round-trips por punto flotante es un valor inventado, que es
   * la misma razón por la que el corpus congelado conserva el texto fuente.
   */
  close: z
    .string()
    .trim()
    .regex(/^[0-9]+(?:\.[0-9]+)?$/u, "A raw close is a non-negative decimal."),
  currency: z.string().trim().length(3).toUpperCase(),
});

export type DailyClose = z.infer<typeof dailyCloseSchema>;

/**
 * Un evento de la serie, fechado y **no aplicado**.
 *
 * Los splits se guardan porque son la base de ajuste de las lecturas y la
 * evidencia de cómo se des-ajustó la serie al ingerirla. Los dividendos se
 * guardan porque la base de retorno de las matrices —con dividendos
 * reinvertidos o sólo precio— es un parámetro abierto de `F7-04`, y aplicarlos
 * en la ingesta lo dejaría decidido a espaldas de quien lo tiene que decidir.
 */
export const priceEventTypeSchema = z.enum(["split", "dividend"]);

export type PriceEventType = z.infer<typeof priceEventTypeSchema>;

export const priceEventSchema = z
  .object({
    securityId: z.uuid(),
    eventType: priceEventTypeSchema,
    /** Fecha efectiva del evento según la fuente. */
    effectiveOn: calendarDateSchema,
    /**
     * Para un split, el ratio como decimal (`10` en un 10:1, `0.125` en un 1:8).
     * Para un dividendo, el importe por acción en la moneda de la serie.
     */
    value: z
      .string()
      .trim()
      .regex(
        /^[0-9]+(?:\.[0-9]+)?$/u,
        "An event value is a non-negative decimal.",
      ),
    currency: z.string().trim().length(3).toUpperCase().nullable(),
  })
  .superRefine((event, context) => {
    if (event.eventType === "split" && Number(event.value) <= 0) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "A split ratio must be greater than zero.",
      });
    }

    if (event.eventType === "dividend" && event.currency === null) {
      context.addIssue({
        code: "custom",
        path: ["currency"],
        message: "A dividend is an amount and needs its currency.",
      });
    }
  });

export type PriceEvent = z.infer<typeof priceEventSchema>;
