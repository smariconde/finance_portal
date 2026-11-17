"use client";

import { useEffect } from "react";

import { recordArgentinaVisit } from "../actions";

/**
 * Records the view after the page is shown (ADR 0079): the render only reads
 * the previous visit. It records again each time the page is re-read with a
 * new cutoff —after a refresh brings data—, so what the owner already saw in
 * this session is not new next time. A prefetch never runs it.
 */
export function VisitRecorder({ readAt }: { readonly readAt: string }) {
  useEffect(() => {
    void recordArgentinaVisit().catch(() => undefined);
  }, [readAt]);
  return null;
}
