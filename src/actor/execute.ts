import { submitCommand } from "../alternative/restate/client.js";
import { selectProposal } from "./deterministic.js";

export interface ActorConsequenceV1 {
  consequenceSchemaVersion: 1;
  proposalSchemaVersion: 1;
  actorRuleVersion: 1;
  commandId: string;
  proposalDigest: string;
  result: Awaited<ReturnType<typeof submitCommand>>;
}

export async function executeObservation(
  input: unknown,
  workflowId?: string,
): Promise<ActorConsequenceV1> {
  const proposal = selectProposal(input);
  const result = await submitCommand(proposal.commandId, proposal.request, workflowId);
  return {
    consequenceSchemaVersion: 1,
    proposalSchemaVersion: proposal.proposalSchemaVersion,
    actorRuleVersion: proposal.actorRuleVersion,
    commandId: proposal.commandId,
    proposalDigest: proposal.proposalDigest,
    result,
  };
}
