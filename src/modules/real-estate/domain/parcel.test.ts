import { describe, expect, it } from "vitest";

import { SUBDIVIDED_PARCEL } from "../infrastructure/synthetic-listings";
import {
  ParcelVersionError,
  parcelVersionAt,
  planParcelCorrection,
  planParcelMerge,
  planParcelSubdivision,
  type ParcelVersion,
} from "./parcel";

const { parcel, successors, effectiveOn, observedAt } = SUBDIVIDED_PARCEL;
const subdivide = () =>
  planParcelSubdivision({
    parcel,
    successors,
    effectiveOn,
    sourceId: "synthetic-cadastre",
    observedAt,
  });

/** Aplica el plan sobre las versiones como lo haría el repositorio. */
function applied(): ParcelVersion[] {
  const plan = subdivide();
  const closed = plan.close.map((close) => ({
    ...parcel,
    validTo: close.validTo,
    endedBy: close.endedBy,
    closedObservedAt: close.closedObservedAt,
  }));
  return [...closed, ...plan.open];
}

describe("re-parcel-1.0.0", () => {
  it("closes the subdivided parcel and opens its successors with their lineage", () => {
    const plan = subdivide();
    expect(plan.close).toEqual([
      {
        parcelId: parcel.parcelId,
        version: 1,
        validTo: "2026-03-01",
        endedBy: "subdivision",
        closedObservedAt: observedAt,
      },
    ]);
    expect(
      plan.open.map((version) => [version.version, version.validFrom]),
    ).toEqual([
      [1, "2026-03-01"],
      [1, "2026-03-01"],
    ]);
    expect(plan.lineage.map((link) => link.successorParcelId)).toEqual(
      successors.map((successor) => successor.parcelId),
    );
  });

  it("reads the parcel as it was known: no subdivision before it was observed", () => {
    const all = applied();
    const versions = all.filter(
      (version) => version.parcelId === parcel.parcelId,
    );
    expect(() =>
      parcelVersionAt(all, { effectiveOn, knownAt: observedAt }),
    ).toThrow(new ParcelVersionError("versions_of_several_parcels"));
    const before = parcelVersionAt(versions, {
      effectiveOn: "2026-03-15",
      knownAt: "2026-04-01T00:00:00.000Z",
    });
    expect(before?.parcelId).toBe(parcel.parcelId);
    expect(before?.validTo).toBe("2026-03-01");
    expect(
      parcelVersionAt(versions, {
        effectiveOn: "2026-03-15",
        knownAt: "2026-04-10T12:00:00.000Z",
      }),
    ).toBeNull();
    expect(
      parcelVersionAt(versions, {
        effectiveOn: "2026-02-28",
        knownAt: "2026-04-10T12:00:00.000Z",
      })?.parcelId,
    ).toBe(parcel.parcelId);
    const successor = parcelVersionAt(
      all.filter((version) => version.parcelId === successors[0].parcelId),
      { effectiveOn: "2026-03-15", knownAt: "2026-05-01T00:00:00.000Z" },
    );
    expect(successor?.landAreaM2).toBe("300");
  });

  it("never creates land in a subdivision and needs two successors", () => {
    expect(() =>
      planParcelSubdivision({
        parcel,
        successors: [successors[0], { ...successors[1], landAreaM2: "320" }],
        effectiveOn,
        sourceId: "synthetic-cadastre",
        observedAt,
      }),
    ).toThrow(new ParcelVersionError("subdivision_exceeds_parcel"));
    expect(() =>
      planParcelSubdivision({
        parcel,
        successors: [successors[0]],
        effectiveOn,
        sourceId: "synthetic-cadastre",
        observedAt,
      }),
    ).toThrow(new ParcelVersionError("too_few_successors"));
    expect(() =>
      planParcelSubdivision({
        parcel,
        successors: [successors[0], successors[0]],
        effectiveOn,
        sourceId: "synthetic-cadastre",
        observedAt,
      }),
    ).toThrow(new ParcelVersionError("parcel_repeated"));
  });

  it("refuses a closed version, an effective date not after it and a missing nomenclature", () => {
    const [closed] = applied();
    expect(() =>
      planParcelCorrection({
        parcel: closed!,
        nomenclature: parcel.nomenclature,
        landAreaM2: "600",
        effectiveOn: "2026-06-01",
        sourceId: "synthetic-cadastre",
        observedAt: "2026-06-02T00:00:00.000Z",
      }),
    ).toThrow(new ParcelVersionError("version_not_open"));
    expect(() =>
      planParcelCorrection({
        parcel,
        nomenclature: parcel.nomenclature,
        landAreaM2: "600",
        effectiveOn: parcel.validFrom,
        sourceId: "synthetic-cadastre",
        observedAt,
      }),
    ).toThrow(new ParcelVersionError("effective_not_after_valid_from"));
    expect(() =>
      planParcelCorrection({
        parcel,
        nomenclature: { provincial: null, municipal: null },
        landAreaM2: null,
        effectiveOn,
        sourceId: "synthetic-cadastre",
        observedAt,
      }),
    ).toThrow(new ParcelVersionError("nomenclature_missing"));
    expect(() =>
      planParcelCorrection({
        parcel,
        nomenclature: { provincial: "11-01", municipal: null },
        landAreaM2: null,
        effectiveOn,
        sourceId: "synthetic-cadastre",
        observedAt,
      }),
    ).toThrow(new ParcelVersionError("nomenclature_invalid"));
  });

  it("corrects a parcel into its next version and merges two into one", () => {
    const correction = planParcelCorrection({
      parcel,
      nomenclature: parcel.nomenclature,
      landAreaM2: "598.5",
      effectiveOn,
      sourceId: "synthetic-cadastre",
      observedAt,
    });
    expect(correction.open[0]).toMatchObject({
      parcelId: parcel.parcelId,
      version: 2,
      landAreaM2: "598.5",
    });
    expect(correction.lineage).toEqual([]);

    const [a, b] = subdivide().open;
    const merge = planParcelMerge({
      parcels: [a!, b!],
      successor: {
        parcelId: "00000000-0000-4000-8000-0000000000a4",
        nomenclature: { provincial: null, municipal: "99-99-001-004" },
        landAreaM2: "590",
      },
      effectiveOn: "2026-09-01",
      sourceId: "synthetic-cadastre",
      observedAt: "2026-09-05T00:00:00.000Z",
    });
    expect(merge.close.map((close) => close.endedBy)).toEqual([
      "merge",
      "merge",
    ]);
    expect(merge.lineage).toHaveLength(2);
    expect(() =>
      planParcelMerge({
        parcels: [a!, b!],
        successor: {
          parcelId: "00000000-0000-4000-8000-0000000000a4",
          nomenclature: { provincial: null, municipal: "99-99-001-004" },
          landAreaM2: "700",
        },
        effectiveOn: "2026-09-01",
        sourceId: "synthetic-cadastre",
        observedAt: "2026-09-05T00:00:00.000Z",
      }),
    ).toThrow(new ParcelVersionError("merge_exceeds_parcels"));
  });
});
