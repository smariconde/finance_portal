import { CircleAlert } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { readForwardMultiplesForRender } from "@/server/jobs/consensus-refresh";

import { ForwardPe } from "./forward-pe";

/**
 * The forward P/E card, read on its own (ADR 0083): a failure here leaves the
 * valuation standing and says so in one line.
 */
export async function ForwardPeSection({
  ticker,
  subject,
  trailingMedian,
}: {
  readonly ticker: string;
  readonly subject: {
    readonly securityId: string;
    readonly legalEntityId: string;
  };
  readonly trailingMedian: string | null;
}) {
  let read: Awaited<ReturnType<typeof readForwardMultiplesForRender>>;
  try {
    read = await readForwardMultiplesForRender(subject);
  } catch (error) {
    // Only the type: a message can carry a host, a port or SQL (`TM-02`).
    console.error(
      "forward P/E read failed",
      error instanceof Error ? error.name : typeof error,
    );
    return (
      <p className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-muted-foreground">
        <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
        No se pudo leer el forward P/E.
      </p>
    );
  }
  return (
    <ForwardPe
      ticker={ticker}
      view={read.view}
      readiness={read.readiness}
      trailingMedian={trailingMedian}
    />
  );
}

export function ForwardPeSkeleton() {
  return <Skeleton className="h-72 w-full rounded-xl" />;
}
