import { describe, expect, it } from "vitest";

import {
  refreshStateSchema,
  type RefreshState,
  type RefreshStateStore,
} from "./refresh-state-store";

/**
 * Contrato de la marca de agua del refresh (ADR 0021), escrito una vez y corrido
 * contra los dos: el doble en memoria en la suite unitaria y PostgreSQL en la de
 * integración. Lo que sólo se prueba sobre uno deja al otro divergir en silencio.
 *
 * Cada caso usa su propio sujeto, así que la base de integración no necesita
 * vaciarse entre casos.
 */
export type RefreshStateStoreContractHarness = {
  readonly createStore: () => RefreshStateStore;
  /**
   * Un `run_id` utilizable. En PostgreSQL la marca referencia corridas reales,
   * así que el harness tiene que crearlas; en memoria alcanza con un UUID.
   */
  readonly createRunId: () => Promise<string>;
};

export const REFRESH_SOURCE_ID = "sec-edgar";
export const REFRESH_DATASET_ID = "sec.companyfacts";
export const REFRESH_T0 = "2026-09-18T10:00:00.000Z";
export const REFRESH_T1 = "2026-09-18T14:00:00.000Z";
export const REFRESH_T2 = "2026-09-19T10:00:00.000Z";

let subjectSequence = 0;

export function uniqueRefreshSubjectKey(): string {
  subjectSequence += 1;

  return String(9_000_000_000 + subjectSequence).padStart(10, "0");
}

export function describeRefreshStateStoreContract(
  label: string,
  harness: RefreshStateStoreContractHarness,
): void {
  describe(`refresh state store contract (${label})`, () => {
    async function buildState(
      subjectKey: string,
      overrides: Partial<RefreshState> = {},
    ): Promise<RefreshState> {
      const runId = await harness.createRunId();

      return refreshStateSchema.parse({
        sourceId: REFRESH_SOURCE_ID,
        datasetId: REFRESH_DATASET_ID,
        subjectKey,
        watermarkAcceptedAt: "2026-07-31T10:01:02.000Z",
        watermarkAccession: "0000320193-26-000079",
        formSelectionVersion: "sec-companyfacts-forms-1.0.0",
        probeVersion: "sec-refresh-probe-1.0.0",
        lastCheckedAt: REFRESH_T0,
        lastChangedAt: REFRESH_T0,
        probeRunId: runId,
        refreshRunId: runId,
        updatedAt: REFRESH_T0,
        ...overrides,
      });
    }

    it("no inventa una marca para un sujeto que nunca se sondeó", async () => {
      const store = harness.createStore();

      await expect(
        store.find({
          sourceId: REFRESH_SOURCE_ID,
          datasetId: REFRESH_DATASET_ID,
          subjectKey: uniqueRefreshSubjectKey(),
        }),
      ).resolves.toBeNull();
    });

    it("escribe la marca y la devuelve igual", async () => {
      const store = harness.createStore();
      const state = await buildState(uniqueRefreshSubjectKey());

      await expect(store.record(state)).resolves.toEqual(state);
      await expect(
        store.find({
          sourceId: state.sourceId,
          datasetId: state.datasetId,
          subjectKey: state.subjectKey,
        }),
      ).resolves.toEqual(state);
    });

    it("mueve la marca cuando un refresh posterior la avanza", async () => {
      const store = harness.createStore();
      const first = await buildState(uniqueRefreshSubjectKey());
      await store.record(first);

      const runId = await harness.createRunId();
      const second = refreshStateSchema.parse({
        ...first,
        watermarkAcceptedAt: "2026-10-30T18:04:11.000Z",
        watermarkAccession: "0000320193-26-000101",
        lastCheckedAt: REFRESH_T2,
        lastChangedAt: REFRESH_T2,
        probeRunId: runId,
        refreshRunId: runId,
        updatedAt: REFRESH_T2,
      });

      await expect(store.record(second)).resolves.toEqual(second);
      await expect(
        store.find({
          sourceId: first.sourceId,
          datasetId: first.datasetId,
          subjectKey: first.subjectKey,
        }),
      ).resolves.toEqual(second);
    });

    it("un sondeo sin novedades avanza cuándo se miró y deja la marca", async () => {
      const store = harness.createStore();
      const state = await buildState(uniqueRefreshSubjectKey());
      await store.record(state);
      const probeRunId = await harness.createRunId();

      const touched = await store.touch({
        sourceId: state.sourceId,
        datasetId: state.datasetId,
        subjectKey: state.subjectKey,
        checkedAt: REFRESH_T1,
        probeRunId,
        probeVersion: "sec-refresh-probe-1.0.0",
      });

      expect(touched).toEqual({
        ...state,
        lastCheckedAt: REFRESH_T1,
        probeRunId: probeRunId,
        updatedAt: REFRESH_T1,
      });
      // La marca y el instante del último cambio no se tocan.
      expect(touched?.watermarkAccession).toBe(state.watermarkAccession);
      expect(touched?.lastChangedAt).toBe(state.lastChangedAt);
      expect(touched?.refreshRunId).toBe(state.refreshRunId);
    });

    it("no crea una fila al sondear un sujeto que todavía no tiene marca", async () => {
      const store = harness.createStore();
      const subjectKey = uniqueRefreshSubjectKey();

      await expect(
        store.touch({
          sourceId: REFRESH_SOURCE_ID,
          datasetId: REFRESH_DATASET_ID,
          subjectKey,
          checkedAt: REFRESH_T1,
          probeRunId: await harness.createRunId(),
          probeVersion: "sec-refresh-probe-1.0.0",
        }),
      ).resolves.toBeNull();
      await expect(
        store.find({
          sourceId: REFRESH_SOURCE_ID,
          datasetId: REFRESH_DATASET_ID,
          subjectKey,
        }),
      ).resolves.toBeNull();
    });

    it("una escritura tardía no retrocede lo que otro sondeo ya sabía", async () => {
      const store = harness.createStore();
      const subjectKey = uniqueRefreshSubjectKey();
      const current = await buildState(subjectKey, {
        lastCheckedAt: REFRESH_T2,
        lastChangedAt: REFRESH_T2,
        updatedAt: REFRESH_T2,
      });
      await store.record(current);

      const stale = await buildState(subjectKey, {
        watermarkAccession: "0000320193-26-000001",
        lastCheckedAt: REFRESH_T0,
        lastChangedAt: REFRESH_T0,
        updatedAt: REFRESH_T0,
      });

      await expect(store.record(stale)).resolves.toEqual(current);
      await expect(
        store.touch({
          sourceId: current.sourceId,
          datasetId: current.datasetId,
          subjectKey,
          checkedAt: REFRESH_T0,
          probeRunId: await harness.createRunId(),
          probeVersion: "sec-refresh-probe-1.0.0",
        }),
      ).resolves.toEqual(current);
    });

    it("lista el dataset pedido y no el de al lado", async () => {
      const store = harness.createStore();
      const mine = await buildState(uniqueRefreshSubjectKey());
      const other = await buildState(uniqueRefreshSubjectKey(), {
        datasetId: "sec.companyconcept",
      });
      await store.record(mine);
      await store.record(other);

      const listed = await store.list({
        sourceId: REFRESH_SOURCE_ID,
        datasetId: REFRESH_DATASET_ID,
      });

      expect(listed.map((state) => state.subjectKey)).toContain(
        mine.subjectKey,
      );
      expect(listed.map((state) => state.subjectKey)).not.toContain(
        other.subjectKey,
      );
    });

    it("rechaza una marca cuyo cambio es posterior a la mirada", async () => {
      const runId = await harness.createRunId();

      expect(() =>
        refreshStateSchema.parse({
          sourceId: REFRESH_SOURCE_ID,
          datasetId: REFRESH_DATASET_ID,
          subjectKey: uniqueRefreshSubjectKey(),
          watermarkAcceptedAt: "2026-07-31T10:01:02.000Z",
          watermarkAccession: "0000320193-26-000079",
          formSelectionVersion: "sec-companyfacts-forms-1.0.0",
          probeVersion: "sec-refresh-probe-1.0.0",
          lastCheckedAt: REFRESH_T0,
          lastChangedAt: REFRESH_T2,
          probeRunId: runId,
          refreshRunId: runId,
          updatedAt: REFRESH_T0,
        }),
      ).toThrow();
    });
  });
}
