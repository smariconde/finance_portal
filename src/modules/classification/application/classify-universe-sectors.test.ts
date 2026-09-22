import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { InMemoryClassificationRepository } from "../infrastructure/in-memory-classification-repository";
import { SP500_SECTOR_TAXONOMY_ID } from "../domain/sector-taxonomy";

import {
  buildSectorClaims,
  classifyUniverseSectors,
  type ClassifyUniverseSectorsCommand,
} from "./classify-universe-sectors";

const ALPHABET = "11111111-1111-4111-8111-111111111111";
const EXXON = "44444444-4444-4444-8444-444444444444";

const PIN_A = {
  commit: "a".repeat(40),
  committedAt: "2026-06-01T00:00:00.000Z",
};

const PIN_B = {
  commit: "b".repeat(40),
  committedAt: "2026-09-05T01:39:10.000Z",
};

let counter = 0;

function dependencies(repository: InMemoryClassificationRepository) {
  return {
    repository,
    now: () => "2026-09-21T12:00:00.000Z",
    newId: () => {
      counter += 1;
      return `99999999-9999-4999-8999-${String(counter).padStart(12, "0")}`;
    },
    hashContent: (input: string) =>
      createHash("sha256").update(input).digest("hex"),
  };
}

function command(
  overrides: Partial<ClassifyUniverseSectorsCommand> = {},
): ClassifyUniverseSectorsCommand {
  return {
    claims: [
      { symbol: "GOOGL", sector: "Communication Services" },
      { symbol: "GOOG", sector: "Communication Services" },
      { symbol: "XOM", sector: "Energy" },
    ],
    resolved: [
      { claimSymbol: "GOOGL", normalizedCik: "0001652044" },
      { claimSymbol: "GOOG", normalizedCik: "0001652044" },
      { claimSymbol: "XOM", normalizedCik: "0000034088" },
    ],
    entityIdByCik: new Map([
      ["0001652044", ALPHABET],
      ["0000034088", EXXON],
    ]),
    pin: PIN_A,
    sourceId: "datahub-sp500-pddl",
    sourceDocumentId: null,
    ...overrides,
  };
}

describe("buildSectorClaims", () => {
  it("collapses two share classes of one issuer into one assertion", () => {
    // Dos filas y un sujeto: abrir dos aserciones sería lo que el índice único
    // impide, así que colapsar acá no es una optimización, es la corrección.
    const built = buildSectorClaims(
      [
        { symbol: "GOOGL", sector: "Communication Services" },
        { symbol: "GOOG", sector: "Communication Services" },
      ],
      [
        { claimSymbol: "GOOGL", normalizedCik: "0001652044" },
        { claimSymbol: "GOOG", normalizedCik: "0001652044" },
      ],
      new Map([["0001652044", ALPHABET]]),
    );

    expect(built.claims).toHaveLength(1);
    expect(built.claims[0]!.subjectId).toBe(ALPHABET);
    expect(built.claims[0]!.claimSymbol).toBe("GOOGL/GOOG");
    expect(built.conflicts).toHaveLength(0);
  });

  it("refuses to break a tie when two classes disagree", () => {
    const built = buildSectorClaims(
      [
        { symbol: "GOOGL", sector: "Communication Services" },
        { symbol: "GOOG", sector: "Information Technology" },
      ],
      [
        { claimSymbol: "GOOGL", normalizedCik: "0001652044" },
        { claimSymbol: "GOOG", normalizedCik: "0001652044" },
      ],
      new Map([["0001652044", ALPHABET]]),
    );

    expect(built.claims).toHaveLength(0);
    expect(built.conflicts).toEqual(["GOOGL/GOOG"]);
  });

  it("names a symbol whose CIK has no legal entity in the graph", () => {
    const built = buildSectorClaims(
      [{ symbol: "XOM", sector: "Energy" }],
      [{ claimSymbol: "XOM", normalizedCik: "0000034088" }],
      new Map(),
    );

    expect(built.claims).toHaveLength(0);
    expect(built.unresolvedSubjects).toEqual(["XOM"]);
  });
});

describe("classifyUniverseSectors", () => {
  it("opens one assertion per issuer, dated by the pin", async () => {
    const repository = new InMemoryClassificationRepository();

    const outcome = await classifyUniverseSectors(
      command(),
      dependencies(repository),
    );

    expect(outcome.summary?.applied.opened).toBe(2);
    expect(
      outcome.plan.opened.every((row) => row.availableAt === PIN_A.committedAt),
    ).toBe(true);

    const stored = await repository.loadClassifications({
      taxonomyId: SP500_SECTOR_TAXONOMY_ID,
    });

    expect(stored).toHaveLength(2);
  });

  it("writes nothing when the same pin runs twice", async () => {
    const repository = new InMemoryClassificationRepository();
    const deps = dependencies(repository);

    await classifyUniverseSectors(command(), deps);
    const second = await classifyUniverseSectors(command(), deps);

    expect(second.summary).toBeNull();
    expect(second.plan.counts.unchanged).toBe(2);
    expect(
      await repository.loadClassifications({
        taxonomyId: SP500_SECTOR_TAXONOMY_ID,
      }),
    ).toHaveLength(2);
  });

  it("supersedes the old assertion when a new pin changes a sector", async () => {
    const repository = new InMemoryClassificationRepository();
    const deps = dependencies(repository);

    await classifyUniverseSectors(command(), deps);

    const moved = await classifyUniverseSectors(
      command({
        pin: PIN_B,
        claims: [
          { symbol: "GOOGL", sector: "Communication Services" },
          { symbol: "GOOG", sector: "Communication Services" },
          { symbol: "XOM", sector: "Utilities" },
        ],
      }),
      deps,
    );

    expect(moved.summary?.applied.superseded).toBe(1);
    expect(moved.summary?.applied.opened).toBe(1);

    const stored = await repository.loadClassifications({
      taxonomyId: SP500_SECTOR_TAXONOMY_ID,
    });

    const exxonRows = stored.filter((row) => row.subjectId === EXXON);

    expect(exxonRows).toHaveLength(2);
    // La vieja queda superseded y no cerrada: la fuente nunca dijo desde cuándo.
    const superseded = exxonRows.find((row) => row.supersededAt !== null);

    expect(superseded?.code).toBe("energy");
    expect(superseded?.validTo).toBeNull();
    expect(superseded?.supersededAt).toBe(PIN_B.committedAt);
  });
});
