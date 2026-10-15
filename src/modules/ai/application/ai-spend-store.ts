import type { AppMode } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";
import type {
  AiSpendDayState,
  AiSpendEntry,
  AiSpendReservationRequest,
  AiSpendSettlement,
  AiSpendVerdict,
} from "@/modules/ai/domain/ai-spend";

/**
 * Libro de gasto en dólares de la capa IA (ADR 0033, decisión 4).
 *
 * `reserve` es el único punto donde se compromete gasto, y decide **dentro** de
 * una transacción: lee lo gastado por la tarea y por el día, compara con los
 * topes y, si entra, deja la reserva escrita. Dos procesos no pueden pasarse del
 * tope porque PostgreSQL serializa las reservas de una fuente con un lock
 * consultivo; el doble en memoria lo hace por construcción.
 *
 * `settle` cierra una reserva una sola vez. Lo que cuenta contra el tope es lo
 * cobrado si se conoce y el peor caso si no (`countedNanoUsd`).
 */
export interface AiSpendStore {
  readonly storage: "in-memory-fixture" | "personal-postgres";
  reserve(request: AiSpendReservationRequest): Promise<AiSpendVerdict>;
  /** Lanza si la reserva no existe o ya se cerró: una liquidación no se pisa. */
  settle(settlement: AiSpendSettlement): Promise<AiSpendEntry>;
  readDay(sourceId: string, now: string): Promise<AiSpendDayState>;
  /** Intentos de una tarea, en el orden en que se reservaron. */
  listTaskAttempts(taskRunId: string): Promise<AiSpendEntry[]>;
}

export class AiSpendSettlementError extends Error {
  readonly reservationId: string;

  constructor(reservationId: string, problem: "unknown" | "already_settled") {
    super(
      problem === "unknown"
        ? `There is no spend reservation ${reservationId}.`
        : `The spend reservation ${reservationId} is already settled.`,
    );
    this.name = "AiSpendSettlementError";
    this.reservationId = reservationId;
  }
}

export function selectAiSpendStore(
  mode: AppMode,
  factories: { personal: () => AiSpendStore },
): AiSpendStore {
  return selectPersonalDependency(mode, "ai-spend", factories.personal);
}
