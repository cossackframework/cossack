import type { Migration } from "../../../../src/index.js";

export default {
  name: "0001_create_users",

  up({ orm, schema }) {
    const users = orm.schema().entities.find(
      (entity) => entity.modelName === "User",
    );
    if (!users) throw new Error("User metadata is not registered in db1.");
    schema.createTable(users);
  },

  down({ schema }) {
    schema.dropTable("users");
  },
} satisfies Migration;
