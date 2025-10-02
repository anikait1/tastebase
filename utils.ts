import { strict as assert } from "node:assert";

export function ensureDefined<T>(
  value: T,
  message?: string,
): asserts value is NonNullable<T> {
  assert.notEqual(value, undefined, message);
  assert.notEqual(value, null, message);
}
