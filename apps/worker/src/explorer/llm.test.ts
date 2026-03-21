import { describe, it, expect } from "vitest";
import { llm } from "./llm";

describe("llm", () => {
  it("returns parsed JSON from Z.AI", async () => {
    const apiKey = process.env.ZAI_API_KEY;
    if (!apiKey) {
      console.log("Skipping: ZAI_API_KEY not set");
      return;
    }

    const result = await llm(
      [
        {
          role: "system",
          content:
            'Respond with a JSON object: {"status": "ok", "number": 42}',
        },
        { role: "user", content: "health check" },
      ],
      apiKey
    );

    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });

  it("throws on invalid API key", async () => {
    await expect(
      llm(
        [{ role: "user", content: "test" }],
        "invalid-key"
      )
    ).rejects.toThrow();
  });
});
