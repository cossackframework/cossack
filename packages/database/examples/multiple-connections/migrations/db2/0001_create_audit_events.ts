import type { Migration } from "../../../../src/index.js";

export default {
  name: "0001_create_audit_events",

  up({ orm, schema }) {
    const auditEvents = orm.schema().entities.find(
      (entity) => entity.modelName === "AuditEvent",
    );
    if (!auditEvents) {
      throw new Error("AuditEvent metadata is not registered in db2.");
    }
    schema.createTable(auditEvents);
  },

  down({ schema }) {
    schema.dropTable("audit_events");
  },
} satisfies Migration;
