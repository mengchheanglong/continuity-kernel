import { randomUUID } from "node:crypto";

import { DBOSClient } from "@dbos-inc/dbos-sdk";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  APP_VERSION,
  SYSTEM_DATABASE_URL,
  launchIncumbent,
  shutdownIncumbent,
  submitCommand,
} from "../src/incumbent/dbos.js";
import {
  cancelledRequest,
  completedProjectionDigest,
  completedRequest,
  createAdminSql,
  fixture,
  readDomainCounts,
  readDomainState,
  resetSyntheticFixture,
} from "./db-fixture.js";

const admin = createAdminSql("continuity-kernel-dbos-test-admin");
const system = postgres(SYSTEM_DATABASE_URL, { max: 1, prepare: false });
let client: DBOSClient;
const id = (label: string) => `t2:${label}:${randomUUID()}`;

beforeAll(async () => {
  await launchIncumbent();
  client = await DBOSClient.create({ systemDatabaseUrl: SYSTEM_DATABASE_URL });
});
beforeEach(() => resetSyntheticFixture(admin));
afterAll(async () => {
  await client.destroy();
  await shutdownIncumbent();
  await Promise.all([admin.end(), system.end()]);
});

async function scanDatabase(sql: postgres.Sql, sentinel: string): Promise<string[]> {
  const columns = await sql<{ schema: string; table: string; column: string }[]>`
    SELECT n.nspname AS schema, c.relname AS table, a.attname AS column
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
    WHERE c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND t.typname IN ('text', 'varchar', 'bpchar', 'json', 'jsonb')
  `;
  const hits: string[] = [];
  for (const column of columns) {
    const rows = await sql<{ hit: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM ${sql(column.schema)}.${sql(column.table)}
        WHERE ${sql(column.column)}::text LIKE ${`%${sentinel}%`}
      ) AS hit
    `;
    if (rows[0]?.hit === true) hits.push(`${column.schema}.${column.table}.${column.column}`);
  }
  return hits;
}

describe.sequential("DBOS incumbent core", () => {
  it("returns one stored outcome for duplicate workflow ID and identical request", async () => {
    const commandId = id("same-request");
    const [first, second] = await Promise.all([
      submitCommand(commandId, completedRequest),
      submitCommand(commandId, completedRequest),
    ]);
    expect(second).toEqual(first);
    expect(first).toMatchObject({ status: "accepted", code: "ACCEPTED", requestHash: "jljXJ06ZwCvDlsi7xir-PQNKFu-BYIZFllNuL9yTuHY" });
    expect(await readDomainCounts(admin)).toEqual({ receipts: 1, acceptedHistory: 1 });
  });

  it("checks request equality at the boundary when DBOS returns an existing handle", async () => {
    const commandId = id("different-request");
    await submitCommand(commandId, completedRequest);
    const mismatch = await submitCommand(commandId, cancelledRequest);
    expect(mismatch).toMatchObject({ status: "rejected", code: "IDEMPOTENCY_KEY_REUSED", commandId });
    expect(await readDomainCounts(admin)).toEqual({ receipts: 1, acceptedHistory: 1 });
    expect((await readDomainState(admin)).commitmentStatus).toBe("completed");
  });

  it("cannot bypass the domain receipt with a new workflow ID, fork, or deleted workflow history", async () => {
    const commandId = id("management");
    const originalWorkflowId = id("original-workflow");
    const original = await submitCommand(commandId, completedRequest, originalWorkflowId);
    const replay = await submitCommand(commandId, completedRequest, id("new-workflow"));
    expect(replay).toEqual(original);

    const steps = await client.listWorkflowSteps(originalWorkflowId);
    expect(steps?.length).toBeGreaterThan(0);
    const firstStep = steps?.[0];
    if (firstStep === undefined) throw new Error("DBOS recorded no datasource step");
    const forkId = id("fork");
    await client.forkWorkflow(originalWorkflowId, firstStep.functionID, {
      newWorkflowID: forkId,
      applicationVersion: APP_VERSION,
    });
    expect(await client.retrieveWorkflow(forkId).getResult()).toEqual(original);

    await client.deleteWorkflow(originalWorkflowId, true);
    expect(await submitCommand(commandId, completedRequest, originalWorkflowId)).toEqual(original);
    expect(await readDomainCounts(admin)).toEqual({ receipts: 1, acceptedHistory: 1 });
  });

  it("runs distinct expected-version commands without a queue and returns one conflict", async () => {
    const outcomes = await Promise.all([
      submitCommand(id("race-completed"), completedRequest),
      submitCommand(id("race-cancelled"), cancelledRequest),
    ]);
    expect(outcomes.filter((x) => x.status === "accepted")).toHaveLength(1);
    expect(outcomes.filter((x) => x.code === "EXPECTED_VERSION_CONFLICT")).toHaveLength(1);
    expect(await readDomainCounts(admin)).toEqual({ receipts: 2, acceptedHistory: 1 });
  });

  it("records the pinned application version and terminal status explicitly", async () => {
    const workflowId = id("version");
    await submitCommand(workflowId, completedRequest);
    const status = await client.getWorkflow(workflowId);
    expect(status).toMatchObject({ status: "SUCCESS", applicationVersion: APP_VERSION });
  });

  it("erases optional bytes while durable DBOS/domain surfaces retain only PayloadRef", async () => {
    const sentinel = `SENTINEL-${randomUUID()}`;
    await admin.unsafe("CREATE SCHEMA IF NOT EXISTS deletable_payload");
    await admin.unsafe("CREATE TABLE IF NOT EXISTS deletable_payload.objects (payload_ref text PRIMARY KEY, body text NOT NULL)");
    await admin`INSERT INTO deletable_payload.objects (payload_ref, body) VALUES (${fixture.payloadRef}, ${sentinel}) ON CONFLICT (payload_ref) DO UPDATE SET body=EXCLUDED.body`;

    const result = await submitCommand(id("erasure"), completedRequest);
    await admin`DELETE FROM deletable_payload.objects WHERE payload_ref=${fixture.payloadRef}`;

    expect(JSON.stringify(result)).not.toContain(sentinel);
    expect(await scanDatabase(admin, sentinel)).toEqual([]);
    expect(await scanDatabase(system, sentinel)).toEqual([]);
    expect(result).toMatchObject({ payloadRef: fixture.payloadRef, projectionDigest: completedProjectionDigest });
    expect(await readDomainCounts(admin)).toEqual({ receipts: 1, acceptedHistory: 1 });
  });
});
