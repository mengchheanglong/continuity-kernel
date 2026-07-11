import { fork, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import type { ActorObservationV1 } from "../src/actor/deterministic.js";
import {
  activeActorChildCount,
  clearActorChildObservation,
  stopActorChildren,
} from "./actor-child.js";
import {
  createAdminSql,
  fixture,
  resetSyntheticFixture,
  revokeGrant,
} from "./db-fixture.js";

interface ObservationAuthority {
  namespaceId: string;
  caseId: string;
  actorId: string;
  authorizationGrantId: string;
  authorizationVersion: string;
}

interface StoredReceipt {
  namespaceId: string;
  caseId: string;
  commandId: string;
  requestHash: string;
  outcomeStatus: string;
  decisionCode: string;
  authorizationVersion: string;
  caseVersion: string;
  payloadRef: string;
  projectionSchemaVersion: number;
  result: Record<string, unknown>;
}

interface AcceptedHistory {
  namespaceId: string;
  caseId: string;
  position: string;
  commandId: string;
  requestHash: string;
  actorId: string;
  authorizationGrantId: string;
  authorizationVersion: string;
  validatorVersion: number;
  actionType: string;
  payloadRef: string;
}

interface DecisionAudit {
  namespaceId: string;
  caseId: string;
  commandId: string;
  requestHash: string;
  actorId: string;
  authorizationGrantId: string;
  authorizationVersion: string;
  validatorVersion: number;
  decisionCode: string;
  payloadRef: string;
}

interface CaseState {
  namespaceId: string;
  caseId: string;
  ownerAgentId: string;
  version: string;
  status: string;
  commitmentDeadline: string | null;
  commitmentStatus: string | null;
  payloadRef: string | null;
}

interface CountEvidence {
  receipts: number;
  acceptedHistory: number;
  decisionAudits: number;
}

interface Worker {
  child: ChildProcess;
  logs: string[];
  messages: Array<{ type: string; error?: string }>;
}

export function createActorIntegrationHarness() {
  const admin = createAdminSql("continuity-kernel-t4-parent");
  const workers = new Set<Worker>();

  async function waitReady(worker: Worker): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const error = worker.messages.find((message) => message.type === "error");
      if (error !== undefined) throw new Error(error.error ?? "Worker failed");
      if (worker.messages.some((message) => message.type === "ready")) return;
      if (worker.child.exitCode !== null) {
        throw new Error(`Worker exited ${String(worker.child.exitCode)}; logs: ${worker.logs.join("")}`);
      }
      await delay(10);
    }
    throw new Error(`Worker ready timeout; logs: ${worker.logs.join("")}`);
  }

  async function waitForDatasourceExit(): Promise<void> {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const rows = await admin<{ connected: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM pg_catalog.pg_stat_activity
          WHERE application_name = 'continuity-kernel-restate'
        ) AS connected
      `;
      if (rows[0]?.connected === false) return;
      await delay(25);
    }
    throw new Error("Restate datasource backend remained after worker exit");
  }

  async function killWorker(worker: Worker): Promise<void> {
    workers.delete(worker);
    if (worker.child.exitCode === null) {
      const exited = new Promise<void>((resolve) => {
        worker.child.once("exit", () => {
          resolve();
        });
      });
      worker.child.kill("SIGKILL");
      await exited;
    }
    await waitForDatasourceExit();
  }

  return {
    async reset(): Promise<void> {
      // Data/session reset only. Worker lifecycle is owned by startWorker/stopAll so
      // multi-subcase vectors can clear fixtures without tearing down Restate.
      clearActorChildObservation();
      await stopActorChildren();
      await resetSyntheticFixture(admin);
    },

    async startWorker(): Promise<void> {
      const child = fork(new URL("./restate-worker.ts", import.meta.url), [], {
        execPath: process.execPath,
        execArgv: ["--import", "tsx"],
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      const worker: Worker = { child, logs: [], messages: [] };
      child.stdout?.on("data", (chunk: Buffer) => {
        worker.logs.push(chunk.toString());
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        worker.logs.push(chunk.toString());
      });
      child.on("message", (value: unknown) => {
        worker.messages.push(value as { type: string; error?: string });
      });
      workers.add(worker);
      await waitReady(worker);
    },

    async registerDeployment(uri: string): Promise<void> {
      const response = await fetch("http://127.0.0.1:9070/deployments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uri, force: true }),
      });
      if (!response.ok) {
        throw new Error(`Deployment registration failed (${String(response.status)}): ${await response.text()}`);
      }
    },

    async stopAll(): Promise<void> {
      await stopActorChildren();
      for (const worker of [...workers]) await killWorker(worker);
    },

    async close(): Promise<void> {
      await this.stopAll();
      clearActorChildObservation();
      await admin.end();
    },

    async readCleanupEvidence() {
      const datasource = await admin<{ connected: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM pg_catalog.pg_stat_activity
          WHERE application_name = 'continuity-kernel-restate'
        ) AS connected
      `;
      const locks = await admin<{ count: number }[]>`
        SELECT count(*)::integer AS count
        FROM pg_catalog.pg_locks
        WHERE locktype = 'advisory' AND granted
      `;
      return {
        actorChildren: activeActorChildCount(),
        workers: workers.size,
        datasourceBackends: datasource[0]?.connected === true ? 1 : 0,
        advisoryLocks: locks[0]?.count ?? 0,
      };
    },

    async observe(authority: ObservationAuthority): Promise<ActorObservationV1 | null> {
      const rows = await admin<{
        namespaceId: string;
        caseId: string;
        actorId: string;
        grantActorId: string;
        authorizationGrantId: string;
        authorizationVersion: string;
        expectedCaseVersion: string;
        caseStatus: string;
        commitmentDeadline: string | null;
        payloadRef: string | null;
      }[]>`
        SELECT
          c.namespace_id AS "namespaceId",
          c.case_id AS "caseId",
          g.actor_id AS "actorId",
          g.actor_id AS "grantActorId",
          g.authorization_grant_id AS "authorizationGrantId",
          g.version::text AS "authorizationVersion",
          c.version::text AS "expectedCaseVersion",
          c.status AS "caseStatus",
          c.commitment_deadline::text AS "commitmentDeadline",
          c.payload_ref AS "payloadRef"
        FROM continuity.cases c
        INNER JOIN continuity.authorization_grants g
          ON g.namespace_id = c.namespace_id
         AND g.case_id = c.case_id
         AND g.actor_id = ${authority.actorId}
         AND g.authorization_grant_id = ${authority.authorizationGrantId}
         AND g.version::text = ${authority.authorizationVersion}
         AND g.is_revoked = false
        WHERE c.namespace_id = ${authority.namespaceId}
          AND c.case_id = ${authority.caseId}
          AND c.owner_agent_id = ${authority.actorId}
      `;
      const row = rows[0];
      if (row === undefined) return null;
      return {
        observationSchemaVersion: 1,
        actorRuleVersion: 1,
        namespaceId: row.namespaceId,
        caseId: row.caseId,
        actorId: row.actorId,
        grantActorId: row.grantActorId,
        authorizationGrantId: row.authorizationGrantId,
        authorizationVersion: row.authorizationVersion,
        expectedCaseVersion: row.expectedCaseVersion,
        worldTime: fixture.worldTime,
        caseStatus: row.caseStatus,
        commitmentDeadline: row.commitmentDeadline ?? fixture.commitmentDeadline,
        payloadRef: row.payloadRef ?? fixture.payloadRef,
        permittedAction: "resolve_case",
        permittedResolution: "completed",
      };
    },

    async revokeGrant(): Promise<void> {
      await revokeGrant(admin);
    },

    async setGrantVersion(version: string): Promise<void> {
      const rows = await admin<{ version: string }[]>`
        UPDATE continuity.authorization_grants
        SET version = ${version}::bigint
        WHERE namespace_id = ${fixture.namespaceId}
          AND authorization_grant_id = ${fixture.authorizationGrantId}
        RETURNING version::text AS version
      `;
      if (rows[0]?.version !== version) throw new Error(`Grant version was not set to ${version}`);
    },

    async readCommandEvidence(namespaceId: string, commandId: string) {
      const receipts = await admin<StoredReceipt[]>`
        SELECT
          namespace_id AS "namespaceId",
          case_id AS "caseId",
          command_id AS "commandId",
          request_hash AS "requestHash",
          outcome_status AS "outcomeStatus",
          decision_code AS "decisionCode",
          authorization_version AS "authorizationVersion",
          case_version::text AS "caseVersion",
          payload_ref AS "payloadRef",
          projection_schema_version AS "projectionSchemaVersion",
          result
        FROM continuity.command_receipts
        WHERE namespace_id = ${namespaceId} AND command_id = ${commandId}
      `;
      const acceptedHistory = await admin<AcceptedHistory[]>`
        SELECT
          namespace_id AS "namespaceId",
          case_id AS "caseId",
          position::text AS position,
          command_id AS "commandId",
          request_hash AS "requestHash",
          actor_id AS "actorId",
          authorization_grant_id AS "authorizationGrantId",
          authorization_version::text AS "authorizationVersion",
          validator_version AS "validatorVersion",
          action_type AS "actionType",
          payload_ref AS "payloadRef"
        FROM continuity.accepted_history
        WHERE namespace_id = ${namespaceId} AND command_id = ${commandId}
        ORDER BY position
      `;
      const decisionAudits = await admin<DecisionAudit[]>`
        SELECT
          namespace_id AS "namespaceId",
          case_id AS "caseId",
          command_id AS "commandId",
          request_hash AS "requestHash",
          actor_id AS "actorId",
          authorization_grant_id AS "authorizationGrantId",
          authorization_version AS "authorizationVersion",
          validator_version AS "validatorVersion",
          decision_code AS "decisionCode",
          payload_ref AS "payloadRef"
        FROM continuity.decision_audit
        WHERE namespace_id = ${namespaceId} AND command_id = ${commandId}
        ORDER BY audit_id
      `;
      return {
        receipt: receipts[0] ?? null,
        acceptedHistory,
        decisionAudits,
      };
    },

    async readCaseState(): Promise<CaseState> {
      const rows = await admin<CaseState[]>`
        SELECT
          namespace_id AS "namespaceId",
          case_id AS "caseId",
          owner_agent_id AS "ownerAgentId",
          version::text AS version,
          status,
          commitment_deadline::text AS "commitmentDeadline",
          commitment_status AS "commitmentStatus",
          payload_ref AS "payloadRef"
        FROM continuity.cases
        WHERE namespace_id = ${fixture.namespaceId} AND case_id = ${fixture.caseId}
      `;
      const row = rows[0];
      if (row === undefined) throw new Error("Synthetic case is missing");
      return row;
    },

    async readNamespaceCounts(namespaceId: string): Promise<CountEvidence> {
      const rows = await admin<CountEvidence[]>`
        SELECT
          (SELECT count(*)::integer FROM continuity.command_receipts
            WHERE namespace_id = ${namespaceId}) AS receipts,
          (SELECT count(*)::integer FROM continuity.accepted_history
            WHERE namespace_id = ${namespaceId}) AS "acceptedHistory",
          (SELECT count(*)::integer FROM continuity.decision_audit
            WHERE namespace_id = ${namespaceId}) AS "decisionAudits"
      `;
      const row = rows[0];
      if (row === undefined) throw new Error("Namespace count query returned no row");
      return row;
    },

    async readGlobalCounts(): Promise<CountEvidence> {
      const rows = await admin<CountEvidence[]>`
        SELECT
          (SELECT count(*)::integer FROM continuity.command_receipts) AS receipts,
          (SELECT count(*)::integer FROM continuity.accepted_history) AS "acceptedHistory",
          (SELECT count(*)::integer FROM continuity.decision_audit) AS "decisionAudits"
      `;
      const row = rows[0];
      if (row === undefined) throw new Error("Global count query returned no row");
      return row;
    },
  };
}
