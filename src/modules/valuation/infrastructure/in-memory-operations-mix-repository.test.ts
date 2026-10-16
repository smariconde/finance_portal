import { describeOperationsMixRepositoryContract } from "../application/operations-mix-repository.contract";

import { createInMemoryOperationsMixRepository } from "./in-memory-operations-mix-repository";

describeOperationsMixRepositoryContract("in-memory", {
  createRepository: () => createInMemoryOperationsMixRepository(),
});
