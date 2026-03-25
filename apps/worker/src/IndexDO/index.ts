/**
 * IndexDO - Singleton mapping dates to ExplorationDO instances.
 *
 * Bound as idFromName("index"). Manages the lifecycle of daily explorations:
 * creates them on demand (idempotent), resolves dates to DO IDs, and lists
 * available days.
 *
 * Storage keys: "day:YYYY-MM-DD" → ExplorationDO hex ID string.
 */

import { DurableObject } from "cloudflare:workers";

export class IndexDO extends DurableObject<Env> {
  /**
   * RPC: Create or restart an exploration for the given date.
   * If an exploration already exists, restarts it (start() handles the reset).
   * This makes the trigger endpoint double as a retry mechanism.
   */
  async createExploration(
    date: string,
    mode: "search" | "follow" = "search"
  ): Promise<string> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const key = `day:${date}`;
      const existing = await this.ctx.storage.get<string>(key);
      if (existing) {
        const existingId = this.env.EXPLORATION_DO.idFromString(existing);
        const existingStub = this.env.EXPLORATION_DO.get(existingId);
        await existingStub.start(date, mode);
        return existing;
      }

      const id = this.env.EXPLORATION_DO.newUniqueId();
      const hexId = id.toString();

      await this.ctx.storage.put(key, hexId);

      const stub = this.env.EXPLORATION_DO.get(id);
      await stub.start(date, mode);

      return hexId;
    });
  }

  /**
   * RPC: Get the ExplorationDO hex ID for a given date.
   * Returns null if no exploration exists for that date.
   */
  async getExplorationId(date: string): Promise<string | null> {
    return (await this.ctx.storage.get<string>(`day:${date}`)) ?? null;
  }

  /**
   * RPC: List all available exploration dates, most recent first.
   */
  async listDays(): Promise<string[]> {
    const entries = await this.ctx.storage.list<string>({ prefix: "day:" });
    const dates = [...entries.keys()].map((key) => key.replace("day:", ""));
    dates.sort((a, b) => b.localeCompare(a)); // Newest first
    return dates;
  }
}
