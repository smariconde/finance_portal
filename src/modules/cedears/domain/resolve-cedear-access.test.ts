import { createHash, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { pointInTimeQuerySchema } from "@/modules/temporal/domain/point-in-time-query";

import {
  FIXTURE_CEDEAR_ISINS,
  FIXTURE_OBSERVED_AT,
  FIXTURE_UNDERLYING_IDS,
  fixtureCedearGraph,
  fixtureComafiProducts,
} from "../infrastructure/fixture-cedear-publications";
import { InMemoryCedearRegistryRepository } from "../infrastructure/in-memory-cedear-registry-repository";

import { COMAFI_DEPOSITARY } from "./cedear-depositaries";
import { parseComafiProducts } from "./parse-comafi-products";
import { planCedearRegistry } from "./plan-cedear-registry";
import { resolveCedearAccess } from "./resolve-cedear-access";

const U = FIXTURE_UNDERLYING_IDS;
const RATIO_CHANGE_SEEN = "2026-10-01T03:00:00.000Z";
const WITHDRAWAL_SEEN = "2026-10-08T03:00:00.000Z";

function asKnown(effectiveAt: string, knownAt: string = effectiveAt) {
  return pointInTimeQuerySchema.parse({
    effectiveAt,
    revisionPolicy: "as_known",
    knownAt,
    sourcePolicyVersion: "source-policy-1.0.0",
  });
}

async function registryThrough(steps: readonly [string, object][]) {
  const repository = new InMemoryCedearRegistryRepository(fixtureCedearGraph());

  for (const [observedAt, overrides] of steps) {
    const publication = parseComafiProducts(fixtureComafiProducts(overrides));

    if (!publication.ok) {
      throw new Error(publication.code);
    }

    const plan = planCedearRegistry({
      depositary: COMAFI_DEPOSITARY,
      publication,
      graph: repository.graph(),
      stored: await repository.loadRegistry({}),
      observedAt,
      recordedAt: observedAt,
      sourceDocumentId: null,
      acceptWithdrawals: false,
      newId: () => randomUUID(),
      hashContent: (input) => createHash("sha256").update(input).digest("hex"),
    });
    await repository.applyRegistryPlan(plan);
  }

  return repository.loadRegistry({});
}

describe("resolveCedearAccess", () => {
  it("answers with the program and its ratio once it was observed", async () => {
    const registry = await registryThrough([[FIXTURE_OBSERVED_AT, {}]]);
    const access = resolveCedearAccess(
      registry,
      U.alphaSecurity,
      asKnown("2026-09-24T00:00:00.000Z"),
    );

    expect(access.status).toBe("program");

    if (access.status === "program") {
      expect(access.programs).toHaveLength(1);
      expect(access.programs[0]!.ratio).toMatchObject({
        depositaryUnits: "10",
        underlyingUnits: "1",
      });
    }
  });

  it("never says «no CEDEAR» before the first observation", async () => {
    // El registro no afirma que el programa existía antes de verlo.
    const registry = await registryThrough([[FIXTURE_OBSERVED_AT, {}]]);

    expect(
      resolveCedearAccess(
        registry,
        U.alphaSecurity,
        asKnown("2026-09-22T20:00:00.000Z", "2026-09-24T00:00:00.000Z"),
      ),
    ).toEqual({ status: "none_known", reason: "not_effective_at_cutoff" });
  });

  it("separates a security that never had a program from one out of range", async () => {
    const registry = await registryThrough([[FIXTURE_OBSERVED_AT, {}]]);

    // La clase B del emisor con dos clases no es subyacente de nada.
    expect(
      resolveCedearAccess(
        registry,
        U.gammaClassB,
        asKnown("2026-09-24T00:00:00.000Z"),
      ),
    ).toEqual({ status: "none_known", reason: "no_program_recorded" });
  });

  it("does not leak a later ratio into an earlier as_known", async () => {
    const registry = await registryThrough([
      [FIXTURE_OBSERVED_AT, {}],
      [RATIO_CHANGE_SEEN, { alphaRatio: "20:1" }],
    ]);
    const ratioAt = (effectiveAt: string, knownAt: string) => {
      const access = resolveCedearAccess(
        registry,
        U.alphaSecurity,
        asKnown(effectiveAt, knownAt),
      );

      return access.status === "program"
        ? (access.programs[0]!.ratio?.depositaryUnits ?? null)
        : access.reason;
    };

    // Un instante antes de verlo, el ratio conocido es el anterior.
    expect(
      ratioAt("2026-09-30T00:00:00.000Z", "2026-09-30T00:00:00.000Z"),
    ).toBe("10");
    expect(ratioAt(RATIO_CHANGE_SEEN, RATIO_CHANGE_SEEN)).toBe("20");
    // El programa sobrevive al cambio de ratio: sigue siendo conocido.
    const later = resolveCedearAccess(
      registry,
      U.alphaSecurity,
      asKnown("2026-09-30T00:00:00.000Z", "2026-10-02T00:00:00.000Z"),
    );

    expect(later.status).toBe("program");
    // Límite declarado (ADR 0027): sabiendo del cambio, un corte anterior a su
    // observación queda sin ratio. La fecha efectiva está en el aviso del
    // emisor, y superseder no la inventa.
    expect(later.status === "program" && later.programs[0]!.ratio).toBeNull();
  });

  it("stops answering with a withdrawn program from the withdrawal on", async () => {
    const registry = await registryThrough([
      [FIXTURE_OBSERVED_AT, {}],
      [WITHDRAWAL_SEEN, { omit: [FIXTURE_CEDEAR_ISINS.alpha] }],
    ]);

    expect(
      resolveCedearAccess(
        registry,
        U.alphaSecurity,
        asKnown("2026-10-01T00:00:00.000Z"),
      ).status,
    ).toBe("program");
    expect(
      resolveCedearAccess(
        registry,
        U.alphaSecurity,
        asKnown("2026-10-09T00:00:00.000Z"),
      ),
    ).toEqual({ status: "none_known", reason: "not_effective_at_cutoff" });
  });
});
