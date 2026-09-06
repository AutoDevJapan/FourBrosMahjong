import { describe, expect, it } from "vitest";
import {
  buildGhApiArgv,
  selectImmutableReleaseTagRuleset,
} from "../../.github/scripts/audit-release-tag-ruleset.mjs";
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

  it("accepts the explicit false update parameter used by the create API", () => {
    expect(
      validateReleaseTagRuleset({
        ...ruleset,
        rules: [
          {
            type: "update",
            parameters: { update_allows_fetch_and_merge: false },
          },
          { type: "deletion" },
          { type: "non_fast_forward" },
        ],
      }),
    ).toMatchObject({
      id: 42,
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
    [
      "fast-forward update permission",
      {
        rules: [
          {
            type: "update",
            parameters: { update_allows_fetch_and_merge: true },
          },
          { type: "deletion" },
          { type: "non_fast_forward" },
        ],
      },
    ],
    [
      "malformed update parameters",
      {
        rules: [
          { type: "update", parameters: "false" },
          { type: "deletion" },
          { type: "non_fast_forward" },
        ],
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

  it.each([0, -1, Number.MAX_SAFE_INTEGER + 1, 1.5, "42", undefined])(
    "rejects an invalid ruleset ID (%s)",
    (id) => {
      expect(() => validateReleaseTagRuleset({ ...ruleset, id })).toThrow(
        /ruleset id is missing or invalid/,
      );
    },
  );
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

  it.each([0, -1, Number.MAX_SAFE_INTEGER + 1, 1.5, "42", undefined])(
    "rejects an invalid selected ruleset ID (%s)",
    (id) => {
      expect(() =>
        selectImmutableReleaseTagRuleset([{ ...listEntry, id }]),
      ).toThrow(/selected release-tag ruleset id/);
    },
  );
});

describe("release tag ruleset audit helper", () => {
  it("pins GET in the argv for paginated list and detail requests", () => {
    expect(
      buildGhApiArgv("repos/AutoDevJapan/FourBrosMahjong/rulesets", [
        "--paginate",
        "--slurp",
      ]),
    ).toEqual([
      "api",
      "--method",
      "GET",
      "--paginate",
      "--slurp",
      "repos/AutoDevJapan/FourBrosMahjong/rulesets",
    ]);
    expect(
      buildGhApiArgv("repos/AutoDevJapan/FourBrosMahjong/rulesets/42"),
    ).toEqual([
      "api",
      "--method",
      "GET",
      "repos/AutoDevJapan/FourBrosMahjong/rulesets/42",
    ]);
  });

  it.each([
    ["--method", "POST"],
    ["--method=POST"],
    ["-X", "DELETE"],
    ["-XDELETE"],
    ["--field", "foo=bar"],
    ["--header", "X-Test:value"],
  ])(
    "rejects non-pagination options in read-only requests: %s",
    (...options) => {
      expect(() => buildGhApiArgv("repos/example", options)).toThrow(
        /limited to pagination flags/,
      );
    },
  );

  it("rejects an option-shaped endpoint path", () => {
    expect(() => buildGhApiArgv("--method=POST")).toThrow(
      /path must be a non-option string/,
    );
  });
});
