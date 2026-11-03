"use server";

import { after } from "next/server";
import { z } from "zod";

import type { ArgentinaRefreshStatus } from "@/modules/argentina-dashboard/application/argentina-refresh";
import { servesRealData } from "@/modules/configuration/domain/config-health";
import { getRequestConfigHealth } from "@/server/config/app-environment";
import {
  ensureArgentinaRefreshForRequest,
  startArgentinaRefreshWorker,
} from "@/server/jobs/argentina-refresh";

const refreshRequestSchema = z
  .object({
    retryFailures: z.boolean(),
  })
  .strict();

export type ArgentinaRefreshResult =
  | ArgentinaRefreshStatus
  /** Locked runtime, invalid request or database down: no detail (`TM-02`). */
  | { readonly state: "unavailable" };

/**
 * Brings the series of `/argentina` up to date (`F9-12`,
 * [ADR 0070](../../../docs/architecture/adr/0070-argentina-refresh-on-open.md)).
 *
 * Treated as a public endpoint even though only the page calls it (`TM-03`):
 *
 * - the mode is resolved in the request and a locked runtime opens no database;
 * - the input is one boolean under a closed schema: no series, URL or date;
 *   what to ask for is decided on the server from the declared sets;
 * - every request goes through the metered egress with its quota and kill
 *   switch (ADR 0020), and each source's lease keeps two refreshes apart;
 * - the answer is counts, source labels and codes; no error message leaves.
 *
 * Next.js already refuses an action whose `Origin` does not match the host.
 */
export async function refreshArgentinaData(
  input: unknown,
): Promise<ArgentinaRefreshResult> {
  const health = await getRequestConfigHealth();
  if (!servesRealData(health)) return { state: "unavailable" };

  const request = refreshRequestSchema.safeParse(input);
  if (!request.success) return { state: "unavailable" };

  try {
    const result = await ensureArgentinaRefreshForRequest(request.data);
    if (result.runWorker) {
      // After answering: the page does not wait for the download, it asks
      // again with this same action.
      after(() => startArgentinaRefreshWorker());
    }
    return result.status;
  } catch (error) {
    // Only the type: the message may carry a host, a port or SQL (`TM-02`).
    console.error(
      "argentina refresh failed",
      error instanceof Error ? error.name : typeof error,
    );
    return { state: "unavailable" };
  }
}
