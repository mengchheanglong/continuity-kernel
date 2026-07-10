import { readFile } from "node:fs/promises";

import postgres from "postgres";

const admin = postgres({
  host: "127.0.0.1",
  port: 55432,
  database: "postgres",
  user: "postgres",
  password: "postgres",
  max: 1,
  connect_timeout: 5,
  prepare: false,
  connection: { application_name: "continuity-kernel-db-setup" },
});

async function databaseExists(name: string): Promise<boolean> {
  const rows = await admin<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_database WHERE datname = ${name}
    ) AS exists
  `;
  return rows[0]?.exists === true;
}

async function setup(): Promise<void> {
  await admin.unsafe(`
    DO $roles$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'continuity_owner') THEN
        CREATE ROLE continuity_owner NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'continuity_app') THEN
        CREATE ROLE continuity_app LOGIN PASSWORD 'continuity_app';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'continuity_dbos') THEN
        CREATE ROLE continuity_dbos LOGIN PASSWORD 'continuity_dbos';
      END IF;
    END
    $roles$;

    ALTER ROLE continuity_owner WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
    ALTER ROLE continuity_app WITH LOGIN PASSWORD 'continuity_app' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
    ALTER ROLE continuity_dbos WITH LOGIN PASSWORD 'continuity_dbos' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
    REVOKE continuity_owner FROM continuity_app, continuity_dbos;
  `);

  if (!(await databaseExists("continuity_app_db"))) {
    await admin.unsafe("CREATE DATABASE continuity_app_db OWNER continuity_owner");
  }
  if (!(await databaseExists("continuity_sys_db"))) {
    await admin.unsafe("CREATE DATABASE continuity_sys_db OWNER continuity_dbos");
  }

  await admin.unsafe(`
    ALTER DATABASE continuity_app_db OWNER TO continuity_owner;
    ALTER DATABASE continuity_sys_db OWNER TO continuity_dbos;
    GRANT CONNECT ON DATABASE continuity_app_db TO continuity_app;
    GRANT CONNECT ON DATABASE continuity_sys_db TO continuity_dbos;
  `);

  const migration = await readFile(
    new URL("../migrations/001_continuity.sql", import.meta.url),
    "utf8",
  );
  const domainAdmin = postgres({
    host: "127.0.0.1",
    port: 55432,
    database: "continuity_app_db",
    user: "postgres",
    password: "postgres",
    max: 1,
    connect_timeout: 5,
    prepare: false,
    connection: { application_name: "continuity-kernel-domain-migration" },
  });
  try {
    await domainAdmin.begin(async (sql) => {
      await sql.unsafe("SET LOCAL ROLE continuity_owner");
      await sql.unsafe(migration);
    });
  } finally {
    await domainAdmin.end({ timeout: 5 });
  }
}

try {
  await setup();
  console.log("PostgreSQL roles, databases, and continuity migration are ready.");
} finally {
  await admin.end({ timeout: 5 });
}
