/**
 * Unit tests for the Zod-to-JSON-Schema conversion helper.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { toJsonSchema } from "./schema";

describe("toJsonSchema", () => {
  it("converts a simple Zod object to JSON Schema", () => {
    const schema = z.object({
      query: z.string(),
      reason: z.string(),
    });

    const result = toJsonSchema(schema);

    expect(result).toEqual({
      type: "object",
      properties: {
        query: { type: "string" },
        reason: { type: "string" },
      },
      required: ["query", "reason"],
      additionalProperties: false,
    });
  });

  it("strips the $schema field", () => {
    const schema = z.object({ name: z.string() });
    const result = toJsonSchema(schema);

    expect(result).not.toHaveProperty("$schema");
  });

  it("handles nested objects", () => {
    const schema = z.object({
      thread: z.object({
        from: z.string(),
        reasoning: z.string(),
      }),
    });

    const result = toJsonSchema(schema);

    expect(result).toEqual({
      type: "object",
      properties: {
        thread: {
          type: "object",
          properties: {
            from: { type: "string" },
            reasoning: { type: "string" },
          },
          required: ["from", "reasoning"],
          additionalProperties: false,
        },
      },
      required: ["thread"],
      additionalProperties: false,
    });
  });
});
