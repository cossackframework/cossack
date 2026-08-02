import { MigrationRunner } from "../../src/index.js";
import { createConnections, resetConnectionFiles } from "./database.js";
import { db1Migrations } from "./migrations/db1/index.js";
import { db2Migrations } from "./migrations/db2/index.js";
import { AuditEvent, User } from "./models/index.js";

if (process.argv.includes("--reset")) {
  await resetConnectionFiles();
}

const databases = await createConnections();

try {
  console.log("1/3 Migrating db1 and db2...");
  const [db1Applied, db2Applied] = await Promise.all([
    new MigrationRunner(databases.db1, db1Migrations).up(),
    new MigrationRunner(databases.db2, db2Migrations).up(),
  ]);
  console.log(`db1: ${db1Applied.join(", ") || "already current"}`);
  console.log(`db2: ${db2Applied.join(", ") || "already current"}`);

  console.log("\n2/3 Seeding each connection independently...");
  await databases.db1.transaction(async () => {
    await databases.db1.model(User).upsert([
      { email: "ada@example.com", name: "Ada Lovelace" },
      { email: "grace@example.com", name: "Grace Hopper" },
    ], ["email"]);
  });

  // This is a separate transaction. It is not a distributed transaction with
  // the db1 write above.
  await databases.db2.transaction(async () => {
    await databases.db2.model(AuditEvent).upsert([
      {
        eventKey: "ada-signed-in",
        userEmail: "ada@example.com",
        action: "signed_in",
      },
      {
        eventKey: "grace-published",
        userEmail: "grace@example.com",
        action: "published_post",
      },
    ], ["eventKey"]);
  });

  console.log("\n3/3 Querying both connections concurrently...");
  const [users, events] = await Promise.all([
    databases.db1.model(User).find({ order: { name: "asc" } }),
    databases.db2.model(AuditEvent).find({ order: { eventKey: "asc" } }),
  ]);

  const usersByEmail = new Map(users.map((user) => [user.email, user]));

  console.log("\ndb1 users");
  console.log("=========");
  for (const user of users) {
    console.log(`${user.name} <${user.email}>`);
  }

  console.log("\ndb2 audit events (joined in application code)");
  console.log("=============================================");
  for (const event of events) {
    const user = usersByEmail.get(event.userEmail);
    console.log(`${event.action} — ${user?.name ?? event.userEmail}`);
  }

  console.log(`\nTotals: ${users.length} users in db1, ${events.length} events in db2`);
} finally {
  await Promise.all([
    databases.db1.close(),
    databases.db2.close(),
  ]);
}
