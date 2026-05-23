import { describe, it, expect, mock } from "bun:test";

mock.module("exa-js", () => ({
  default: class Exa {
    search() { return Promise.resolve({ results: [] }); }
    getContents() { return Promise.resolve({ results: [] }); }
    searchAndContents() { return Promise.resolve({ results: [] }); }
  },
}));

const {
  inferRegion,
  extractDomain,
  isGenericDomain,
  buildPersonQuery,
  buildCompanyQuery,
  buildSocialQuery,
} = await import("./exa");

import type { GHLContact } from "./ghl";

const base: GHLContact = { id: "x", locationId: "loc" };

describe("inferRegion", () => {
  it("returns UAE for +971", () => expect(inferRegion("+971501234567")).toBe("UAE"));
  it("returns Saudi Arabia for +966", () => expect(inferRegion("+966501234567")).toBe("Saudi Arabia"));
  it("returns Kuwait for +965", () => expect(inferRegion("+96512345678")).toBe("Kuwait"));
  it("returns Egypt for +20", () => expect(inferRegion("+201234567890")).toBe("Egypt"));
  it("returns UK for +44", () => expect(inferRegion("+447911123456")).toBe("UK"));
  it("returns null for US +1", () => expect(inferRegion("+14155550100")).toBeNull());
  it("returns null for undefined", () => expect(inferRegion(undefined)).toBeNull());
});

describe("extractDomain", () => {
  it("extracts domain from email", () => expect(extractDomain("user@example.com")).toBe("example.com"));
  it("returns null when no @", () => expect(extractDomain("notanemail")).toBeNull());
});

describe("isGenericDomain", () => {
  it("flags gmail", () => expect(isGenericDomain("gmail.com")).toBe(true));
  it("flags yahoo", () => expect(isGenericDomain("yahoo.com")).toBe(true));
  it("passes custom domain", () => expect(isGenericDomain("acme.com")).toBe(false));
});

describe("buildPersonQuery", () => {
  it("includes name and company", () => {
    const q = buildPersonQuery({ ...base, firstName: "Ali", lastName: "Hassan", companyName: "Acme" });
    expect(q).toContain("Ali Hassan");
    expect(q).toContain("at Acme");
  });

  it("includes region from phone", () => {
    const q = buildPersonQuery({ ...base, firstName: "Ali", phone: "+971501234567" });
    expect(q).toContain("UAE");
  });

  it("includes email domain", () => {
    const q = buildPersonQuery({ ...base, firstName: "Ali", email: "ali@acme.io" });
    expect(q).toContain("acme.io");
  });
});

describe("buildCompanyQuery", () => {
  it("prefers email domain over company name", () => {
    const q = buildCompanyQuery({ ...base, email: "ali@acme.io", companyName: "Acme Inc" });
    expect(q).toBe("acme.io");
  });

  it("skips generic email domains and falls back to website", () => {
    const q = buildCompanyQuery({ ...base, email: "ali@gmail.com", website: "https://acme.io" });
    expect(q).toBe("https://acme.io");
  });

  it("falls back to company name with region", () => {
    const q = buildCompanyQuery({ ...base, companyName: "Acme", phone: "+966501234567" });
    expect(q).toBe("Acme Saudi Arabia");
  });

  it("returns null when no signals", () => {
    expect(buildCompanyQuery(base)).toBeNull();
  });
});

describe("buildSocialQuery", () => {
  it("uses email domain when not generic", () => {
    expect(buildSocialQuery({ ...base, email: "ali@acme.io" })).toBe("acme.io");
  });

  it("skips generic email and falls back to company name", () => {
    expect(buildSocialQuery({ ...base, email: "ali@gmail.com", companyName: "Acme" })).toBe("Acme");
  });

  it("returns null with no signals", () => {
    expect(buildSocialQuery(base)).toBeNull();
  });
});
