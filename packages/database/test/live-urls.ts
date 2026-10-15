// Connection URLs for the live PostgreSQL and MySQL runs.
//
// Each URL is undefined when its variable is unset, and the tests that need it
// skip. CI sets COSSACK_TEST_REQUIRE_LIVE=1 next to the URLs: a missing URL then
// fails the test file at import time instead of silently skipping both engines.
export interface LiveDatabaseUrls {
  readonly postgres: string | undefined;
  readonly mysql: string | undefined;
}

export function liveDatabaseUrls(env: NodeJS.ProcessEnv = process.env): LiveDatabaseUrls {
  const urls = {
    postgres: env.COSSACK_TEST_POSTGRES_URL || undefined,
    mysql: env.COSSACK_TEST_MYSQL_URL || undefined,
  };
  if (env.COSSACK_TEST_REQUIRE_LIVE === "1") {
    const missing = [
      urls.postgres ? undefined : "COSSACK_TEST_POSTGRES_URL",
      urls.mysql ? undefined : "COSSACK_TEST_MYSQL_URL",
    ].filter((name): name is string => name !== undefined);
    if (missing.length) {
      throw new Error(
        `COSSACK_TEST_REQUIRE_LIVE=1 requires ${missing.join(" and ")}: ` +
        "the live PostgreSQL and MySQL tests must run, not skip.",
      );
    }
  }
  return urls;
}
