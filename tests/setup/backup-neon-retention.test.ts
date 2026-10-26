import { describe, expect, it } from "vitest";

import { expiredBackupManifests } from "../../scripts/backup-neon-retention";

describe("Neon backup retention", () => {
  it("keeps the last 30 days and at least two archives", () => {
    const now = Date.parse("2026-11-30T12:00:00Z");
    expect(
      expiredBackupManifests(
        [
          { name: "new", createdAt: "2026-11-30T00:00:00Z" },
          { name: "oldest", createdAt: "2026-09-01T00:00:00Z" },
          { name: "old", createdAt: "2026-10-01T00:00:00Z" },
          { name: "recent", createdAt: "2026-11-15T00:00:00Z" },
        ],
        now,
      ),
    ).toEqual(["oldest", "old"]);

    expect(
      expiredBackupManifests(
        [
          { name: "one", createdAt: "2026-01-01T00:00:00Z" },
          { name: "two", createdAt: "2026-02-01T00:00:00Z" },
        ],
        now,
      ),
    ).toEqual([]);
  });

  it("does not select malformed timestamps for deletion", () => {
    expect(
      expiredBackupManifests(
        [
          { name: "corrupt", createdAt: "not a date" },
          { name: "old", createdAt: "2026-01-01T00:00:00Z" },
          { name: "new", createdAt: "2026-11-30T00:00:00Z" },
        ],
        Date.parse("2026-11-30T12:00:00Z"),
      ),
    ).toEqual([]);
  });
});
