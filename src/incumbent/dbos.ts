import { DBOS } from "@dbos-inc/dbos-sdk";
import { IsolationLevel, PostgresDataSource } from "@dbos-inc/postgres-datasource";

import { canonicalHash } from "../domain/canonical.js";

export const APP_VERSION = "continuity-kernel-v0-t2-v1";
export const SYSTEM_DATABASE_URL =
  "postgresql://continuity_dbos:continuity_dbos@127.0.0.1:55432/continuity_sys_db";

export interface CommitResult {
  status: "accepted" | "rejected";
  code: string;
  commandId: string;
  requestHash: string;
  projection?: unknown;
  projectionDigest?: string;
  [key: string]: unknown;
}

DBOS.setConfig({
  name: "continuity-kernel-v0-benchmark",
  applicationVersion: APP_VERSION,
  systemDatabaseUrl: SYSTEM_DATABASE_URL,
  runAdminServer: false,
  enableOTLP: false,
  tracingEnabled: false,
  logLevel: "error",
});

const dataSource = new PostgresDataSource("continuity-domain", {
  host: "127.0.0.1",
  port: 55432,
  database: "continuity_app_db",
  user: "continuity_app",
  password: "continuity_app",
  max: 4,
  prepare: false,
  connection: { application_name: "continuity-kernel-datasource" },
});

const signal = (message: object): void => {
  process.send?.(message);
};
const block = (): Promise<never> => new Promise(() => undefined);

const commitTransaction = dataSource.registerTransaction(
  async (commandId: string, requestHash: string, request: unknown): Promise<CommitResult> => {
    const failpoint = process.env.CK_FAILPOINT;
    signal({ type: "attempt", count: (Number(process.env.CK_ATTEMPTS ?? 0) + 1) });
    process.env.CK_ATTEMPTS = String(Number(process.env.CK_ATTEMPTS ?? 0) + 1);
    if (failpoint === "after_write" || failpoint === "retry_forever") {
      await dataSource.client`SELECT pg_catalog.set_config('continuity.test_failpoint', ${failpoint}, true)`;
    }
    const rows = await dataSource.client<{ result: CommitResult }[]>`
      SELECT continuity.commit_command(${commandId}, ${requestHash}, ${dataSource.client.json(request as never)}, 1, 1) AS result
    `;
    const result = rows[0]?.result;
    if (result === undefined) throw new Error("Canonical commit returned no result");
    return result.projection === undefined
      ? result
      : { ...result, projectionDigest: canonicalHash(result.projection) };
  },
  { name: "commitCommand", isolationLevel: IsolationLevel.Serializable },
);

const commitWorkflow = DBOS.registerWorkflow(
  async (commandId: string, requestHash: string, request: unknown): Promise<CommitResult> => {
    if (process.env.CK_FAILPOINT === "before_transaction") {
      signal({ type: "phase", phase: "before_transaction" });
      await block();
    }
    const result = await commitTransaction(commandId, requestHash, request);
    if (process.env.CK_FAILPOINT === "after_commit") {
      signal({ type: "phase", phase: "after_commit" });
      await block();
    }
    return result;
  },
  { name: "commitCaseWorkflow" },
);

export async function launchIncumbent(): Promise<void> {
  if (!DBOS.isInitialized()) await DBOS.launch();
}

export async function shutdownIncumbent(): Promise<void> {
  if (DBOS.isInitialized()) await DBOS.shutdown();
}

export async function submitCommand(
  commandId: string,
  request: unknown,
  workflowId = commandId,
): Promise<CommitResult> {
  const requestHash = canonicalHash(request);
  const handle = await DBOS.startWorkflow(commitWorkflow, {
    workflowID: workflowId,
  })(commandId, requestHash, request);
  const result = await handle.getResult();
  return result.requestHash === requestHash
    ? result
    : { ...result, status: "rejected", code: "IDEMPOTENCY_KEY_REUSED", commandId, requestHash };
}
