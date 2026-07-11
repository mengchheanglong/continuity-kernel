import { selectProposal, type ActorObservationV1 } from "../src/actor/deterministic.js";

interface ObservationMessage {
  type: "observation";
  observation: ActorObservationV1;
}

function isObservationMessage(value: unknown): value is ObservationMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  return message.type === "observation" && typeof message.observation === "object" && message.observation !== null;
}

process.on("message", (value: unknown) => {
  if (!isObservationMessage(value)) {
    process.exitCode = 1;
    return;
  }
  const proposal = selectProposal(value.observation);
  process.send?.({
    type: "proposal",
    commandId: proposal.commandId,
    proposalDigest: proposal.proposalDigest,
  });
});

await new Promise<never>(() => undefined);
