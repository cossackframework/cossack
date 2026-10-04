import type { Migration } from '@cossackframework/database';

export default {
  name: '0008_add_session_public_id',
  up({ orm, schema }) {
    // Nullable for reset/OAuth records and existing auth sessions. The app
    // assigns legacy auth references conditionally when they are first listed.
    schema.raw(orm.sql.unsafe('ALTER TABLE sessions ADD COLUMN public_id VARCHAR(36)'));
    schema.raw(orm.sql.unsafe('CREATE UNIQUE INDEX sessions_public_id_unique ON sessions (public_id)'));
  },
  down({ orm, schema }) {
    schema.raw(orm.sql.unsafe(orm.driver.dialect === 'mysql'
      ? 'DROP INDEX sessions_public_id_unique ON sessions'
      : 'DROP INDEX sessions_public_id_unique'));
    schema.dropColumn('sessions', 'public_id');
  },
} satisfies Migration;
