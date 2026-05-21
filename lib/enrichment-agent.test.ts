import { describe, it, expect } from "bun:test";
import { parseAgentResponse } from "./enrichment-agent";

describe("parseAgentResponse", () => {
  it("maps valid flat JSON to EnrichmentResult", () => {
    const input = JSON.stringify({
      companySize: "51-200",
      industry: "Healthcare",
      linkedInUrl: "https://linkedin.com/company/vertex-co",
      twitterUrl: null,
      instagramUrl: "https://instagram.com/vertex_medical",
      leadScore: 72,
      qualificationNotes: "ISO certified SME, decision-maker contact.",
      enrichmentSummary: "Vertex Medical is a UAE-based medical equipment company.",
    });

    const result = parseAgentResponse(input);

    expect(result.companySize).toBe("51-200");
    expect(result.industry).toBe("Healthcare");
    expect(result.linkedInUrl).toBe("https://linkedin.com/company/vertex-co");
    expect(result.twitterUrl).toBeUndefined();
    expect(result.instagramUrl).toBe("https://instagram.com/vertex_medical");
    expect(result.leadScore).toBe(72);
    expect(result.qualificationNotes).toBe("ISO certified SME, decision-maker contact.");
    expect(result.enrichmentSummary).toBe("Vertex Medical is a UAE-based medical equipment company.");
  });

  it("extracts JSON embedded in surrounding text", () => {
    const input = `Here are my findings:\n\n${JSON.stringify({ companySize: "11-50", industry: "MedTech", leadScore: 60, qualificationNotes: "Good fit.", enrichmentSummary: "Summary here.", linkedInUrl: null, twitterUrl: null, instagramUrl: null })}\n\nLet me know if you need more.`;

    const result = parseAgentResponse(input);

    expect(result.companySize).toBe("11-50");
    expect(result.leadScore).toBe(60);
  });

  it("returns fallback when no JSON found", () => {
    const input = "I could not find any information about this contact.";

    const result = parseAgentResponse(input);

    expect(result.leadScore).toBe(0);
    expect(result.enrichmentSummary).toBe("I could not find any information about this contact.");
  });

  it("returns fallback on malformed JSON", () => {
    const input = '{ "leadScore": 50, "companySize": "11-50"'; // truncated

    const result = parseAgentResponse(input);

    expect(result.leadScore).toBe(0);
  });

  it("ignores null values — does not include them in result", () => {
    const input = JSON.stringify({
      companySize: "1-10",
      industry: "Retail",
      linkedInUrl: null,
      twitterUrl: null,
      instagramUrl: null,
      leadScore: 30,
      qualificationNotes: "Small company.",
      enrichmentSummary: "Summary.",
    });

    const result = parseAgentResponse(input);

    expect(result.linkedInUrl).toBeUndefined();
    expect(result.twitterUrl).toBeUndefined();
    expect(result.instagramUrl).toBeUndefined();
  });
});
