import * as restate from "@restatedev/restate-sdk";
import postgres from "postgres";

import { canonicalHash } from "../../domain/canonical.js";
import { canonicalRequestHash, parseCommitInput, RequestValidationError } from "../../domain/request.js";

interface CommitResult {
  status: "accepted" | "rejected";
  code: string;
  commandId: string;
  requestHash: string;
  projection?: unknown;
  projectionDigest?: string;
  [key: string]: unknown;
}

const app = postgres({
  host: "127.0.0.1",
  port: 55432,
  database: "continuity_app_db",
  user: "continuity_app",
  password: "continuity_app",
  max: 4,
  prepare: false,
  connection: { application_name: "continuity-kernel-restate" },
});

function signal(phase: string): void {
  process.send?.({ type: "phase", phase });
}

const block = (): Promise<never> => new Promise(() => undefined);

function waitForContinue(): Promise<void> {
  return new Promise((resolve) => {
    const receive = (value: unknown) => {
      if ((value as { type?: string }).type === "continue") {
        process.off("message", receive);
        resolve();
      }
    };
    process.on("message", receive);
  });
}

function postgresCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

async function commit(commandId: string, requestHash: string, request: unknown, validatorVersion: number, projectionSchemaVersion: number): Promise<CommitResult> {
  for (let attempt = 1; attempt <= 5 || process.env.CK_FAILPOINT === "retry_forever"; attempt += 1) {
    if (process.env.CK_FAILPOINT === "retry_forever" || process.env.CK_FAILPOINT === "snapshot_barrier") process.send?.({ type: "attempt", vector: "V3", count: attempt });
    try {
      return await app.begin("isolation level serializable", async (sql) => {
        const failpoint = process.env.CK_FAILPOINT;
        if (failpoint === "after_write" || failpoint === "retry_forever" || (failpoint === "snapshot_barrier" && attempt === 1)) {
          await sql`SELECT pg_catalog.set_config('continuity.test_failpoint', ${failpoint}, true)`;
        }
        const rows = await sql<{ result: CommitResult }[]>`
          SELECT continuity.commit_command(
            ${commandId}, ${requestHash}, ${sql.json(request as never)}, ${validatorVersion}, ${projectionSchemaVersion}
          ) AS result
        `;
        const result = rows[0]?.result;
        if (result === undefined) throw new Error("Canonical commit returned no result");
        return result.projection === undefined
          ? result
          : { ...result, projectionDigest: canonicalHash(result.projection) };
      });
    } catch (error) {
      if (postgresCode(error) !== "40001") throw error;
      if (attempt === 5 && process.env.CK_FAILPOINT !== "retry_forever") throw new restate.TerminalError("Serializable transaction retry limit exceeded");
    }
  }
  throw new Error("Serializable retry loop ended without a result");
}

const workflow = restate.workflow({
  name: "ContinuityCommitT2bV1",
  handlers: {
    run: async (ctx: restate.WorkflowContext, input: unknown): Promise<CommitResult> => {
      let validated: ReturnType<typeof parseCommitInput>, requestHash: string;
      try { validated = parseCommitInput(input); requestHash = canonicalRequestHash(validated.request); } catch (error) {
        if (!(error instanceof RequestValidationError)) throw error;
        throw new restate.TerminalError(error.code, { errorCode: 400 });
      }
      return ctx.run("canonical commit", async () => {
        const failpoint = process.env.CK_FAILPOINT;
        if (failpoint === "before_transaction" || failpoint === "before_recovery") {
          signal(failpoint);
          await waitForContinue();
        }
        const result = await commit(validated.commandId, requestHash, validated.request,
          validated.validatorVersion, validated.projectionSchemaVersion);
        if (failpoint === "after_commit") {
          signal("after_commit");
          await block();
        }
        return result;
      }, { maxRetryAttempts: 4, initialRetryInterval: 50, maxRetryInterval: 500 });
    },
  },
});

export async function launchRestate(): Promise<void> {
  await restate.serve({
    services: [workflow],
    port: 9080,
  });
}
