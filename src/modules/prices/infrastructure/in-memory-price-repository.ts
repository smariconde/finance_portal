import type {
  PriceRepository,
  PriceSeriesQuery,
  PriceWriteSummary,
} from "../application/price-repository";
import { priceSeriesQuerySchema } from "../application/price-repository";
import type { DailyClose, PriceEvent } from "../domain/daily-close";

/**
 * Doble de test, no un modo de runtime. Ningún composition root lo construye.
 *
 * Corre el **mismo contrato** que el adaptador de PostgreSQL, incluida la regla
 * que define la ingesta: una fila cruda es inmutable, así que una rueda que ya
 * existe con otro cierre se reporta y no se pisa.
 */
export class InMemoryPriceRepository implements PriceRepository {
  readonly storage = "in-memory-fixture" as const;

  private readonly closes = new Map<string, DailyClose>();
  private readonly events = new Map<string, PriceEvent>();

  private static closeKey(securityId: string, marketDate: string): string {
    return `${securityId}|${marketDate}`;
  }

  private static eventKey(event: PriceEvent): string {
    return `${event.securityId}|${event.eventType}|${event.effectiveOn}`;
  }

  async loadSeries(query: PriceSeriesQuery): Promise<readonly DailyClose[]> {
    const { securityId, limit } = priceSeriesQuerySchema.parse(query);
    const matches = [...this.closes.values()]
      .filter((close) => close.securityId === securityId)
      .sort((left, right) => (left.marketDate < right.marketDate ? -1 : 1));

    if (matches.length > limit) {
      throw new Error(
        `price series read exceeded its limit of ${limit} rows for ${securityId}`,
      );
    }

    return matches;
  }

  /**
   * El doble no guarda la corrida: lo que el contrato afirma es qué filas se
   * publican y cuáles se reconocen, y eso no depende de quién las respalde. El
   * adaptador de PostgreSQL sí la escribe, porque ahí la corrida es la que
   * aporta fuente, dataset y parser a cada fila.
   */
  async writeSeries(
    closes: readonly DailyClose[],
    events: readonly PriceEvent[],
  ): Promise<PriceWriteSummary> {
    let closesInserted = 0;
    let closesDuplicate = 0;
    const closesConflicting: string[] = [];

    for (const close of closes) {
      const key = InMemoryPriceRepository.closeKey(
        close.securityId,
        close.marketDate,
      );
      const existing = this.closes.get(key);

      if (existing === undefined) {
        this.closes.set(key, close);
        closesInserted += 1;
        continue;
      }

      if (existing.close === close.close) {
        closesDuplicate += 1;
        continue;
      }

      closesConflicting.push(close.marketDate);
    }

    let eventsInserted = 0;
    let eventsDuplicate = 0;

    for (const event of events) {
      const key = InMemoryPriceRepository.eventKey(event);

      if (this.events.has(key)) {
        eventsDuplicate += 1;
        continue;
      }

      this.events.set(key, event);
      eventsInserted += 1;
    }

    return {
      securityId: closes[0]?.securityId ?? events[0]?.securityId ?? "",
      closesInserted,
      closesDuplicate,
      closesConflicting,
      eventsInserted,
      eventsDuplicate,
    };
  }
}
