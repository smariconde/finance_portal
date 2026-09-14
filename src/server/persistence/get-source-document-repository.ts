import "server-only";

import { getConfigHealth } from "@/modules/configuration/domain/config-health";
import {
  selectSourceDocumentRepository,
  type SourceDocumentRepository,
} from "@/modules/observations/application/source-document-repository";
import { createPostgresSourceDocumentRepository } from "@/server/db/postgres-source-document-repository";
import { getRuntimeDatabase } from "@/server/db/runtime-client";

let repository: SourceDocumentRepository | undefined;

export function getSourceDocumentRepository(): SourceDocumentRepository {
  if (repository) {
    return repository;
  }

  const effectiveMode = getConfigHealth(process.env).mode;
  repository = selectSourceDocumentRepository(effectiveMode, {
    personal: () =>
      createPostgresSourceDocumentRepository(getRuntimeDatabase()),
  });

  return repository;
}
