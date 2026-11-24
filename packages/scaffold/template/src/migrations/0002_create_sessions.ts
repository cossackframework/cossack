import { sql, type Migration } from '@cossackframework/database';

// Sessions, and the single-use tokens kept beside them: `kind` says which a row is. A row the
// database session store makes (flash messages, `session()` data) names no kind and is `data`.
// `public_id` names a session without its token; `second_factor` records a two-step sign-in; `parent_id` links a tenant's session to
// the main one it came from.
const up = [
  sql.fragment`
    CREATE TABLE sessions (
      id VARCHAR(191) PRIMARY KEY,
      user_id VARCHAR(191),
      kind VARCHAR(32) NOT NULL DEFAULT 'data',
      public_id VARCHAR(36),
      parent_id VARCHAR(191),
      second_factor BOOLEAN NOT NULL DEFAULT FALSE,
      data ${sql.type('json')},
      meta ${sql.type('json')},
      location TEXT,
      user_agent TEXT,
      ip_address TEXT,
      created_at VARCHAR(32) NOT NULL DEFAULT '',
      expires_at VARCHAR(32) NOT NULL
    )
  `,
  sql.fragment`CREATE UNIQUE INDEX sessions_public_id_unique ON sessions (public_id)`,
  sql.fragment`CREATE INDEX sessions_parent_id ON sessions (parent_id)`,
  sql.fragment`CREATE INDEX sessions_user_id_kind ON sessions (user_id, kind)`,
];

export default {
  name: '0002_create_sessions',
  // Operations are authoritative for read-only plans and migration execution.
  operations: {
    up,
    down: [
      { kind: 'drop-table', tableName: 'sessions' },
    ],
  },
  up({ schema }) {
    for (const statement of up) schema.raw(statement);
  },
  down({ schema }) {
    schema.dropTable('sessions');
  },
} satisfies Migration;
