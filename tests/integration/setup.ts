if (!process.env.DATABASE_TEST_URL?.trim()) {
  throw new Error(
    "DATABASE_TEST_URL is required and must target a dedicated PostgreSQL test database.",
  );
}
