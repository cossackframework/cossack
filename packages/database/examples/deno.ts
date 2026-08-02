import { createORM } from "@cossackframework/database";
import { deno, type InjectedDenoDriver } from "@cossackframework/database/deno";

declare const driver: InjectedDenoDriver;

const orm = createORM({
  adapter: deno(driver),
  entities: [],
});

await orm.run(async () => {
  await orm.sql`SELECT 1`;
});
