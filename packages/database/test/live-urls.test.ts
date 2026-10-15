import { describe, expect, it } from "vitest";
import { liveDatabaseUrls } from "./live-urls.js";

const postgres = "postgres://cossack:cossack@127.0.0.1:5432/cossack_test";
const mysql = "mysql://root:cossack@127.0.0.1:3306/cossack_test";

describe("live database URLs", () => {
  it("returns undefined for unset URLs so the live tests skip", () => {
    expect(liveDatabaseUrls({})).toEqual({ postgres: undefined, mysql: undefined });
    expect(liveDatabaseUrls({ COSSACK_TEST_POSTGRES_URL: "", COSSACK_TEST_MYSQL_URL: mysql }))
      .toEqual({ postgres: undefined, mysql });
  });

  it("fails instead of skipping when COSSACK_TEST_REQUIRE_LIVE=1 and a URL is missing", () => {
    expect(() => liveDatabaseUrls({ COSSACK_TEST_REQUIRE_LIVE: "1" }))
      .toThrow("requires COSSACK_TEST_POSTGRES_URL and COSSACK_TEST_MYSQL_URL");
    expect(() => liveDatabaseUrls({ COSSACK_TEST_REQUIRE_LIVE: "1", COSSACK_TEST_POSTGRES_URL: postgres }))
      .toThrow("requires COSSACK_TEST_MYSQL_URL:");
    expect(liveDatabaseUrls({
      COSSACK_TEST_REQUIRE_LIVE: "1",
      COSSACK_TEST_POSTGRES_URL: postgres,
      COSSACK_TEST_MYSQL_URL: mysql,
    })).toEqual({ postgres, mysql });
  });
});
