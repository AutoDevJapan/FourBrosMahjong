import { describe, expect, it } from "vitest";
import {
  parseReleaseOperatorsTeamId,
  selectReleaseTagCreationRuleset,
} from "../../.github/scripts/audit-release-tag-creation-ruleset.mjs";
import {
  EXPECTED_CREATION_RULESET_NAME,
  EXPECTED_CREATION_TAG_PATTERN,
  validateReleaseTagCreationRuleset,
} from "../../.github/scripts/verify-release-tag-creation-ruleset.mjs";

const APPROVED_TEAM_ID = 123456789;

const creationListEntry = {
  id: 43,
  name: EXPECTED_CREATION_RULESET_NAME,
  source_type: "Repository",
  target: "tag",
};

function ruleset() {
  return {
    id: 43,
    name: EXPECTED_CREATION_RULESET_NAME,
    source_type: "Repository",
    target: "tag",
    enforcement: "active",
    conditions: {
      ref_name: {
        include: [EXPECTED_CREATION_TAG_PATTERN],
        exclude: [],
      },
    },
    rules: [{ type: "creation" }],
    bypass_actors: [
      {
        actor_id: APPROVED_TEAM_ID,
        actor_type: "Team",
        bypass_mode: "always",
      },
    ],
  };
}

describe("release tag creation ruleset validator (#508)", () => {
  it("accepts the active creation-only ruleset for the approved Team", () => {
    expect(
      validateReleaseTagCreationRuleset(ruleset(), APPROVED_TEAM_ID),
    ).toEqual({
      id: 43,
      name: EXPECTED_CREATION_RULESET_NAME,
      enforcement: "active",
      ruleType: "creation",
      bypassActorType: "Team",
      bypassActorId: APPROVED_TEAM_ID,
      bypassMode: "always",
    });
  });

  it.each([
    ["wrong name", { name: "protect-existing-release-tags" }],
    ["inherited ruleset", { source_type: "Organization" }],
    ["wrong target", { target: "branch" }],
    ["disabled enforcement", { enforcement: "disabled" }],
    [
      "excluded tag",
      {
        conditions: {
          ref_name: {
            include: [EXPECTED_CREATION_TAG_PATTERN],
            exclude: ["refs/tags/v0.*"],
          },
        },
      },
    ],
    [
      "additional included pattern",
      {
        conditions: {
          ref_name: {
            include: [EXPECTED_CREATION_TAG_PATTERN, "refs/tags/release-*"],
            exclude: [],
          },
        },
      },
    ],
    ["missing creation rule", { rules: [] }],
    ["mixed rules", { rules: [{ type: "creation" }, { type: "update" }] }],
    ["missing bypass", { bypass_actors: [] }],
    [
      "multiple bypass actors",
      {
        bypass_actors: [
          ...ruleset().bypass_actors,
          { actor_id: 987654321, actor_type: "Team", bypass_mode: "always" },
        ],
      },
    ],
    [
      "non-Team bypass",
      {
        bypass_actors: [
          {
            actor_id: APPROVED_TEAM_ID,
            actor_type: "RepositoryRole",
            bypass_mode: "always",
          },
        ],
      },
    ],
    [
      "non-always bypass",
      {
        bypass_actors: [
          {
            actor_id: APPROVED_TEAM_ID,
            actor_type: "Team",
            bypass_mode: "pull_request",
          },
        ],
      },
    ],
    [
      "unapproved Team",
      {
        bypass_actors: [
          { actor_id: 987654321, actor_type: "Team", bypass_mode: "always" },
        ],
      },
    ],
  ])("rejects %s", (_label, change) => {
    expect(() =>
      validateReleaseTagCreationRuleset(
        { ...ruleset(), ...change },
        APPROVED_TEAM_ID,
      ),
    ).toThrow();
  });

  it.each([undefined, 0, -1, Number.MAX_SAFE_INTEGER + 1])(
    "rejects unresolved approved Team ID (%s)",
    (teamId) => {
      expect(() =>
        validateReleaseTagCreationRuleset(ruleset(), teamId),
      ).toThrow(/approved Release Operators Team ID is unresolved/);
    },
  );

  it("rejects malformed responses and non-positive ruleset IDs", () => {
    expect(() =>
      validateReleaseTagCreationRuleset(null, APPROVED_TEAM_ID),
    ).toThrow(/JSON object/);
    expect(() =>
      validateReleaseTagCreationRuleset(
        { ...ruleset(), id: 0 },
        APPROVED_TEAM_ID,
      ),
    ).toThrow(/ruleset id/);
  });
});

describe("release tag creation ruleset audit selector (#508)", () => {
  it("selects exactly one repository-owned creation ruleset", () => {
    expect(selectReleaseTagCreationRuleset([creationListEntry])).toEqual({
      id: 43,
      name: EXPECTED_CREATION_RULESET_NAME,
      target: "tag",
    });
  });

  it.each([
    ["no matching ruleset", []],
    [
      "inherited ruleset",
      [{ ...creationListEntry, source_type: "Organization" }],
    ],
    [
      "duplicate matching rulesets",
      [creationListEntry, { ...creationListEntry, id: 44 }],
    ],
  ])("fails closed for %s", (_label, input) => {
    expect(() => selectReleaseTagCreationRuleset(input)).toThrow(/exactly one/);
  });

  it.each([0, -1, Number.MAX_SAFE_INTEGER + 1, 1.5, "43", undefined])(
    "rejects an invalid selected ruleset ID (%s)",
    (id) => {
      expect(() =>
        selectReleaseTagCreationRuleset([{ ...creationListEntry, id }]),
      ).toThrow(/selected creation ruleset id/);
    },
  );
});

describe("release operators Team ID parsing (#508)", () => {
  it.each([
    ["123456789", APPROVED_TEAM_ID],
    [" 123456789 ", APPROVED_TEAM_ID],
  ])("accepts the owner-approved numeric Team ID: %s", (value, expected) => {
    expect(parseReleaseOperatorsTeamId(value)).toBe(expected);
  });

  it.each([
    undefined,
    "",
    " ",
    "0",
    "-1",
    "1.5",
    "0123456789",
    "9007199254740992",
    "123456789x",
  ])("rejects an unresolved Team ID: %s", (value) => {
    expect(parseReleaseOperatorsTeamId(value)).toBeUndefined();
  });
});
