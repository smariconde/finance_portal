if (!process.env.TRADING_DATABASE_TEST_URL?.trim()) {
  throw new Error(
    "TRADING_DATABASE_TEST_URL is required and must target a dedicated PostgreSQL trading test database.",
  );
}
