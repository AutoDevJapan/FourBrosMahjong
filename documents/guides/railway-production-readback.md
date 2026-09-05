# Railway Production Read-back Contract (#980)

Issue [#980](https://github.com/AutoDevJapan/FourBrosMahjong/issues/980) requires an authorized Railway Production Operator to capture the identity of the existing production resource, its active deployment and effective configuration, then reconcile those values with the reviewed source and a sanitized boundary probe.

This repository provides an offline, fail-closed validator for that handoff:

```bash
pnpm verify:railway:production-readback \
  < /path/outside/repository/sanitized-production-readback.json
```

The input file must remain outside the repository. A successful result is only:

```json
{"schemaVersion":1,"readback":"pass","authorizesDeployment":false,"externalMutationPerformed":false,"reasons":[]}
```

The validator never contacts Railway, never performs a deployment, and never reflects supplied identifiers, URLs, operator names, or configuration values in its output. `pass` means only that the supplied values are internally consistent and fresh; it is not proof of operator authorization, API authenticity, current load, or deployment approval.

## Required sanitized fields

The exact-key input contains:

- `operator.name` and `operator.timezone` (a display label only; never a token or secret).
- `target.projectId`, `serviceId`, `environmentId`, `deploymentId`, normalized `deploymentStatus` (`success`), and the 40-character `sourceRevision` read back from the existing Railway resource.
- `target.publicBaseUrl`, effective `healthcheckPath` (`/readyz`), and effective numeric `port`.
- One canonical HTTPS `configuration.allowedOrigin`. Do not include a variable dump or unrelated settings.
- The reviewed 40-character `reviewedSourceRevision`; it must equal the active deployment source revision.
- `probe`, the successful `schemaVersion: 2` output from `node scripts/probe-online-boundary.mjs` against the same public base URL. It must contain `/healthz=200`, `/readyz=200`, allowed Origin `101`, disallowed Origin `403`, and missing Origin `403`, with sanitized `{"ok":true}` health bodies.

The validator rejects extra keys, non-canonical origins, private/local targets, stale or future timestamps, non-success deployments, source drift, wrong readiness/port values, and any failed or mismatched probe. It accepts only full 40-character Git revisions and does not store or return the provider values.

## Operator boundary

The operator must verify the exact existing project/service/production environment in Railway before collecting the fields. Do not create a project, service, environment, replica, or replacement target. Do not deploy, restart, rollback, drain, change variables, change scaling, or paste raw CLI/Dashboard output into the evidence file or GitHub.

Run the boundary helper once with the verified target and canonical origins; it sends only liveness/readiness requests and HTTP Upgrade handshakes and does not send WebSocket application frames. Keep only the helper's sanitized JSON. Attach the validator result and sanitized evidence to #653/#980 together with the capture time, source of the read-back, target identity, deployment ID, and reviewed full SHA. If the result is `hold`, record the fixed reason codes and leave the production issue open.
