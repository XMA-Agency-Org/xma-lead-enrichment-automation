import { describe, it, expect } from "bun:test";
import { extractJSON } from "./claude-parse";

describe("extractJSON", () => {
  it("parses clean JSON", () => {
    const result = extractJSON('{"a":1}') as { a: number };
    expect(result.a).toBe(1);
  });

  it("extracts JSON from surrounding prose", () => {
    const result = extractJSON('Here is the result: {"score":42} done.') as { score: number };
    expect(result.score).toBe(42);
  });

  it("returns null when no JSON present", () => {
    expect(extractJSON("no json here")).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    expect(extractJSON("{bad json}")).toBeNull();
  });

  it("handles multiline JSON", () => {
    const result = extractJSON('{\n  "x": true\n}') as { x: boolean };
    expect(result.x).toBe(true);
  });
});
