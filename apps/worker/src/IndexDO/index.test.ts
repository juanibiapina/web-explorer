/**
 * Integration tests for IndexDO.
 *
 * Uses @cloudflare/vitest-pool-workers to run inside workerd.
 * Exploration functions are mocked so no API keys are needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { env } from "cloudflare:test";

vi.mock("../explorer/explore", () => ({
  pickSeed: vi.fn(),
  exploreStep: vi.fn(),
}));

import { pickSeed, exploreStep } from "../explorer/explore";
import type { IndexDO } from "./index";

declare module "cloudflare:test" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ProvidedEnv extends Env {}
}

const mockPickSeed = vi.mocked(pickSeed);
const mockExploreStep = vi.mocked(exploreStep);

/**
 * Get a fresh IndexDO stub.
 * Uses newUniqueId() so each test gets its own instance.
 */
function getIndexStub(): DurableObjectStub<IndexDO> {
  const id = env.INDEX_DO.newUniqueId();
  return env.INDEX_DO.get(id);
}

describe("IndexDO", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Block exploration from running — we're testing IndexDO's mapping, not exploration
    mockPickSeed.mockReturnValue(new Promise(() => {}));
    mockExploreStep.mockReturnValue(new Promise(() => {}));
  });

  describe("createExploration()", () => {
    it("creates an exploration and returns a hex ID", async () => {
      const index = getIndexStub();
      const hexId = await index.createExploration("2026-03-24");

      expect(typeof hexId).toBe("string");
      expect(hexId.length).toBeGreaterThan(0);
    });

    it("is idempotent — returns same ID for same date", async () => {
      const index = getIndexStub();
      const first = await index.createExploration("2026-03-24");
      const second = await index.createExploration("2026-03-24");

      expect(first).toBe(second);
    });

    it("creates different IDs for different dates", async () => {
      const index = getIndexStub();
      const id1 = await index.createExploration("2026-03-24");
      const id2 = await index.createExploration("2026-03-25");

      expect(id1).not.toBe(id2);
    });
  });

  describe("getExplorationId()", () => {
    it("returns null for nonexistent dates", async () => {
      const index = getIndexStub();
      const result = await index.getExplorationId("2026-01-01");

      expect(result).toBeNull();
    });

    it("returns the hex ID for a created exploration", async () => {
      const index = getIndexStub();
      const created = await index.createExploration("2026-03-24");
      const fetched = await index.getExplorationId("2026-03-24");

      expect(fetched).toBe(created);
    });
  });

  describe("listDays()", () => {
    it("returns empty array when no explorations exist", async () => {
      const index = getIndexStub();
      const days = await index.listDays();

      expect(days).toEqual([]);
    });

    it("returns dates in reverse chronological order", async () => {
      const index = getIndexStub();
      await index.createExploration("2026-03-22");
      await index.createExploration("2026-03-24");
      await index.createExploration("2026-03-23");

      const days = await index.listDays();

      expect(days).toEqual(["2026-03-24", "2026-03-23", "2026-03-22"]);
    });
  });
});
