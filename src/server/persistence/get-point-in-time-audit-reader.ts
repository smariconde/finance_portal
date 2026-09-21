import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import {
  selectPointInTimeAuditReader,
  type PointInTimeAuditReader,
} from "@/modules/observations/application/point-in-time-audit-reader";
import { createPostgresPointInTimeAuditReader } from "@/server/db/postgres-point-in-time-audit-reader";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let reader: PointInTimeAuditReader | undefined;

export function getPointInTimeAuditReader(): PointInTimeAuditReader {
  if (reader) {
    return reader;
  }

  const effectiveMode = getConfigHealth(process.env).mode;
  reader = selectPointInTimeAuditReader(effectiveMode, {
    personal: () => createPostgresPointInTimeAuditReader(getRuntimeDatabase()),
  });

  return reader;
}
