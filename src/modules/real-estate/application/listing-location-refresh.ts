import type { RequestPacingPolicy } from "@/modules/ingestion/application/egress-fetch";
import type { IngestionJobStore } from "@/modules/ingestion/application/ingestion-job-store";
import { checkSourceBudget } from "@/modules/ingestion/application/metered-egress-fetch";
import type {
  IngestionJobAdmission,
  IngestionJobExecutor,
} from "@/modules/ingestion/application/run-ingestion-job";
import type { SourceBudgetStore } from "@/modules/ingestion/application/source-budget-store";
import type { SourceSignal } from "@/modules/ingestion/application/source-signals";
import type {
  IngestionJob,
  IngestionJobAttemptOutcome,
} from "@/modules/ingestion/domain/ingestion-job";
import { SourceRequestRefusedError } from "@/modules/ingestion/domain/source-budget";

import {
  BARRIOS_LAYER_ID,
  CORDOBA_BARRIOS_PARSER_VERSION,
} from "../domain/cordoba-barrios";
import {
  GEOREF_DATASET,
  GEOREF_MAX_BATCH,
  GEOREF_PARSER_VERSION,
  type GeorefQuery,
} from "../domain/georef-addresses";
import {
  IDECOR_WFS_PARSER_VERSION,
  PARCELS_DATASET,
  ZONING_LAYER_ID,
  withBox,
} from "../domain/idecor-wfs";
import {
  locationInputHash,
  pendingLookups,
  resolveListingLocation,
  type LayerRelease,
} from "../domain/listing-location";
import { classifyDeclaredAddress } from "../domain/georef-addresses";
import { sharedPins } from "../domain/location-precision";
import {
  BARRIOS_SOURCE_ID,
  GEOREF_SOURCE_ID,
  IDECOR_SOURCE_ID,
  LocationSourceError,
  type LocationSources,
} from "./live-location-sources";
import type {
  LayerStatus,
  LocationLayerId,
  LocationRun,
  LocationState,
  LocationStore,
} from "./location-store";

/**
 * Pone al día la ubicación de los avisos al abrir `/inmuebles`
 * (`listing-location-refresh-1.0.0`, patrón de las ADR 0030 y 0070): el render
 * sólo lee, la Server Action planea lo pendiente como jobs durables por fuente
 * —bajo su lease, su cuota y su kill switch— y el worker corre después de la
 * respuesta. Lo pendiente es:
 *
 * - una capa sin release o bajada hace más de 30 días;
 * - una dirección con número que Georef no respondió (de a 1.000 por pedido);
 * - un punto que ubica parcela y que IDECOR no respondió (uno por pedido);
 * - un aviso cuya lectura leyó otra cosa (`locationInputHash`): eso se
 *   resuelve en código, sin red.
 *
 * Un sujeto que falló no se vuelve a planear solo: la página ofrece
 * «Reintentar», así ninguna visita insiste contra lo que la fuente rechaza.
 */
export const LOCATION_REFRESH_VERSION = "listing-location-refresh-1.0.0";
export const LOCATION_REFRESH_KIND = "real_estate_location_refresh";
export const LAYER_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Los puntos de una corrida: el tope diario de IDECOR es 600. */
export const MAX_POINTS_PER_JOB = 400;

/**
 * Un pedido por segundo a cada fuente: ninguna publica cuota y los términos
 * de IDECOR prohíben sobrecargarla. El techo del proceso cubre un job entero.
 */
export const LOCATION_REQUEST_PACING: RequestPacingPolicy = Object.freeze({
  minIntervalMs: 1000,
  maxRequests: MAX_POINTS_PER_JOB + 20,
});

export type LocationRefreshDataset = {
  readonly sourceId: string;
  readonly datasetId: string;
  readonly parserVersion: string;
  readonly label: string;
};

/** En el orden en que corren: las capas primero, Georef antes que IDECOR. */
export const LOCATION_REFRESH_DATASETS = [
  {
    sourceId: BARRIOS_SOURCE_ID,
    datasetId: BARRIOS_LAYER_ID,
    parserVersion: CORDOBA_BARRIOS_PARSER_VERSION,
    label: "Barrios (Municipalidad)",
  },
  {
    sourceId: IDECOR_SOURCE_ID,
    datasetId: ZONING_LAYER_ID,
    parserVersion: IDECOR_WFS_PARSER_VERSION,
    label: "Ocupación del Suelo (IDECOR)",
  },
  {
    sourceId: GEOREF_SOURCE_ID,
    datasetId: GEOREF_DATASET,
    parserVersion: GEOREF_PARSER_VERSION,
    label: "Direcciones (Georef)",
  },
  {
    sourceId: IDECOR_SOURCE_ID,
    datasetId: PARCELS_DATASET,
    parserVersion: IDECOR_WFS_PARSER_VERSION,
    label: "Parcelas (IDECOR)",
  },
] as const satisfies readonly LocationRefreshDataset[];

type DatasetId = (typeof LOCATION_REFRESH_DATASETS)[number]["datasetId"];

export function layerDue(
  status: LayerStatus<LocationLayerId>,
  now: string,
): boolean {
  return (
    status.release === null ||
    status.checkedAt === null ||
    Date.parse(now) - Date.parse(status.checkedAt) >= LAYER_MAX_AGE_MS
  );
}

/** Lo que falta preguntar, por dataset; sin red. */
export function pendingSubjects(input: {
  readonly state: LocationState;
  readonly barrios: LayerStatus<"cordoba.barrios">;
  readonly zoning: LayerStatus<"idecor.cba-ordenanza-8256">;
  readonly now: string;
}): Record<DatasetId, string[]> & { readonly addressKeys: string[] } {
  const { state } = input;
  const shared = sharedPins(state.listings.map(({ listing }) => listing));
  const addressKeys = new Set<string>();
  const points = new Set<string>();
  for (const { listing } of state.listings) {
    const key =
      listing.latitude === null || listing.longitude === null
        ? null
        : `${listing.latitude},${listing.longitude}`;
    const address = classifyDeclaredAddress(listing.addressDeclared);
    const pending = pendingLookups({
      listing,
      pinShared: key !== null && shared.has(key),
      geocode:
        address.kind === "street_number"
          ? state.geocodes.get(address.addressKey)
          : null,
      parcelsAt: (point) => state.lookups.get(point),
    });
    if (pending.addressKey !== null) addressKeys.add(pending.addressKey);
    if (pending.pointKey !== null) points.add(pending.pointKey);
  }
  const batches = Math.ceil(addressKeys.size / GEOREF_MAX_BATCH);
  return {
    [BARRIOS_LAYER_ID]: layerDue(input.barrios, input.now)
      ? [BARRIOS_LAYER_ID]
      : [],
    [ZONING_LAYER_ID]: layerDue(input.zoning, input.now)
      ? [ZONING_LAYER_ID]
      : [],
    [GEOREF_DATASET]: Array.from(
      { length: batches },
      (_, index) => `addresses-${index + 1}`,
    ),
    [PARCELS_DATASET]: [...points].sort().slice(0, MAX_POINTS_PER_JOB),
    addressKeys: [...addressKeys].sort(),
  };
}

/** Los avisos cuya lectura guardada leyó otra cosa. */
export function staleListings(input: {
  readonly state: LocationState;
  readonly barriosRelease: string | null;
  readonly zoningRelease: string | null;
}): string[] {
  const { state } = input;
  const shared = sharedPins(state.listings.map(({ listing }) => listing));
  return state.listings
    .filter(({ listingId, listing }) => {
      const stored = state.readings.get(listingId);
      if (stored === undefined) return true;
      return stored.inputHash !== inputHashOf(state, listing, shared, input);
    })
    .map(({ listingId }) => listingId);
}

function inputHashOf(
  state: LocationState,
  listing: LocationState["listings"][number]["listing"],
  shared: ReadonlySet<string>,
  releases: { barriosRelease: string | null; zoningRelease: string | null },
): string {
  const key =
    listing.latitude === null || listing.longitude === null
      ? null
      : `${listing.latitude},${listing.longitude}`;
  const address = classifyDeclaredAddress(listing.addressDeclared);
  return locationInputHash({
    listing,
    pinShared: key !== null && shared.has(key),
    geocode:
      address.kind === "street_number"
        ? state.geocodes.get(address.addressKey)
        : null,
    parcelsAt: (point) => state.lookups.get(point),
    zoningQueryFor: (nomenclature) => state.queries.get(nomenclature) ?? null,
    ...releases,
  });
}

/**
 * Resuelve en código las lecturas atrasadas y escribe las que cambiaron. Las
 * capas se cargan una vez por corrida.
 */
export async function resolveStaleLocations(dependencies: {
  readonly store: LocationStore;
  readonly now: () => string;
}): Promise<{ readonly resolved: number; readonly written: number }> {
  const { store } = dependencies;
  const [state, barrios, zoning] = await Promise.all([
    store.readState(),
    store.readLayer("cordoba.barrios"),
    store.readLayer("idecor.cba-ordenanza-8256"),
  ]);
  const releases = {
    barriosRelease: barrios.release?.releaseId ?? null,
    zoningRelease: zoning.release?.releaseId ?? null,
  };
  const stale = new Set(staleListings({ state, ...releases }));
  if (stale.size === 0) return { resolved: 0, written: 0 };
  const shared = sharedPins(state.listings.map(({ listing }) => listing));
  const readings = state.listings
    .filter(({ listingId }) => stale.has(listingId))
    .map(({ listingId, listing }) => {
      const key =
        listing.latitude === null || listing.longitude === null
          ? null
          : `${listing.latitude},${listing.longitude}`;
      const address = classifyDeclaredAddress(listing.addressDeclared);
      return {
        listingId,
        inputHash: inputHashOf(state, listing, shared, releases),
        reading: resolveListingLocation({
          listing,
          pinShared: key !== null && shared.has(key),
          geocode:
            address.kind === "street_number"
              ? state.geocodes.get(address.addressKey)
              : null,
          parcelsAt: (point) => state.lookups.get(point),
          zoningQueryFor: (nomenclature) =>
            state.queries.get(nomenclature) ?? null,
          barrios: barrios.release,
          zoning: zoning.release,
        }),
      };
    });
  const written = await store.recordReadings(readings, dependencies.now());
  return { resolved: readings.length, written };
}

export class LocationSubjectRejectedError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "LocationSubjectRejectedError";
  }
}

const runFor = (
  dataset: LocationRefreshDataset,
  subjectKey: string,
  ids: { runId: string; startedAt: string },
  observedAt: string,
  recordedAt: string,
): LocationRun => ({
  runId: ids.runId,
  sourceId: dataset.sourceId,
  datasetId: dataset.datasetId,
  parserVersion: dataset.parserVersion,
  subjectKey,
  startedAt: ids.startedAt,
  observedAt,
  recordedAt,
});

/** Graba un sujeto del job y devuelve su corrida. */
export function createLocationRecorder(dependencies: {
  readonly store: LocationStore;
  readonly sources: LocationSources;
  readonly now: () => string;
  readonly newId: () => string;
}): (job: IngestionJob, subjectKey: string) => Promise<string> {
  const { store, sources, now, newId } = dependencies;
  return async (job, subjectKey) => {
    const dataset = LOCATION_REFRESH_DATASETS.find(
      (candidate) =>
        candidate.datasetId === job.datasetId &&
        candidate.sourceId === job.sourceId,
    );
    if (dataset === undefined)
      throw new LocationSubjectRejectedError("not_declared");
    const ids = { runId: newId(), startedAt: now() };

    switch (dataset.datasetId) {
      case BARRIOS_LAYER_ID: {
        const { features, observedAt } = await sources.barrios();
        const { runId } = await store.recordLayer(
          runFor(dataset, subjectKey, ids, observedAt, now()),
          "cordoba.barrios",
          features,
        );
        return runId;
      }
      case ZONING_LAYER_ID: {
        const { features, observedAt } = await sources.zoningLayer();
        const { runId } = await store.recordLayer(
          runFor(dataset, subjectKey, ids, observedAt, now()),
          "idecor.cba-ordenanza-8256",
          features,
        );
        return runId;
      }
      case GEOREF_DATASET: {
        // El lote es «lo pendiente ahora»: un reintento no repregunta lo ya
        // respondido.
        const [state, barrios, zoning] = await Promise.all([
          store.readState(),
          store.readLayer("cordoba.barrios"),
          store.readLayer("idecor.cba-ordenanza-8256"),
        ]);
        const queries: GeorefQuery[] = pendingSubjects({
          state,
          barrios,
          zoning,
          now: now(),
        })
          .addressKeys.slice(0, GEOREF_MAX_BATCH)
          .map((addressKey) => {
            const space = addressKey.lastIndexOf(" ");
            return {
              addressKey,
              street: addressKey.slice(0, space),
              number: Number(addressKey.slice(space + 1)),
            };
          });
        if (queries.length === 0)
          return store.recordGeocodes(
            runFor(dataset, subjectKey, ids, ids.startedAt, now()),
            [],
          );
        const { results, observedAt } = await sources.geocode(queries);
        return store.recordGeocodes(
          runFor(dataset, subjectKey, ids, observedAt, now()),
          queries.map((query, index) => ({
            addressKey: query.addressKey,
            result: results[index],
          })),
        );
      }
      case PARCELS_DATASET: {
        const match = /^(-?\d{1,3}\.\d{7}),(-?\d{1,3}\.\d{7})$/u.exec(
          subjectKey,
        );
        if (match === null)
          throw new LocationSubjectRejectedError("point_key_invalid");
        const point = {
          latitude: Number(match[1]),
          longitude: Number(match[2]),
        };
        const { parcels, observedAt } = await sources.parcelsAt(point);
        return store.recordParcelLookup(
          runFor(dataset, subjectKey, ids, observedAt, now()),
          subjectKey,
          parcels,
        );
      }
    }
  };
}

const SOURCE_LEVEL_CODES = new Set(["rights_not_approved"]);
const SUBJECT_LEVEL_CODES = new Set(["schema_changed", "unexpected_status"]);

export function createLocationExecutor(dependencies: {
  readonly record: (job: IngestionJob, subjectKey: string) => Promise<string>;
  readonly takeSignal: () => SourceSignal | null;
}): IngestionJobExecutor {
  return async (item, job) => {
    dependencies.takeSignal();
    try {
      const runId = await dependencies.record(job, item.subjectKey);
      return { kind: "ingested", ingestionRunId: runId };
    } catch (cause) {
      return classifyFailure(cause, dependencies.takeSignal());
    }
  };
}

function classifyFailure(
  cause: unknown,
  signal: SourceSignal | null,
): IngestionJobAttemptOutcome {
  if (signal !== null)
    return {
      kind: "source_signal",
      signal: signal.kind,
      ingestionRunId: null,
      retryAfter: signal.retryAfter,
      message: signal.detail,
    };
  if (cause instanceof SourceRequestRefusedError)
    return {
      kind: "source_signal",
      signal: "refused",
      ingestionRunId: null,
      retryAfter: null,
      message: cause.code,
    };
  if (cause instanceof LocationSubjectRejectedError)
    return { kind: "subject_rejected", message: cause.code };
  if (cause instanceof LocationSourceError) {
    if (SOURCE_LEVEL_CODES.has(cause.code))
      return {
        kind: "source_signal",
        signal: "refused",
        ingestionRunId: null,
        retryAfter: null,
        message: cause.code,
      };
    if (cause.code === "rate_limited")
      return {
        kind: "source_signal",
        signal: "throttled",
        ingestionRunId: null,
        retryAfter: cause.retryAfter,
        message: cause.code,
      };
    if (SUBJECT_LEVEL_CODES.has(cause.code))
      return {
        kind: "subject_rejected",
        message: `${cause.code}${cause.detail === null ? "" : `:${cause.detail}`}`,
      };
    return { kind: "executor_error", message: cause.code };
  }
  if (cause instanceof Error)
    return { kind: "executor_error", message: cause.name };
  throw cause;
}

export function createLocationAdmission(dependencies: {
  readonly sourceId: string;
  readonly budgets: SourceBudgetStore;
  readonly now: () => string;
}): () => Promise<IngestionJobAdmission> {
  return async () => {
    const verdict = await checkSourceBudget(
      dependencies.budgets,
      dependencies.sourceId,
      1,
      dependencies.now(),
    );
    switch (verdict.status) {
      case "allowed":
        return { status: "ready" };
      case "daily_budget_exhausted":
        return {
          status: "daily_budget_exhausted",
          resumesAt: verdict.resumesAt,
        };
      case "source_disabled":
      case "budget_undeclared":
        return {
          status: "source_disabled",
          reason: `${dependencies.sourceId}: ${verdict.status}`,
        };
    }
  };
}

/** Lo que ve la página: conteos y códigos, nunca un mensaje (`TM-02`). */
export type LocationRefreshStatus =
  | { readonly state: "fresh" }
  | {
      readonly state: "running";
      readonly pending: number;
      readonly done: number;
    }
  | {
      readonly state: "failed";
      readonly failed: number;
      readonly labels: readonly string[];
    }
  | {
      readonly state: "blocked";
      readonly reason:
        "daily_budget_exhausted" | "source_disabled" | "budget_undeclared";
      readonly label: string;
    };

export type LocationRefreshDependencies = {
  readonly jobs: IngestionJobStore;
  readonly store: LocationStore;
  readonly budgets: SourceBudgetStore;
  readonly now: () => string;
};

async function openLocationJobs(
  jobs: IngestionJobStore,
): Promise<IngestionJob[]> {
  const sources = [
    ...new Set(LOCATION_REFRESH_DATASETS.map((dataset) => dataset.sourceId)),
  ];
  return (
    await Promise.all(
      sources.map((sourceId) =>
        jobs.listJobs({ sourceId, statuses: ["open", "paused"], limit: 10 }),
      ),
    )
  )
    .flat()
    .filter((job) => job.kind === LOCATION_REFRESH_KIND);
}

/** Los sujetos que fallaron en el último job terminado de cada dataset. */
async function failedSubjects(
  jobs: IngestionJobStore,
): Promise<Map<DatasetId, Set<string>>> {
  const failed = new Map<DatasetId, Set<string>>();
  for (const dataset of LOCATION_REFRESH_DATASETS) {
    const [latest] = (
      await jobs.listJobs({
        sourceId: dataset.sourceId,
        statuses: ["completed"],
        limit: 25,
      })
    ).filter(
      (job) =>
        job.kind === LOCATION_REFRESH_KIND &&
        job.datasetId === dataset.datasetId,
    );
    if (latest === undefined) continue;
    const items = await jobs.listItems({
      jobId: latest.jobId,
      statuses: ["failed", "poisoned"],
      limit: 1000,
    });
    if (items.length > 0)
      failed.set(
        dataset.datasetId,
        new Set(items.map((item) => item.subjectKey)),
      );
  }
  return failed;
}

/**
 * Un paso idempotente: informa los jobs abiertos, o planea lo pendiente, o
 * contesta `fresh`. No baja nada: eso lo hace el worker.
 */
export async function ensureLocationRefresh(
  input: { readonly retryFailures: boolean },
  dependencies: LocationRefreshDependencies & {
    readonly workerActive: () => boolean;
  },
): Promise<{
  readonly status: LocationRefreshStatus;
  readonly runWorker: boolean;
}> {
  const { jobs, store, now } = dependencies;
  const open = await openLocationJobs(jobs);
  if (open.length > 0)
    return { status: await describe(jobs, open), runWorker: true };

  const [state, barrios, zoning] = await Promise.all([
    store.readState(),
    store.readLayer("cordoba.barrios"),
    store.readLayer("idecor.cba-ordenanza-8256"),
  ]);
  const pending = pendingSubjects({ state, barrios, zoning, now: now() });
  const failed = await failedSubjects(jobs);
  const plans: { dataset: LocationRefreshDataset; subjects: string[] }[] = [];
  let skippedFailures = 0;
  const failedLabels: string[] = [];
  for (const dataset of LOCATION_REFRESH_DATASETS) {
    const before = failed.get(dataset.datasetId) ?? new Set<string>();
    const subjects = pending[dataset.datasetId].filter(
      (subject) => input.retryFailures || !before.has(subject),
    );
    const skipped = pending[dataset.datasetId].length - subjects.length;
    if (skipped > 0) {
      skippedFailures += skipped;
      failedLabels.push(dataset.label);
    }
    if (subjects.length > 0) plans.push({ dataset, subjects });
  }

  for (const plan of plans) {
    const verdict = await checkSourceBudget(
      dependencies.budgets,
      plan.dataset.sourceId,
      1,
      now(),
    );
    if (verdict.status !== "allowed")
      return {
        status: {
          state: "blocked",
          reason: verdict.status,
          label: plan.dataset.label,
        },
        runWorker: false,
      };
  }

  for (const plan of plans)
    await jobs.createJob(
      {
        kind: LOCATION_REFRESH_KIND,
        sourceId: plan.dataset.sourceId,
        datasetId: plan.dataset.datasetId,
        parserVersion: plan.dataset.parserVersion,
        selectionVersion: null,
        subjects: plan.subjects,
        maxAttempts: 2,
      },
      { now: now() },
    );

  const stale = staleListings({
    state,
    barriosRelease: barrios.release?.releaseId ?? null,
    zoningRelease: zoning.release?.releaseId ?? null,
  });
  if (plans.length > 0 || stale.length > 0)
    return {
      status: {
        state: "running",
        pending: plans.reduce((total, plan) => total + plan.subjects.length, 0),
        done: 0,
      },
      runWorker: true,
    };
  if (skippedFailures > 0)
    return {
      status: {
        state: "failed",
        failed: skippedFailures,
        labels: failedLabels,
      },
      runWorker: false,
    };
  return { status: { state: "fresh" }, runWorker: false };
}

async function describe(
  jobs: IngestionJobStore,
  open: readonly IngestionJob[],
): Promise<LocationRefreshStatus> {
  let pending = 0;
  let done = 0;
  for (const job of open) {
    const counts = await jobs.countItems(job.jobId);
    pending += counts.pending + counts.running;
    done += counts.completed + counts.failed + counts.poisoned;
  }
  return { state: "running", pending, done };
}

/** Los jobs abiertos en el orden en que corren. */
export async function openLocationJobsInOrder(
  jobs: IngestionJobStore,
): Promise<IngestionJob[]> {
  const order = (job: IngestionJob) =>
    LOCATION_REFRESH_DATASETS.findIndex(
      (dataset) => dataset.datasetId === job.datasetId,
    );
  return (await openLocationJobs(jobs)).sort(
    (left, right) =>
      order(left) - order(right) ||
      Date.parse(left.createdAt) - Date.parse(right.createdAt),
  );
}

/** El paso siguiente de una release recién bajada: se carga con su caja. */
export function releaseOf<P>(release: {
  readonly releaseId: string;
  readonly observedAt: string;
  readonly features: readonly Parameters<typeof withBox<P>>[0][];
}): LayerRelease<P> {
  return {
    releaseId: release.releaseId,
    observedAt: release.observedAt,
    features: release.features.map((feature) => withBox(feature)),
  };
}
