import { selectProposal } from "../src/actor/deterministic.js";
import { actorChildObservationFixture } from "./actor-child-fixture.js";

process.on("message", () => {
  process.exit(23);
});

const proposal = selectProposal(actorChildObservationFixture);
process.send?.({
  type: "proposal",
  commandId: proposal.commandId,
  proposalDigest: proposal.proposalDigest,
});

await new Promise<never>(() => undefined);
