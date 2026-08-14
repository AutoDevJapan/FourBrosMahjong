import { describe, expect, it } from "vitest";
import { validateReleaseTagRuleset } from "../../.github/scripts/verify-release-tag-ruleset.mjs";

const ruleset = {
  id: 42,
  name: "protect-existing-release-tags",
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
  ])("rejects %s", (_label, change) => {
    expect(() =>
      validateReleaseTagRuleset({
        ...ruleset,
        ...change,
      }),
    ).toThrow();
  });
});
