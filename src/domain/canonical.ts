import { createHash } from "node:crypto";

import canonicalizeModule from "canonicalize";

const canonicalize = canonicalizeModule as unknown as (input: unknown) => string | undefined;

const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

function invalid(reason: string): never { throw new TypeError(reason); }

function validate(value: unknown): void {
  const kind = typeof value;
  if (kind === "string") { if (loneSurrogate.test(value as string)) invalid("Lone surrogates are not I-JSON"); return; }
  if (kind === "number") {
    const number = value as number;
    if (!Number.isFinite(number) || Object.is(number, -0) ||
      (Number.isInteger(number) && !Number.isSafeInteger(number))) invalid("Number is outside canonical contract");
    return;
  }
  if (kind === "boolean" || value === null) return;
  if (typeof value !== "object") invalid(`Unsupported JSON value: ${kind}`);
  if (Array.isArray(value)) {
    if (Reflect.ownKeys(value).length !== value.length + 1) invalid("Arrays must be dense JSON arrays");
    for (const item of value) validate(item);
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) invalid("Objects must be plain objects");
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") invalid("Symbol keys are not JSON"); validate(key);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) invalid("Properties must be enumerable data properties");
    validate(descriptor.value);
  }
}

function rejectDuplicateKeys(raw: string): void {
  let position = 0;
  function whitespace(): void { while (/[ \t\r\n]/u.test(raw[position] ?? "")) position += 1; }
  function take(expected: string): void { whitespace(); if (raw[position] !== expected) throw new SyntaxError("Invalid JSON"); position += 1; }
  function readString(): string {
    whitespace(); const start = position; take('"');
    while (position < raw.length) {
      if (raw[position] === '"') { position += 1; return JSON.parse(raw.slice(start, position)) as string; }
      position += raw[position] === "\\" ? 2 : 1;
    }
    throw new SyntaxError("Invalid JSON string");
  }
  function readArray(): void {
    take("["); whitespace(); if (raw.startsWith("]", position)) { position += 1; return; }
    for (;;) {
      readValue(); whitespace(); if (raw[position] === "]") { position += 1; return; } take(",");
    }
  }
  function readObject(): void {
    take("{"); whitespace(); if (raw.startsWith("}", position)) { position += 1; return; }
    const keys = new Set<string>();
    for (;;) {
      const key = readString();
      if (keys.has(key)) throw new SyntaxError(`Duplicate JSON object key: ${key}`);
      keys.add(key); take(":"); readValue(); whitespace();
      if (raw[position] === "}") { position += 1; return; } take(",");
    }
  }
  function readValue(): void {
    whitespace();
    if (raw[position] === "{") readObject();
    else if (raw[position] === "[") readArray();
    else if (raw[position] === '"') void readString();
    else {
      const start = position;
      while (!/[,\]}\s]/u.test(raw[position] ?? ",")) position += 1;
      if (position === start) throw new SyntaxError("Invalid JSON value");
    }
  }
  readValue(); whitespace(); if (position !== raw.length) throw new SyntaxError("Invalid JSON");
}

export function canonicalText(value: unknown): string {
  validate(value); const text = canonicalize(value); return text ?? invalid("Value cannot be serialized as JSON");
}

export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonicalText(value), "utf8").digest("base64url");
}

export function parseCanonicalJson(raw: string): unknown {
  rejectDuplicateKeys(raw); const value: unknown = JSON.parse(raw); validate(value); return value;
}
