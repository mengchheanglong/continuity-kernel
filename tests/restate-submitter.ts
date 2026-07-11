import { connect, type WorkflowDefinition } from "@restatedev/restate-sdk-clients";

import { buildCommitInput, type CommitInput } from "../src/domain/request.js";
import { completedRequest } from "./db-fixture.js";

interface CommitResult { status: "accepted" | "rejected"; code: string }
type CommitWorkflow = { run: (context: unknown, input: CommitInput) => Promise<CommitResult> };
type SubmitterMessage =
  | { type: "submitted"; invocationId: string }
  | { type: "terminal"; status: string; code: string };

const workflow: WorkflowDefinition<"ContinuityCommitT2bV1", CommitWorkflow> = {
  name: "ContinuityCommitT2bV1",
};

function send(message: SubmitterMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    if (process.send === undefined) { reject(new Error("Submitter requires IPC")); return; }
    process.send(message, (error) => { if (error === null) resolve(); else reject(error); });
  });
}

async function main(): Promise<void> {
  const [commandId, workflowId] = process.argv.slice(2);
  if (commandId === undefined || workflowId === undefined) throw new Error("Submitter arguments missing");
  const ingress = connect({ url: "http://127.0.0.1:8080" });
  const submission = await ingress.workflowClient(workflow, workflowId)
    .workflowSubmit(buildCommitInput(commandId, completedRequest));
  await send({ type: "submitted", invocationId: submission.invocationId });
  const result = await ingress.result<CommitResult>(submission);
  await send({ type: "terminal", status: result.status, code: result.code });
}

void main().catch(async () => {
  await send({ type: "terminal", status: "error", code: "SUBMITTER_ERROR" }).catch(() => undefined);
  process.exitCode = 1;
});
