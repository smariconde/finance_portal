import { describeMarketExpectationsRepositoryContract } from "../application/market-expectations-repository.contract";
import { createInMemoryMarketExpectationsRepository } from "./in-memory-market-expectations-repository";

describeMarketExpectationsRepositoryContract("in-memory", {
  createRepository: createInMemoryMarketExpectationsRepository,
});
