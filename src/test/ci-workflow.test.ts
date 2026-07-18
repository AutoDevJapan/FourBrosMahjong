import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Workflow = {
  jobs?: Record<string, { "timeout-minutes"?: unknown }>;
};

describe("CI workflow job timeouts", () => {
  it.each(["ci", "e2e"])("%s job has a bounded timeout", (jobName) => {
    const source = readFileSync(
      resolve(process.cwd(), ".github/workflows/ci.yml"),
      "utf8",
    );
    const workflow = parse(source) as Workflow;
    const timeout = workflow.jobs?.[jobName]?.["timeout-minutes"];

    expect(timeout, `${jobName} must declare timeout-minutes`).toBeTypeOf(
      "number",
    );
    expect(timeout).toBeGreaterThan(0);
    expect(timeout).toBeLessThanOrEqual(60);
  });
});
