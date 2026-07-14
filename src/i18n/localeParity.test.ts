import { describe, expect, it } from "vitest";
import enUS from "./locales/en-US";
import zhCN from "./locales/zh-CN";

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function flatten(resource: unknown, prefix = ""): Map<string, string> {
  if (typeof resource === "string") {
    return new Map([[prefix, resource]]);
  }
  if (typeof resource !== "object" || resource === null || Array.isArray(resource)) {
    throw new Error(`Translation value at "${prefix}" must be a string or object`);
  }

  const entries = new Map<string, string>();
  for (const [key, value] of Object.entries(resource)) {
    const childPrefix = prefix ? `${prefix}.${key}` : key;
    for (const [childKey, childValue] of flatten(value, childPrefix)) {
      entries.set(childKey, childValue);
    }
  }
  return entries;
}

function normalizedKeys(resource: unknown) {
  return [...new Set([...flatten(resource).keys()].map((key) => key.replace(PLURAL_SUFFIX, "")))].sort();
}

describe("i18n locale resources", () => {
  it("keeps the same translation keys in English and Simplified Chinese", () => {
    expect(normalizedKeys(zhCN)).toEqual(normalizedKeys(enUS));
  });

  it.each([
    ["en-US", enUS],
    ["zh-CN", zhCN],
  ])("contains no empty translations in %s", (_language, resource) => {
    const emptyKeys = [...flatten(resource)]
      .filter(([, value]) => value.trim().length === 0)
      .map(([key]) => key);

    expect(emptyKeys).toEqual([]);
  });
});
