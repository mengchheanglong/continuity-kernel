import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  canonicalHash,
  canonicalText,
  parseCanonicalJson,
} from "../src/domain/canonical.js";

const completedRequest = {
  requestHashSchemaVersion: 1,
  namespaceId: "ns:test:continuity-kernel-v0",
  caseId: "case:test:001",
  actorId: "agent:test:owner-001",
  authorizationGrantId: "grant:test:case-001:owner-001",
  authorizationVersion: "7",
  expectedCaseVersion: "3",
  actionType: "resolve_case",
  actionPayload: {
    commitmentDeadline: "2026-07-11T12:00:00Z",
    payloadRef: "payload:test:attachment-001",
    resolution: "completed",
  },
  worldTime: "2026-07-11T10:00:00Z",
};

const cancelledRequest = {
  ...completedRequest,
  actionPayload: {
    ...completedRequest.actionPayload,
    resolution: "cancelled",
  },
};

const projection = {
  projectionSchemaVersion: 1,
  namespaceId: "ns:test:continuity-kernel-v0",
  case: {
    caseId: "case:test:001",
    ownerAgentId: "agent:test:owner-001",
    version: "4",
    status: "resolved",
    commitment: {
      deadline: "2026-07-11T12:00:00Z",
      status: "completed",
    },
  },
};

const frozenFixtures = [
  {
    name: "completed request",
    value: completedRequest,
    bytes: 434,
    text: '{"actionPayload":{"commitmentDeadline":"2026-07-11T12:00:00Z","payloadRef":"payload:test:attachment-001","resolution":"completed"},"actionType":"resolve_case","actorId":"agent:test:owner-001","authorizationGrantId":"grant:test:case-001:owner-001","authorizationVersion":"7","caseId":"case:test:001","expectedCaseVersion":"3","namespaceId":"ns:test:continuity-kernel-v0","requestHashSchemaVersion":1,"worldTime":"2026-07-11T10:00:00Z"}',
    hex: "8e58d7274e99c02bc396c8bbc62afe3d034a16ef8160864596536e2fdc93b876",
    base64url: "jljXJ06ZwCvDlsi7xir-PQNKFu-BYIZFllNuL9yTuHY",
  },
  {
    name: "cancelled request",
    value: cancelledRequest,
    bytes: 434,
    text: '{"actionPayload":{"commitmentDeadline":"2026-07-11T12:00:00Z","payloadRef":"payload:test:attachment-001","resolution":"cancelled"},"actionType":"resolve_case","actorId":"agent:test:owner-001","authorizationGrantId":"grant:test:case-001:owner-001","authorizationVersion":"7","caseId":"case:test:001","expectedCaseVersion":"3","namespaceId":"ns:test:continuity-kernel-v0","requestHashSchemaVersion":1,"worldTime":"2026-07-11T10:00:00Z"}',
    hex: "1d2afde2c5f1fe0ace0af6aa33abcc2b30ce25e5eeb3c97ed9f0c1159275daa5",
    base64url: "HSr94sXx_grOCvaqM6vMKzDOJeXus8l-2fDBFZJ12qU",
  },
  {
    name: "projection",
    value: projection,
    bytes: 250,
    text: '{"case":{"caseId":"case:test:001","commitment":{"deadline":"2026-07-11T12:00:00Z","status":"completed"},"ownerAgentId":"agent:test:owner-001","status":"resolved","version":"4"},"namespaceId":"ns:test:continuity-kernel-v0","projectionSchemaVersion":1}',
    hex: "004329709ea92693688385de4cea8dc9b7fa4af5989b20895683de3a2932c14b",
    base64url: "AEMpcJ6pJpNog4XeTOqNybf6SvWYmyCJVoPeOikywUs",
  },
];

describe("RFC 8785/SHA-256 frozen fixtures", () => {
  it.each(frozenFixtures)("pins $name exactly", (fixture) => {
    const text = canonicalText(fixture.value);

    expect(text).toBe(fixture.text);
    expect(Buffer.byteLength(text, "utf8")).toBe(fixture.bytes);
    expect(createHash("sha256").update(text, "utf8").digest("hex")).toBe(
      fixture.hex,
    );
    expect(canonicalHash(fixture.value)).toBe(fixture.base64url);
    expect(fixture.base64url).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(fixture.base64url).not.toContain("=");
  });
});

describe("deterministic canonical text", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalText({ z: { beta: 2, alpha: 1 }, a: 0 })).toBe(
      '{"a":0,"z":{"alpha":1,"beta":2}}',
    );
  });

  it("preserves array order", () => {
    expect(canonicalText({ values: [3, 1, { z: 2, a: 1 }] })).toBe(
      '{"values":[3,1,{"a":1,"z":2}]}',
    );
  });

  it("preserves composed and decomposed Unicode as distinct values", () => {
    const composed = { value: "\u00e9" };
    const decomposed = { value: "\u0065\u0301" };

    expect(canonicalText(composed)).toBe('{"value":"\u00e9"}');
    expect(canonicalText(decomposed)).toBe('{"value":"\u0065\u0301"}');
    expect(canonicalHash(composed)).not.toBe(canonicalHash(decomposed));
  });

  it("orders non-BMP keys by UTF-16 code units", () => {
    expect(
      canonicalText({ "\ue000": "bmp", "\u{1f600}": "non-bmp" }),
    ).toBe('{"\u{1f600}":"non-bmp","\ue000":"bmp"}');
  });

  it("preserves decimal strings beyond the safe-integer range", () => {
    expect(canonicalText({ position: "9007199254740993" })).toBe(
      '{"position":"9007199254740993"}',
    );
  });
});

describe("I-JSON input rejection", () => {
  const symbolKey = Symbol("key");
  const invalidValues: ReadonlyArray<readonly [string, unknown]> = [
    ["undefined", undefined],
    ["an undefined property", { absent: undefined }],
    ["a function", () => "not JSON"],
    ["a function property", { bad: () => "not JSON" }],
    ["a symbol", Symbol("value")],
    ["a symbol property", { bad: Symbol("value") }],
    ["a symbol key", { [symbolKey]: "hidden" }],
    ["a bigint", 1n],
    ["a bigint property", { bad: 1n }],
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
    ["negative zero", -0],
    ["a nested negative zero", { bad: -0 }],
    ["a positive unsafe integer", Number.MAX_SAFE_INTEGER + 1],
    ["a negative unsafe integer", Number.MIN_SAFE_INTEGER - 1],
    ["a lone high surrogate", "\ud800"],
    ["a lone low surrogate", "\udc00"],
    ["a lone-surrogate key", { ["\ud800"]: true }],
    ["a Date", new Date("2026-07-11T10:00:00Z")],
    ["a Map", new Map([["key", "value"]])],
    ["a class instance", new (class Value { readonly value = 1; })()],
  ];

  it.each(invalidValues)("rejects %s", (_name, value) => {
    expect(() => canonicalText(value)).toThrow(TypeError);
  });

  it("never treats an undefined optional field as absent", () => {
    expect(() => canonicalHash({ required: true, optional: undefined })).toThrow(
      TypeError,
    );
  });
});

describe("raw JSON ingestion", () => {
  it.each([
    ['{"a":1,"a":2}'],
    ['{"a":1,"\\u0061":2}'],
    ['{"outer":{"x":1,"x":2}}'],
    ['[{"x":1,"x":2}]'],
  ])("rejects duplicate object keys in %s", (raw) => {
    expect(() => parseCanonicalJson(raw)).toThrowError(
      "Duplicate JSON object key",
    );
  });

  it.each([
    ["negative zero", "-0"],
    ["non-finite overflow", "1e400"],
    ["an unsafe integer", "9007199254740993"],
    ["a lone high surrogate", '"\\ud800"'],
  ])("rejects %s before returning a value", (_name, raw) => {
    expect(() => parseCanonicalJson(raw)).toThrow(TypeError);
  });

  it("returns a validated value without changing key or array semantics", () => {
    const value = parseCanonicalJson('{"z":[2,1],"a":"\u00e9"}');

    expect(canonicalText(value)).toBe('{"a":"\u00e9","z":[2,1]}');
  });
});
