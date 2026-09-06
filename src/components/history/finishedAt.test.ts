import { describe, expect, it } from "vitest";
import { createFinishedAtFormatter, formatFinishedAt } from "./finishedAt";

describe("finishedAt formatting", () => {
  it("uses the current ja-JP formatter when the capability is available", () => {
    const format = () => "2026年7月20日 14:05";
    const formatter = createFinishedAtFormatter({
      DateTimeFormat: class {
        format = format;
      },
    });

    expect(formatter).not.toBeNull();
    expect(formatFinishedAt(0, formatter)).toBe("2026年7月20日 14:05");
  });

  it("falls back when DateTimeFormat does not support the requested options", () => {
    const formatter = createFinishedAtFormatter({
      DateTimeFormat: class {
        format = () => "";

        constructor() {
          throw new RangeError("dateStyle is unavailable");
        }
      },
    });

    expect(formatter).toBeNull();
    const timestamp = new Date(2026, 6, 20, 14, 5).getTime();
    expect(formatFinishedAt(timestamp, formatter)).toBe("2026/07/20 14:05");
  });

  it("falls back when a formatter becomes unusable during rendering", () => {
    const timestamp = new Date(2026, 6, 20, 14, 5).getTime();
    expect(
      formatFinishedAt(timestamp, {
        format: () => {
          throw new Error("formatter unavailable");
        },
      }),
    ).toBe("2026/07/20 14:05");
  });
});
