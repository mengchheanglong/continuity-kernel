import { launchRestate } from "../src/alternative/restate/index.js";

async function main(): Promise<void> {
  await launchRestate();
  process.send?.({ type: "ready" });
  await new Promise<never>(() => undefined);
}

main().catch((error: unknown) => {
  process.send?.({ type: "error", error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
