import { DBOSClient } from "@dbos-inc/dbos-sdk";

import {
  SYSTEM_DATABASE_URL,
  launchIncumbent,
  shutdownIncumbent,
  submitCommand,
} from "../src/incumbent/dbos.js";
import { completedRequest } from "./db-fixture.js";

const send = (message: object): void => {
  process.send?.(message);
};

async function main(): Promise<void> {
  const mode = process.env.CK_WORKER_MODE ?? "submit";
  const workflowId = process.env.CK_WORKFLOW_ID;
  const commandId = process.env.CK_COMMAND_ID;
  if (workflowId === undefined) throw new Error("CK_WORKFLOW_ID is required");
  await launchIncumbent();
  send({ type: "ready" });

  if (mode === "idle") {
    await new Promise<never>(() => undefined);
  }
  if (mode === "recover") {
    const client = await DBOSClient.create({ systemDatabaseUrl: SYSTEM_DATABASE_URL });
    try {
      const result = await client.retrieveWorkflow(workflowId).getResult();
      send({ type: "result", result });
    } finally {
      await client.destroy();
    }
  } else {
    if (commandId === undefined) throw new Error("CK_COMMAND_ID is required");
    const result = await submitCommand(commandId, completedRequest, workflowId);
    send({ type: "result", result });
  }
  await shutdownIncumbent();
}

main().catch((error: unknown) => {
  send({ type: "error", error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
