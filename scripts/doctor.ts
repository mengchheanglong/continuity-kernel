/**
 * Local topology doctor for Continuity Kernel.
 * Prints readiness for the frozen Postgres + Restate harness. Synthetic only.
 */

import { networkInterfaces } from "node:os";

import postgres from "postgres";

const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

function record(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}: ${detail}`);
}

function candidateHostIps(): string[] {
  const results: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    if (entries === undefined) continue;
    for (const entry of entries) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (entry.address.startsWith("169.254.")) continue;
      results.push(entry.address);
    }
  }
  return [...new Set(results)];
}

async function checkHttp(name: string, url: string): Promise<void> {
  try {
    const response = await fetch(url);
    record(name, response.ok, `${url} → HTTP ${String(response.status)}`);
  } catch (error) {
    record(name, false, `${url} → ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function checkPostgres(): Promise<void> {
  const sql = postgres({
    host: "127.0.0.1",
    port: 55432,
    database: "continuity_app_db",
    user: "postgres",
    password: "postgres",
    max: 1,
    connect_timeout: 3,
    prepare: false,
    connection: { application_name: "continuity-kernel-doctor" },
  });
  try {
    const rows = await sql<{ ok: number }[]>`SELECT 1 AS ok`;
    const functions = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'continuity' AND p.proname = 'commit_command'
      ) AS exists
    `;
    record(
      "postgres",
      rows[0]?.ok === 1 && functions[0]?.exists === true,
      functions[0]?.exists === true
        ? "127.0.0.1:55432 continuity_app_db + commit_command present"
        : "connected but continuity.commit_command missing — run pnpm run db:setup",
    );
  } catch (error) {
    record(
      "postgres",
      false,
      `${error instanceof Error ? error.message : String(error)} — run pnpm run db:up && pnpm run db:setup`,
    );
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function main(): Promise<void> {
  console.log("Continuity Kernel doctor — local synthetic topology\n");
  await checkPostgres();
  await checkHttp("restate-admin", "http://127.0.0.1:9070/version");
  await checkHttp("restate-ingress", "http://127.0.0.1:8080/restate/health");

  const ips = candidateHostIps();
  console.log("\nSuggested Restate deployment URIs (endpoint must listen on :9080):");
  for (const ip of ips) {
    console.log(`  CK_RESTATE_DEPLOYMENT_URI=http://${ip}:9080`);
  }
  if (ips.length === 0) {
    console.log("  (no non-loopback IPv4 addresses found; Docker Desktop may need host-gateway routing)");
  }
  console.log("  CK_RESTATE_DEPLOYMENT_URI=http://host.docker.internal:9080  # only if resolvable from Restate");

  const envUri = process.env.CK_RESTATE_DEPLOYMENT_URI;
  console.log(`\nCurrent CK_RESTATE_DEPLOYMENT_URI: ${envUri ?? "(unset)"}`);

  const failed = checks.filter((check) => !check.ok);
  console.log(`\nSummary: ${String(checks.length - failed.length)}/${String(checks.length)} checks passed`);
  if (failed.length > 0) {
    process.exitCode = 1;
    console.log("Fix FAIL items before running Gate D, T4, or the reference consumer.");
  } else {
    console.log("Topology looks ready. Next: start the endpoint worker, register deployment, run tests or the consumer.");
  }
}

await main();
