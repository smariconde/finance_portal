import type { AppMode } from "@/modules/configuration/domain/config-health";
import { selectPersonalDependency } from "@/modules/configuration/domain/runtime-lock";

import type {
  CatalogPlan,
  SeriesBasis,
  SeriesDefinition,
} from "../domain/series-definition";
import type {
  MacroSeries,
  SeriesObservation,
} from "../domain/series-observation";

/** Techo de definiciones por fuente: 1.610 variables vigentes más su historia. */
export const MAX_DEFINITIONS_PER_SOURCE = 20_000;
/** Techo de revisiones por serie: el CER completo son 9.053 puntos. */
export const MAX_OBSERVATIONS_PER_SERIES = 60_000;

export type ObservationWrite = {
  readonly seriesKey: string;
  /** La base de la definición vigente; se fija si la serie todavía no tenía. */
  readonly basis: SeriesBasis;
  /** Revisiones nuevas, cada una con el número siguiente a la que supersede. */
  readonly revisions: readonly SeriesObservation[];
};

export interface MacroSeriesRepository {
  readonly storage: "in-memory-fixture" | "personal-postgres";
  /** Las definiciones vigentes de una fuente: contra ellas se planea el catálogo. */
  listOpenDefinitions(sourceId: string): Promise<readonly SeriesDefinition[]>;
  /** Todas las versiones de la definición de una serie: la lectura al corte filtra. */
  listSeriesDefinitions(
    seriesKey: string,
  ): Promise<readonly SeriesDefinition[]>;
  /**
   * Abre, supersede y cierra definiciones en una transacción. Si una vigente ya
   * no es la que el plan vio, aborta: otro proceso escribió en el medio.
   */
  applyCatalogPlan(plan: CatalogPlan): Promise<void>;
  findSeries(seriesKey: string): Promise<MacroSeries | null>;
  /** Revisiones vigentes de la serie, desde una fecha si hay ventana. */
  listOpenObservations(
    seriesKey: string,
    fromPeriodOn: string | null,
  ): Promise<readonly SeriesObservation[]>;
  /** Todas las revisiones de la serie, vigentes o no. */
  listObservations(seriesKey: string): Promise<readonly SeriesObservation[]>;
  /**
   * Escribe las revisiones y supersede, en la observación, la vigente de cada
   * fecha que revisan. Una vigente que ya no es la que el plan vio aborta la
   * transacción entera, y la base fijada de otra forma también.
   */
  applyObservations(write: ObservationWrite): Promise<void>;
}

export function selectMacroSeriesRepository(
  mode: AppMode,
  factories: { personal: () => MacroSeriesRepository },
): MacroSeriesRepository {
  return selectPersonalDependency(
    mode,
    "macro-series-repository",
    factories.personal,
  );
}
