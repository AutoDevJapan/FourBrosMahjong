import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { selectImmutableReleaseTagRuleset } from "../../.github/scripts/audit-release-tag-ruleset.mjs";
import { validateReleaseTagRuleset } from "../../.github/scripts/verify-release-tag-ruleset.mjs";

const ruleset = {
  id: 42,
  name: "protect-existing-release-tags",
  source_type: "Repository",
  target: "tag",
  enforcement: "active",
  conditions: {
    ref_name: {
      include: ["refs/tags/v*"],
      exclude: [],
    },
  },
  rules: [
    { type: "update" },
    { type: "deletion" },
    { type: "non_fast_forward" },
  ],
  bypass_actors: [],
  current_user_can_bypass: "never",
};

describe("release tag ruleset validator (#508)", () => {
  it("accepts the active, bypass-free immutable-tag contract", () => {
    expect(validateReleaseTagRuleset(ruleset)).toEqual({
      id: 42,
      name: "protect-existing-release-tags",
      enforcement: "active",
      ruleTypes: ["deletion", "non_fast_forward", "update"],
    });
  });

  it.each([
    ["wrong target", { target: "branch" }],
    ["disabled enforcement", { enforcement: "disabled" }],
    ["bypass actor", { bypass_actors: [{ actor_type: "User", actor_id: 1 }] }],
    ["missing deletion rule", { rules: [{ type: "update" }] }],
    [
      "excluded tag",
      {
        conditions: {
          ref_name: { include: ["refs/tags/v*"], exclude: ["refs/tags/v0.*"] },
        },
      },
    ],
    [
      "additional included tag pattern",
      {
        conditions: {
          ref_name: {
            include: ["refs/tags/v*", "refs/tags/release-*"],
            exclude: [],
          },
        },
      },
    ],
    ["missing bypass visibility", { current_user_can_bypass: undefined }],
    ["inherited ruleset", { source_type: "Organization" }],
  ])("rejects %s", (_label, change) => {
    expect(() =>
      validateReleaseTagRuleset({
        ...ruleset,
        ...change,
      }),
    ).toThrow();
  });
});

describe("release tag ruleset audit selector (#508)", () => {
  const listEntry = {
    id: 42,
    name: "protect-existing-release-tags",
    source_type: "Repository",
    target: "tag",
  };

  it("selects exactly one repository-owned immutable-tag ruleset", () => {
    expect(selectImmutableReleaseTagRuleset([listEntry])).toEqual({
      id: 42,
      name: "protect-existing-release-tags",
      target: "tag",
    });
  });

  it.each([
    ["no matching ruleset", []],
    ["inherited ruleset", [{ ...listEntry, source_type: "Organization" }]],
    ["duplicate matching rulesets", [listEntry, { ...listEntry, id: 43 }]],
  ])("fails closed for %s", (_label, input) => {
    expect(() => selectImmutableReleaseTagRuleset(input)).toThrow(
      /exactly one/,
    );
  });
});

describe("release tag ruleset audit helper", () => {
  it("contains only a GET-based gh API invocation", () => {
    const source = readFileSync(
      resolve(process.cwd(), ".github/scripts/audit-release-tag-ruleset.mjs"),
      "utf8",
    );
    expect(source).toContain('execFileSync("gh", ["api", ...options, path]');
    expect(source).not.toMatch(/--method\s+(POST|PUT|PATCH|DELETE)/);
  });
});
