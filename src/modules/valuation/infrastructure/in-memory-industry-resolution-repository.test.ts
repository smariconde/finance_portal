import { describeIndustryResolutionRepositoryContract } from "../application/industry-resolution-repository.contract";

import { createInMemoryIndustryResolutionRepository } from "./in-memory-industry-resolution-repository";

describeIndustryResolutionRepositoryContract("in-memory", {
  createRepository: () => createInMemoryIndustryResolutionRepository(),
});
