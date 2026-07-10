# Evidence Artifacts

No T2 implementation evidence exists yet.

Before implementation begins, create a dated start artifact containing:

- UTC start timestamp;
- clean Git status;
- current commit or unborn-branch state;
- frozen matrix and vector identifiers;
- confirmation that no package manifest, lockfile, dependencies, database/DBOS configuration, migration, build script, source, or executable test existed before the timestamp.

Each later evidence artifact must contain:

- version/commit under review;
- commands executed;
- decisive output;
- failed or skipped checks;
- invariant/vector coverage;
- implementation hours and line count;
- scope audit;
- decision: continue on incumbent, `DBOS_REJECTED_PENDING_ALTERNATIVE`, revise, or park.

Do not place secrets, credentials, payload bytes, or personal data in artifacts.
