import { describeEmployeeEquityRepositoryContract } from "../application/employee-equity-repository.contract";
import { createInMemoryEmployeeEquityRepository } from "./in-memory-employee-equity-repository";

describeEmployeeEquityRepositoryContract("in-memory", {
  createRepository: createInMemoryEmployeeEquityRepository,
});
