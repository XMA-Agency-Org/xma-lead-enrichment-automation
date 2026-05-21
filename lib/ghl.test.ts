import { describe, it, expect, mock, beforeEach } from "bun:test";

const mockPut = mock(() => Promise.resolve({ data: {} }));

mock.module("axios", () => ({
  default: {
    create: () => ({
      get: mock(() => Promise.resolve({ data: {} })),
      put: mockPut,
      post: mock(() => Promise.resolve({ data: {} })),
    }),
  },
}));

const { updateContactFields } = await import("./ghl");

describe("updateContactFields", () => {
  beforeEach(() => {
    mockPut.mockClear();
  });

  it("sends all 8 fields when enrichment is complete", async () => {
    await updateContactFields("contact-123", {
      companySize: "51-200",
      industry: "Healthcare",
      linkedInUrl: "https://linkedin.com/company/vertex",
      twitterUrl: "https://twitter.com/vertex",
      instagramUrl: "https://instagram.com/vertex",
      leadScore: 75,
      qualificationNotes: "Good fit.",
      enrichmentSummary: "Summary here.",
    });

    expect(mockPut).toHaveBeenCalledTimes(1);
    const body = mockPut.mock.calls[0][1] as { customFields: Array<{ id: string; field_value: string }> };
    expect(body.customFields).toHaveLength(8);
  });

  it("skips undefined fields — only sends fields with values", async () => {
    await updateContactFields("contact-123", {
      companySize: "11-50",
      leadScore: 60,
    });

    const body = mockPut.mock.calls[0][1] as { customFields: Array<{ id: string; field_value: string }> };
    expect(body.customFields).toHaveLength(2);
    const ids = body.customFields.map((f) => f.id);
    expect(ids).toContain("r8L7vWokMMK2YSCgIyGI"); // companySize
    expect(ids).toContain("MLQ2av6LeYgdjUmLN2gI"); // leadScore
  });

  it("sends leadScore as string", async () => {
    await updateContactFields("contact-123", { leadScore: 85 });

    const body = mockPut.mock.calls[0][1] as { customFields: Array<{ id: string; field_value: string }> };
    const scoreField = body.customFields.find((f) => f.id === "MLQ2av6LeYgdjUmLN2gI");
    expect(scoreField?.field_value).toBe("85");
    expect(typeof scoreField?.field_value).toBe("string");
  });

  it("sends leadScore: 0 — falsy score is valid and must not be skipped", async () => {
    await updateContactFields("contact-123", { leadScore: 0 });

    const body = mockPut.mock.calls[0][1] as { customFields: Array<{ id: string; field_value: string }> };
    const scoreField = body.customFields.find((f) => f.id === "MLQ2av6LeYgdjUmLN2gI");
    expect(scoreField?.field_value).toBe("0");
  });
});
