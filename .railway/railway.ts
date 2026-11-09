import { defineRailway, project, service } from "railway/iac";
// CLI 5.71.0 service-scoped migrate --variables unmanaged --apply generated
// the local authoring file. Runtime readiness/drain intent is reviewed separately
// from ownership cutover and does not change the still-running deployment.
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "four-bros-mahjong-online";
export default defineRailway(() => {
  const fourBrosMahjongOnline = service("four-bros-mahjong-online", {
    build: {
      buildEnvironment: "V3",
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
    },
    start: "node --import tsx server/start.ts",
    healthcheck: "/readyz",
    healthcheckTimeout: 60,
    deploy: {
      drainingSeconds: 30,
      overlapSeconds: 0,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 10,
    },
    replicas: { "us-west2": 1 },
  });

  // SDK 3.16.0 omits the CLI's project variable-policy extension from its
  // declaration. Keep the actual data, and verify it in the native plan.
  const definition = {
    variables: { managed: false },
    resources: [fourBrosMahjongOnline],
  };
  return project("godd-genesis", definition);
});
