/**
 * Convert a Zod schema to a JSON Schema for Workers AI structured outputs.
 *
 * Strips the $schema field since Workers AI expects a plain JSON Schema
 * object, not a full document with meta-references.
 */

import { z } from "zod";
import type { z as zType } from "zod";

export function toJsonSchema(schema: zType.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  delete jsonSchema["$schema"];
  return jsonSchema;
}
