import { connect, type WorkflowDefinition } from "@restatedev/restate-sdk-clients";

import { canonicalHash } from "../../domain/canonical.js";
import { buildCommitInput, type CommitInput } from "../../domain/request.js";

export interface CommitResult {
  status: "accepted" | "rejected";
  code: string;
  commandId: string;
  requestHash: string;
  [key: string]: unknown;
}

type CommitWorkflow = {
  run: (context: unknown, input: CommitInput) => Promise<CommitResult>;
};

const workflow: WorkflowDefinition<"ContinuityCommitT2bV1", CommitWorkflow> = {
  name: "ContinuityCommitT2bV1",
};
const ingress = connect({ url: "http://127.0.0.1:8080" });

export async function submitCommand(
  commandId: string,
  request: unknown,
  workflowId = commandId,
): Promise<CommitResult> {
  const input = buildCommitInput(commandId, request);
  const requestHash = canonicalHash(input.request);
  const submission = await ingress.workflowClient(workflow, workflowId)
    .workflowSubmit(input);
  const result = await ingress.result<CommitResult>(submission);
  return result.requestHash === requestHash
    ? result
    : { status: "rejected", code: "IDEMPOTENCY_KEY_REUSED", commandId, requestHash };
}
