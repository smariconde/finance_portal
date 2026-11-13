import { describe, expect, it } from "vitest";

import {
  parseDatabaseTarget,
  sameDatabaseTarget,
} from "@/modules/configuration/domain/database-target";

describe("parseDatabaseTarget", () => {
  it("reads host, port and database without credentials", () => {
    expect(
      parseDatabaseTarget(
        "postgresql://user:secret@127.0.0.1:55432/finance_portal_trading?sslmode=disable",
      ),
    ).toEqual({
      host: "127.0.0.1",
      port: "55432",
      database: "finance_portal_trading",
    });
  });

  it("defaults the port and folds Neon's pooler into its endpoint", () => {
    expect(
      parseDatabaseTarget(
        "postgres://u:p@EP-Cool-Term-123-pooler.us-east-1.aws.neon.tech/app",
      ),
    ).toEqual({
      host: "ep-cool-term-123.us-east-1.aws.neon.tech",
      port: "5432",
      database: "app",
    });
  });

  it.each([
    ["not a url", "sentinel-database-url-value"],
    ["another protocol", "mysql://u:p@host/db"],
    ["no database", "postgresql://u:p@host:5432/"],
    ["no host", "postgresql:///db"],
    ["a nested path", "postgresql://u:p@host/db/extra"],
  ])("rejects %s", (_, value) => {
    expect(parseDatabaseTarget(value)).toBeNull();
  });
});

describe("sameDatabaseTarget", () => {
  it("matches the same base reached by another role or the pooler", () => {
    expect(
      sameDatabaseTarget(
        "postgresql://runtime:a@ep-x-pooler.us-east-1.aws.neon.tech/db?sslmode=require",
        "postgresql://owner:b@ep-x.us-east-1.aws.neon.tech:5432/db",
      ),
    ).toBe(true);
  });

  it("tells apart two databases on the same local server", () => {
    expect(
      sameDatabaseTarget(
        "postgresql://u:p@127.0.0.1:55432/finance_portal_personal",
        "postgresql://u:p@127.0.0.1:55432/finance_portal_trading",
      ),
    ).toBe(false);
  });

  it("does not compare an unreadable url", () => {
    expect(sameDatabaseTarget("nope", "nope")).toBe(false);
  });
});
