import { sql, type Migration } from '@cossackframework/database';

// Two-step sign-in, passkeys and sign-in limits: a session records whether it used a second
// factor, and four tables keep authenticators, passkeys, pending sign-in steps and counters.
export default {
  name: '0009_create_account_security',
  // Operations are authoritative for read-only plans and migration execution.
  operations: {
    up: [
      sql.unsafe('ALTER TABLE sessions ADD COLUMN second_factor BOOLEAN NOT NULL DEFAULT FALSE'),
      sql.unsafe(`
      CREATE TABLE user_security (
        user_id VARCHAR(191) PRIMARY KEY,
        totp_secret TEXT,
        totp_confirmed_at VARCHAR(32),
        totp_last_step INTEGER,
        recovery TEXT,
        updated_at VARCHAR(32) NOT NULL
      )
    `),
      sql.unsafe(`
      CREATE TABLE passkeys (
        id VARCHAR(191) PRIMARY KEY,
        user_id VARCHAR(191) NOT NULL,
        name TEXT NOT NULL,
        public_key TEXT NOT NULL,
        sign_count INTEGER NOT NULL,
        transports TEXT,
        device_type TEXT,
        backed_up BOOLEAN NOT NULL,
        created_at VARCHAR(32) NOT NULL,
        last_used_at VARCHAR(32)
      )
    `),
      sql.unsafe(`
      CREATE TABLE auth_challenges (
        id VARCHAR(191) PRIMARY KEY,
        kind VARCHAR(32) NOT NULL,
        user_id VARCHAR(191),
        challenge TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        expires_at VARCHAR(32) NOT NULL
      )
    `),
      sql.unsafe(`
      CREATE TABLE auth_attempts (
        id VARCHAR(191) PRIMARY KEY,
        attempts INTEGER NOT NULL,
        expires_at VARCHAR(32) NOT NULL
      )
    `),
      sql.unsafe('CREATE INDEX passkeys_user_id ON passkeys (user_id)'),
    ],
    down: [
      { kind: 'drop-table', tableName: 'auth_attempts' },
      { kind: 'drop-table', tableName: 'auth_challenges' },
      { kind: 'drop-table', tableName: 'passkeys' },
      { kind: 'drop-table', tableName: 'user_security' },
      { kind: 'drop-column', tableName: 'sessions', columnName: 'second_factor' },
    ],
  },
  up({ orm, schema }) {
    schema.raw(orm.sql.unsafe('ALTER TABLE sessions ADD COLUMN second_factor BOOLEAN NOT NULL DEFAULT FALSE'));
    schema.raw(orm.sql.unsafe(`
      CREATE TABLE user_security (
        user_id VARCHAR(191) PRIMARY KEY,
        totp_secret TEXT,
        totp_confirmed_at VARCHAR(32),
        totp_last_step INTEGER,
        recovery TEXT,
        updated_at VARCHAR(32) NOT NULL
      )
    `));
    schema.raw(orm.sql.unsafe(`
      CREATE TABLE passkeys (
        id VARCHAR(191) PRIMARY KEY,
        user_id VARCHAR(191) NOT NULL,
        name TEXT NOT NULL,
        public_key TEXT NOT NULL,
        sign_count INTEGER NOT NULL,
        transports TEXT,
        device_type TEXT,
        backed_up BOOLEAN NOT NULL,
        created_at VARCHAR(32) NOT NULL,
        last_used_at VARCHAR(32)
      )
    `));
    schema.raw(orm.sql.unsafe(`
      CREATE TABLE auth_challenges (
        id VARCHAR(191) PRIMARY KEY,
        kind VARCHAR(32) NOT NULL,
        user_id VARCHAR(191),
        challenge TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        expires_at VARCHAR(32) NOT NULL
      )
    `));
    schema.raw(orm.sql.unsafe(`
      CREATE TABLE auth_attempts (
        id VARCHAR(191) PRIMARY KEY,
        attempts INTEGER NOT NULL,
        expires_at VARCHAR(32) NOT NULL
      )
    `));
    schema.raw(orm.sql.unsafe('CREATE INDEX passkeys_user_id ON passkeys (user_id)'));
  },
  down({ schema }) {
    schema.dropTable('auth_attempts');
    schema.dropTable('auth_challenges');
    schema.dropTable('passkeys');
    schema.dropTable('user_security');
    schema.dropColumn('sessions', 'second_factor');
  },
} satisfies Migration;
