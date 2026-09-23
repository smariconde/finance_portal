import { createHash, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  FIXTURE_CEDEAR_ISINS,
  FIXTURE_OBSERVED_AT,
  FIXTURE_UNDERLYING_IDS,
  FIXTURE_UNDERLYING_ISINS,
  fixtureCajaValoresHtml,
  fixtureCedearGraph,
  fixtureComafiProducts,
} from "../infrastructure/fixture-cedear-publications";
import { InMemoryCedearRegistryRepository } from "../infrastructure/in-memory-cedear-registry-repository";

import type { CedearClaim, CedearPublication } from "./cedear-claim";
import {
  CAJA_VALORES_DEPOSITARY,
  COMAFI_DEPOSITARY,
  type CedearDepositary,
} from "./cedear-depositaries";
import { parseCajaValoresCedears } from "./parse-caja-valores-cedears";
import { parseComafiProducts } from "./parse-comafi-products";
import {
  isEmptyCedearPlan,
  planCedearRegistry,
  type CedearRegistryPlan,
} from "./plan-cedear-registry";

type Published = Extract<CedearPublication, { ok: true }>;

const U = FIXTURE_UNDERLYING_IDS;
const I = FIXTURE_CEDEAR_ISINS;
const LATER = "2026-09-30T03:00:00.000Z";
const LATEST = "2026-10-07T03:00:00.000Z";

const hash = (input: string) =>
  createHash("sha256").update(input).digest("hex");

function comafi(
  overrides: Parameters<typeof fixtureComafiProducts>[0] = {},
): Published {
  const publication = parseComafiProducts(fixtureComafiProducts(overrides));

  if (!publication.ok) {
    throw new Error(publication.code);
  }

  return publication;
}

function caja(): Published {
  const publication = parseCajaValoresCedears(fixtureCajaValoresHtml());

  if (!publication.ok) {
    throw new Error(publication.code);
  }

  return publication;
}

async function observe(
  repository: InMemoryCedearRegistryRepository,
  depositary: CedearDepositary,
  publication: Published,
  observedAt: string,
  acceptWithdrawals = false,
): Promise<CedearRegistryPlan> {
  const stored = await repository.loadRegistry({
    depositaryLegalEntityId: depositary.legalEntityId,
  });
  const plan = planCedearRegistry({
    depositary,
    publication,
    graph: repository.graph(),
    stored,
    observedAt,
    recordedAt: observedAt,
    sourceDocumentId: "11111111-1111-4111-8111-111111111111",
    acceptWithdrawals,
    newId: () => randomUUID(),
    hashContent: hash,
  });

  if (plan.refusal === null) {
    await repository.applyRegistryPlan(plan);
  }

  return plan;
}

function freshRepository() {
  return new InMemoryCedearRegistryRepository(fixtureCedearGraph());
}

describe("planCedearRegistry — first observation", () => {
  it("records the programs whose underlying the graph has, and names the rest", async () => {
    const plan = await observe(
      freshRepository(),
      COMAFI_DEPOSITARY,
      comafi(),
      FIXTURE_OBSERVED_AT,
    );

    expect(
      plan.programs.map((program) => program.underlyingSecurityId).sort(),
    ).toEqual([U.alphaSecurity, U.betaSecurity, U.gammaClassA].sort());
    expect(plan.counts).toMatchObject({
      rowsSeen: 9,
      claims: 6,
      resolved: 3,
      programsOpened: 3,
      unchanged: 0,
      withdrawn: 0,
    });
    expect(plan.rejections.map((rejection) => rejection.code).sort()).toEqual([
      "cedear_isin_absent",
      "ratio_malformed",
      "underlying_ticker_conflict",
    ]);
    expect(
      plan.outsideUniverse.map((row) => [row.cedearIsin, row.reason]).sort(),
    ).toEqual(
      [
        [I.corporate, "debt_program"],
        [I.etf, "symbol_not_in_universe"],
        [I.foreign, "foreign_market"],
      ].sort(),
    );
  });

  it("marks only the class the program names, never the other class", async () => {
    const plan = await observe(
      freshRepository(),
      COMAFI_DEPOSITARY,
      comafi(),
      FIXTURE_OBSERVED_AT,
    );

    expect(
      plan.programs.some(
        (program) => program.underlyingSecurityId === U.gammaClassB,
      ),
    ).toBe(false);
  });

  it("keeps the CEDEAR as its own security, issued by the depositary", async () => {
    const plan = await observe(
      freshRepository(),
      COMAFI_DEPOSITARY,
      comafi(),
      FIXTURE_OBSERVED_AT,
    );

    expect(plan.legalEntities).toHaveLength(1);
    expect(plan.legalEntities[0]).toMatchObject({
      legalEntityId: COMAFI_DEPOSITARY.legalEntityId,
      legalName: "Banco Comafi S.A.",
      entityType: "bank",
      jurisdiction: "AR",
    });
    expect(plan.securities).toHaveLength(3);

    for (const security of plan.securities) {
      expect(security.issuerLegalEntityId).toBe(
        COMAFI_DEPOSITARY.legalEntityId,
      );
      expect(security.securityType).toBe("depositary_receipt");
    }

    for (const program of plan.programs) {
      expect(program.depositarySecurityId).not.toBe(
        program.underlyingSecurityId,
      );
      expect(plan.securities.map((security) => security.securityId)).toContain(
        program.depositarySecurityId,
      );
    }

    // Cada CEDEAR se identifica por su ISIN y su código de Caja de Valores.
    expect(
      plan.identifierAssignments
        .map((assignment) => [
          assignment.identifierType,
          assignment.normalizedValue,
        ])
        .filter(([type]) => type === "isin")
        .map(([, value]) => value)
        .sort(),
    ).toEqual([I.alpha, I.beta, I.gammaA].sort());
    expect(
      plan.identifierAssignments.filter(
        (assignment) => assignment.identifierType === "caja_valores_code",
      ),
    ).toHaveLength(3);
  });

  it("dates everything it opens at the observation, which is all it can prove", async () => {
    const plan = await observe(
      freshRepository(),
      COMAFI_DEPOSITARY,
      comafi(),
      FIXTURE_OBSERVED_AT,
    );

    for (const version of [
      ...plan.legalEntities,
      ...plan.securities,
      ...plan.identifierAssignments,
      ...plan.programs,
      ...plan.ratios,
    ]) {
      expect(version.validFrom).toBe(FIXTURE_OBSERVED_AT);
      expect(version.availableAt).toBe(FIXTURE_OBSERVED_AT);
      expect(version.sourceId).toBe("comafi-cedear");
    }
  });

  it("stores the ratio as an exact fraction and the resolution evidence", async () => {
    const plan = await observe(
      freshRepository(),
      COMAFI_DEPOSITARY,
      comafi(),
      FIXTURE_OBSERVED_AT,
    );
    const gamma = plan.programs.find(
      (program) => program.underlyingSecurityId === U.gammaClassA,
    )!;

    expect(
      plan.ratios.find(
        (ratio) => ratio.depositaryProgramId === gamma.depositaryProgramId,
      ),
    ).toMatchObject({
      depositaryUnits: "1",
      underlyingUnits: "4",
      announcedAt: null,
    });
    expect(gamma).toMatchObject({
      programType: "cedear",
      status: "active",
      investorScope: "all_investors",
      reportedUnderlyingSymbol: "FXC/A",
      reportedUnderlyingIsin: FIXTURE_UNDERLYING_ISINS.gammaA,
    });
  });

  it("reports the quality flags of what it records", async () => {
    const plan = await observe(
      freshRepository(),
      COMAFI_DEPOSITARY,
      comafi(),
      FIXTURE_OBSERVED_AT,
    );

    expect(
      plan.flagged.map((row) => [row.cedearIsin, row.flags]).sort(),
    ).toEqual(
      [
        [I.beta, ["origin_market_stale"]],
        [I.gammaA, ["origin_market_unrecognized"]],
      ].sort(),
    );
  });
});

describe("planCedearRegistry — later observations", () => {
  it("writes nothing when the publication says the same", async () => {
    const repository = freshRepository();
    await observe(repository, COMAFI_DEPOSITARY, comafi(), FIXTURE_OBSERVED_AT);
    const again = await observe(repository, COMAFI_DEPOSITARY, comafi(), LATER);

    expect(isEmptyCedearPlan(again)).toBe(true);
    expect(again.counts.unchanged).toBe(3);
  });

  it("supersedes only the ratio when the ratio changes", async () => {
    const repository = freshRepository();
    const first = await observe(
      repository,
      COMAFI_DEPOSITARY,
      comafi(),
      FIXTURE_OBSERVED_AT,
    );
    const plan = await observe(
      repository,
      COMAFI_DEPOSITARY,
      comafi({ alphaRatio: "20:1" }),
      LATER,
    );
    const alphaProgram = first.programs.find(
      (program) => program.underlyingSecurityId === U.alphaSecurity,
    )!;
    const alphaRatio = first.ratios.find(
      (ratio) => ratio.depositaryProgramId === alphaProgram.depositaryProgramId,
    )!;

    // El programa sobrevive: su existencia no depende del ratio.
    expect(plan.programSupersessions).toEqual([]);
    expect(plan.programs).toEqual([]);
    expect(plan.ratioSupersessions).toEqual([
      {
        id: alphaRatio.depositaryRatioId,
        validFrom: FIXTURE_OBSERVED_AT,
        supersededAt: LATER,
      },
    ]);
    expect(plan.ratios).toHaveLength(1);
    expect(plan.ratios[0]).toMatchObject({
      depositaryProgramId: alphaProgram.depositaryProgramId,
      depositaryUnits: "20",
      validFrom: LATER,
    });
    expect(plan.counts.ratiosChanged).toBe(1);
    expect(plan.counts.unchanged).toBe(2);
  });

  it("does not supersede a ratio written differently but equal", async () => {
    const repository = freshRepository();
    await observe(repository, COMAFI_DEPOSITARY, comafi(), FIXTURE_OBSERVED_AT);
    const plan = await observe(
      repository,
      COMAFI_DEPOSITARY,
      comafi({ alphaRatio: "20 : 2" }),
      LATER,
    );

    expect(isEmptyCedearPlan(plan)).toBe(true);
  });

  it("supersedes the program when its status changes, and leaves the ratio", async () => {
    const repository = freshRepository();
    await observe(repository, COMAFI_DEPOSITARY, comafi(), FIXTURE_OBSERVED_AT);
    const plan = await observe(
      repository,
      COMAFI_DEPOSITARY,
      comafi({ alphaObservation: "Inhabilitado para emitir y cancelar***" }),
      LATER,
    );

    expect(plan.programSupersessions).toHaveLength(1);
    expect(plan.programs).toHaveLength(1);
    expect(plan.programs[0]).toMatchObject({
      underlyingSecurityId: U.alphaSecurity,
      status: "suspended",
      validFrom: LATER,
    });
    expect(plan.ratioSupersessions).toEqual([]);
    expect(plan.counts.statusChanged).toBe(1);
  });

  it("withdraws a program the issuer stops listing, without a successor", async () => {
    const repository = freshRepository();
    await observe(repository, COMAFI_DEPOSITARY, comafi(), FIXTURE_OBSERVED_AT);
    const plan = await observe(
      repository,
      COMAFI_DEPOSITARY,
      comafi({ omit: [I.alpha] }),
      LATER,
    );

    expect(plan.withdrawn).toEqual([{ cedearIsin: I.alpha, symbol: "FXA" }]);
    expect(plan.programSupersessions).toHaveLength(1);
    expect(plan.ratioSupersessions).toHaveLength(1);
    expect(plan.programs).toEqual([]);
    expect(plan.refusal).toBeNull();
  });

  it("reopens the same program when a withdrawn CEDEAR is listed again", async () => {
    const repository = freshRepository();
    const first = await observe(
      repository,
      COMAFI_DEPOSITARY,
      comafi(),
      FIXTURE_OBSERVED_AT,
    );
    await observe(
      repository,
      COMAFI_DEPOSITARY,
      comafi({ omit: [I.alpha] }),
      LATER,
    );
    const plan = await observe(repository, COMAFI_DEPOSITARY, comafi(), LATEST);
    const alpha = first.programs.find(
      (program) => program.underlyingSecurityId === U.alphaSecurity,
    )!;

    // La security del CEDEAR se encuentra por ISIN: no se crea otra.
    expect(plan.securities).toEqual([]);
    expect(plan.programs).toHaveLength(1);
    expect(plan.programs[0]).toMatchObject({
      depositaryProgramId: alpha.depositaryProgramId,
      validFrom: LATEST,
    });
    expect(plan.ratios).toHaveLength(1);
  });

  it("does not withdraw a program whose row is listed but rejected", async () => {
    // Una fila con un error de tipeo sigue listada: no es una baja.
    const repository = freshRepository();
    await observe(repository, COMAFI_DEPOSITARY, comafi(), FIXTURE_OBSERVED_AT);
    const plan = await observe(
      repository,
      COMAFI_DEPOSITARY,
      comafi({ alphaRatio: "3.1" }),
      LATER,
    );

    expect(plan.withdrawn).toEqual([]);
    expect(plan.counts.notReasserted).toBe(1);
    expect(isEmptyCedearPlan(plan)).toBe(true);
  });

  it("refuses a mass withdrawal unless the owner accepts it", async () => {
    const repository = freshRepository();
    const everything = syntheticPublication([
      ["ARFXCD000010", "FXA", "NYSE"],
      ["ARFXCD000028", "FXB", "NASDAQ GS"],
      ["ARFXCD000036", "FXC-A", "NYSE"],
      ["ARFXCD000044", "FXC-B", "NYSE"],
      ["ARFXCD000051", "FXD", "NASDAQ GS"],
    ]);
    await observe(
      repository,
      COMAFI_DEPOSITARY,
      everything,
      FIXTURE_OBSERVED_AT,
    );
    const almostNothing = syntheticPublication([
      ["ARFXCD000010", "FXA", "NYSE"],
    ]);

    const refused = await observe(
      repository,
      COMAFI_DEPOSITARY,
      almostNothing,
      LATER,
    );

    expect(refused.refusal).toEqual({
      code: "withdrawal_guard",
      withdrawn: 4,
      open: 5,
    });
    // Un plan negado no escribe, pero dice qué habría hecho.
    expect(isEmptyCedearPlan(refused)).toBe(true);
    expect(refused.withdrawn).toHaveLength(4);

    const accepted = await observe(
      repository,
      COMAFI_DEPOSITARY,
      almostNothing,
      LATER,
      true,
    );

    expect(accepted.refusal).toBeNull();
    expect(accepted.programSupersessions).toHaveLength(4);
  });

  it("sends a changed underlying to manual review instead of applying it", async () => {
    const repository = freshRepository();
    await observe(
      repository,
      COMAFI_DEPOSITARY,
      syntheticPublication([["ARFXCD000010", "FXA", "NYSE"]]),
      FIXTURE_OBSERVED_AT,
    );
    const plan = await observe(
      repository,
      COMAFI_DEPOSITARY,
      syntheticPublication([["ARFXCD000010", "FXD", "NASDAQ GS"]]),
      LATER,
    );

    expect(plan.rejections).toEqual([
      { label: "ARFXCD000010", code: "underlying_changed" },
    ]);
    expect(isEmptyCedearPlan(plan)).toBe(true);
    expect(plan.withdrawn).toEqual([]);
    // La fila cuenta una sola vez —rechazada, no resuelta— y el programa queda
    // como estaba: sigue listado, así que tampoco es una baja.
    expect(plan.counts.resolved).toBe(0);
    expect(plan.counts.notReasserted).toBe(1);
  });

  it("reports changed evidence and keeps the evidence of the first assertion", async () => {
    const repository = freshRepository();
    await observe(repository, COMAFI_DEPOSITARY, comafi(), FIXTURE_OBSERVED_AT);
    const changed = comafi();
    const plan = await observe(
      repository,
      COMAFI_DEPOSITARY,
      {
        ...changed,
        claims: changed.claims.map((claim) =>
          claim.cedearIsin === I.alpha
            ? {
                ...claim,
                reportedUnderlyingIsin: FIXTURE_UNDERLYING_ISINS.delta,
              }
            : claim,
        ),
      },
      LATER,
    );

    expect(plan.evidenceChanged).toEqual([
      { cedearIsin: I.alpha, symbol: "FXA" },
    ]);
    expect(isEmptyCedearPlan(plan)).toBe(true);
  });

  it("refuses to supersede with an observation that is not later", async () => {
    const repository = freshRepository();
    await observe(repository, COMAFI_DEPOSITARY, comafi(), LATER);

    await expect(
      observe(
        repository,
        COMAFI_DEPOSITARY,
        comafi({ alphaRatio: "20:1" }),
        FIXTURE_OBSERVED_AT,
      ),
    ).rejects.toThrow(/not later than the stored assertion/u);
  });
});

describe("planCedearRegistry — two issuers", () => {
  it("keeps each issuer's registry apart", async () => {
    const repository = freshRepository();
    await observe(repository, COMAFI_DEPOSITARY, comafi(), FIXTURE_OBSERVED_AT);
    const plan = await observe(
      repository,
      CAJA_VALORES_DEPOSITARY,
      caja(),
      LATER,
    );

    expect(plan.legalEntities.map((entity) => entity.legalName)).toEqual([
      "Caja de Valores S.A.",
    ]);
    expect(
      plan.programs.map((program) => program.underlyingSecurityId),
    ).toEqual([U.deltaSecurity]);
    // Caja no lista los programas de Comafi, y eso no los retira: la lista de
    // un emisor sólo es autoritativa sobre sus propios programas.
    expect(plan.withdrawn).toEqual([]);
    expect(plan.programSupersessions).toEqual([]);
  });

  it("refuses an ISIN that already identifies another issuer's CEDEAR", async () => {
    const repository = freshRepository();
    await observe(repository, COMAFI_DEPOSITARY, comafi(), FIXTURE_OBSERVED_AT);
    const plan = await observe(
      repository,
      CAJA_VALORES_DEPOSITARY,
      syntheticPublication([[I.alpha, "FXA", "NYSE"]]),
      LATER,
    );

    expect(plan.rejections).toEqual([
      { label: I.alpha, code: "cedear_isin_of_other_issuer" },
    ]);
    expect(plan.programs).toEqual([]);
  });
});

function syntheticPublication(
  rows: readonly (readonly [isin: string, symbol: string, market: string])[],
): Published {
  const claims: CedearClaim[] = rows.map(([isin, symbol, market], index) => ({
    cedearIsin: isin,
    cajaValoresCode: String(9000 + index),
    programName: `SYNTHETIC ${symbol}`,
    originSymbols: [symbol],
    originMarket: market,
    reportedUnderlyingIsin: null,
    ratio: { depositaryUnits: "10", underlyingUnits: "1" },
    status: "active",
    investorScope: "all_investors",
  }));

  return {
    ok: true,
    parserVersion: "synthetic",
    rowsSeen: claims.length,
    claims,
    rejections: [],
    skipped: [],
    listedIsins: new Set(claims.map((claim) => claim.cedearIsin)),
  };
}
