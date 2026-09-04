import { describe, expect, it } from "vitest";
import {
  MAX_STRICT_JSON_NESTING,
  parseStrictJson,
} from "../../scripts/strictJson";

describe("parseStrictJson", () => {
  it("parses valid JSON and decodes escaped object names", () => {
    expect(
      parseStrictJson('{"text":"line\\n\\u0061","items":[true,null,-1.5e+2]}'),
    ).toEqual({ text: "line\na", items: [true, null, -150] });
  });

  it.each([
    '{"name":1,"name":2}',
    '{"name":1,"\\u006eame":2}',
    '{"nested":{"name":1,"name":2}}',
  ])("rejects duplicate object names: %s", (source) => {
    expect(() => parseStrictJson(source)).toThrow("strict JSON rejected");
  });

  it("rejects malformed, trailing, and excessively nested input", () => {
    const secret = "strict-json-secret";
    expect(() => parseStrictJson(`{"value":"${secret}`)).toThrow(
      "strict JSON rejected",
    );
    expect(() => parseStrictJson('{"value":true} trailing')).toThrow(
      "strict JSON rejected",
    );
    const nested = `${"[".repeat(MAX_STRICT_JSON_NESTING + 1)}0${"]".repeat(MAX_STRICT_JSON_NESTING + 1)}`;
    expect(() => parseStrictJson(nested)).toThrow("strict JSON rejected");
  });

  it("does not include rejected input in its error", () => {
    const secret = "strict-json-secret";
    try {
      parseStrictJson(`{"secret":"${secret}","secret":1}`);
      throw new Error("expected strict JSON rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(SyntaxError);
      expect(String(error)).not.toContain(secret);
    }
  });
});
