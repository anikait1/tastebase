import { strict as assert } from "node:assert";

export function ensureDefined<T>(
  value: T,
  message?: string,
): asserts value is NonNullable<T> {
  assert.notEqual(value, undefined, message);
  assert.notEqual(value, null, message);
}

/**
 * RFC 7807 Problem Details model.
 * See: https://datatracker.ietf.org/doc/html/rfc7807
 */
export class ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status?: number;
  readonly detail?: string;
  readonly instance?: string;
  readonly extensions?: Record<string, unknown>;

  constructor(params: {
    type: string;
    title: string;
    status?: number;
    detail?: string;
    instance?: string;
    extensions?: Record<string, unknown>;
  }) {
    this.type = params.type;
    this.title = params.title;
    this.status = params.status;
    this.detail = params.detail;
    this.instance = params.instance;
    if (params.extensions && Object.keys(params.extensions).length > 0) {
      this.extensions = params.extensions;
    }
  }

  toResponse(): Record<string, unknown> {
    return {
      type: this.type,
      title: this.title,
      ...(this.status !== undefined ? { status: this.status } : {}),
      ...(this.detail !== undefined ? { detail: this.detail } : {}),
      ...(this.instance !== undefined ? { instance: this.instance } : {}),
      ...(this.extensions ?? {}),
    };
  }
}
