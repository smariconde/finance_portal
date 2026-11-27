import { describe, expect, it } from "vitest";

import { bookOfPosition, bookOfTrade, marketValueOf } from "./trading-book";

const TODAY = "2026-11-25";

describe("bookOfTrade", () => {
  it("is day while the trade lives inside one New York session", () => {
    expect(
      bookOfTrade(
        { status: "closed", openedSession: TODAY, closedSession: TODAY },
        TODAY,
      ),
    ).toBe("day");
    expect(
      bookOfTrade(
        { status: "open", openedSession: TODAY, closedSession: null },
        TODAY,
      ),
    ).toBe("day");
  });

  it("is swing once it spent a night, or before the history", () => {
    expect(
      bookOfTrade(
        { status: "open", openedSession: "2026-11-24", closedSession: null },
        TODAY,
      ),
    ).toBe("swing");
    expect(
      bookOfTrade(
        {
          status: "closed",
          openedSession: "2026-11-24",
          closedSession: TODAY,
        },
        TODAY,
      ),
    ).toBe("swing");
    expect(
      bookOfTrade(
        {
          status: "opened_before_history",
          openedSession: TODAY,
          closedSession: TODAY,
        },
        TODAY,
      ),
    ).toBe("swing");
  });
});

describe("bookOfTrade with a linked plan (trading-book-1.1.0)", () => {
  const today = {
    status: "open" as const,
    openedSession: TODAY,
    closedSession: null,
  };
  const overnight = {
    status: "open" as const,
    openedSession: "2026-11-24",
    closedSession: null,
  };

  it("lets a swing plan make the trade swing from its entry", () => {
    expect(bookOfTrade(today, TODAY, "swing")).toBe("swing");
    expect(
      bookOfTrade(
        { status: "closed", openedSession: TODAY, closedSession: TODAY },
        TODAY,
        "swing",
      ),
    ).toBe("swing");
  });

  it("keeps a day plan day inside the session, swing after a night", () => {
    expect(bookOfTrade(today, TODAY, "day")).toBe("day");
    expect(bookOfTrade(overnight, TODAY, "day")).toBe("swing");
  });

  it("falls back on the automatic rule without a plan", () => {
    expect(bookOfTrade(today, TODAY, null)).toBe("day");
    expect(bookOfTrade(overnight, TODAY, null)).toBe("swing");
  });
});

describe("bookOfPosition", () => {
  it("follows the journal's trade first", () => {
    expect(
      bookOfPosition({ trade: "day", previousSessionQuantity: "10" }),
    ).toBe("day");
  });

  it("falls back on Schwab's previous-session quantity, then on day", () => {
    expect(bookOfPosition({ trade: null, previousSessionQuantity: "10" })).toBe(
      "swing",
    );
    expect(bookOfPosition({ trade: null, previousSessionQuantity: "0" })).toBe(
      "day",
    );
    expect(bookOfPosition({ trade: null, previousSessionQuantity: null })).toBe(
      "day",
    );
  });
});

describe("marketValueOf", () => {
  it("adds market values exactly", () => {
    expect(
      marketValueOf([{ marketValue: "0.1" }, { marketValue: "0.2" }]),
    ).toBe("0.3");
    expect(marketValueOf([])).toBe("0");
  });
});
