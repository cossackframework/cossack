import { describe, expect, it } from "vitest";
import { decodeValue, encodeValue } from "../src/codec.js";
import type { ColumnMetadata } from "../src/metadata/types.js";

function column(logicalType: ColumnMetadata["logicalType"]): ColumnMetadata {
  return {
    propertyName: "value",
    columnName: "value",
    logicalType,
    nullable: false,
    primary: false,
    generated: false,
    unique: false,
    insert: true,
    update: true,
    select: true,
  };
}

describe("cross-dialect codecs", () => {
  it("normalizes booleans, dates, JSON, bigint, decimal, and binary", () => {
    expect(encodeValue(column("boolean"), true, "sqlite")).toBe(1);
    expect(decodeValue(column("boolean"), 0)).toBe(false);

    const date = new Date("2026-01-02T03:04:05.000Z");
    expect(encodeValue(column("datetime"), date, "sqlite")).toBe(date.toISOString());
    expect(decodeValue(column("datetime"), date.toISOString())).toEqual(date);

    expect(encodeValue(column("json"), { ok: true }, "sqlite")).toBe('{"ok":true}');
    expect(decodeValue(column("json"), '{"ok":true}')).toEqual({ ok: true });
    expect(encodeValue(column("bigint"), 9_007_199_254_740_993n, "sqlite"))
      .toBe("9007199254740993");
    expect(decodeValue(column("bigint"), "9007199254740993")).toBe(9_007_199_254_740_993n);
    expect(encodeValue(column("decimal"), 12.5, "postgres")).toBe("12.5");

    const binary = new Uint8Array([1, 2, 3]);
    expect(decodeValue(column("blob"), binary.buffer)).toEqual(binary);
  });

  it("validates explicit enums", () => {
    const value = { ...column("enum"), enumValues: ["draft", "live"] };
    expect(encodeValue(value, "live", "sqlite")).toBe("live");
    expect(() => encodeValue(value, "deleted", "sqlite")).toThrow(/must be one of/i);
  });
});
