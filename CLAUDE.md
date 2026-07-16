# Claude Code Routing

Read and follow `AGENTS.md` before doing any work. It is the authoritative engineering-routing file; this file exists so Claude Code loads that routing automatically.

## Startup order

Use the complete startup order in `AGENTS.md`, including the public-safe overview, non-claims, threat/privacy boundary, invariants, conformance vectors, frozen historical evidence, and sealed decisions.

## Repository role

This private repository contains the Continuity Kernel implementation and sealed engineering artifacts. Mission authority and external research live in the separate private repository `mengchheanglong/transcendiverse-research`.

## Working rules

- Preserve the frozen vectors, privacy boundary, canonical PostgreSQL authority, and Restate/PostgreSQL distinction.
- Treat DBOS failures and historical matrices as evidence; do not rewrite them to make the suite appear universally green.
- Do not implement T5, Agent OS, custom persistence, consumer promotion, deployment, public visibility changes, or demand claims without a newer reviewed Mission Control decision.
- Never add real personal data, credentials, `.env` files, optional payload bytes, or plaintext-derived payload hashes to durable/runtime surfaces.
- Before editing, inspect the relevant source, tests, manifest, and current Git state.
- Verify changes with the repository commands in `AGENTS.md` and `package.json`.
- Do not commit, push, publish, or rewrite history unless the user explicitly asks.
