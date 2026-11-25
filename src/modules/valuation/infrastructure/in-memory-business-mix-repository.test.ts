import { describeBusinessMixRepositoryContract } from "../application/business-mix-repository.contract";

import { createInMemoryBusinessMixRepository } from "./in-memory-business-mix-repository";

describeBusinessMixRepositoryContract("in-memory", {
  createRepository: () => createInMemoryBusinessMixRepository(),
});
