import Anthropic from "@anthropic-ai/sdk";
import type { GHLContact, EnrichmentResult } from "./ghl";
import { researchContact, formatExaResults } from "./exa";
import { extractJSON } from "./claude-parse";

const client = new Anthropic();

const SYSTEM_PROMPT_TEXT = `You are a B2B lead enrichment specialist. You will be given contact information and web research data already gathered for you. Analyze it and respond with ONLY a single flat JSON object — no nested objects, no markdown, no explanation outside the JSON.

Required output format (copy these exact key names):
{
  "companySize": "1-10" | "11-50" | "51-200" | "201-500" | "500+",
  "industry": "string describing the industry",
  "linkedInUrl": "full URL or null",
  "twitterUrl": "full URL or null",
  "instagramUrl": "full URL or null",
  "facebookUrl": "full URL or null",
  "websiteUrl": "full URL or null",
  "leadScore": integer 1-100,
  "qualificationNotes": "2-3 sentences covering BANT: budget signals, authority level, need fit, and timeline/urgency indicators",
  "enrichmentSummary": "1-2 sentences max: company type, size, industry, and one notable signal for a sales call"
}

Scoring guide (1-100) — BANT framework, 25 points each:

BUDGET (25pts):
- Company revenue signals high budget (funded, enterprise, large headcount): 25
- Mid-market signals (SMB, growing startup): 15
- No budget signals or very small company: 5

AUTHORITY (25pts):
- Title is owner/CEO/founder/C-suite/VP/director: 25
- Manager or senior individual contributor: 15
- Unknown title or junior role: 5

NEED (25pts):
- Industry/role clearly benefits from marketing/sales services (e-commerce, SaaS, professional services, real estate, finance): 25
- Moderate fit industry: 15
- Low fit or unrelated industry: 5

TIMELINE (25pts):
- Active social media, recent hiring, funded company, or growth signals: 25
- Moderate online activity: 15
- Dormant presence or no signals found: 5

Penalties:
- No personal profile found anywhere: -10
- Spam-like or incomplete contact data: -15

Rules:
- Use ONLY these exact key names
- Never nest objects inside the response
- Never fabricate URLs — use null if not found
- Output raw JSON only, nothing else
- Base your answer on the research data provided`;

export async function enrichLead(contact: GHLContact): Promise<EnrichmentResult> {
  console.log(`[enrich] Starting enrichment for contact: ${contact.id} (${contact.firstName} ${contact.lastName} <${contact.email}>)`);

  const exaData = await researchContact(contact);
  const researchContext = formatExaResults(exaData);

  const userPrompt = buildPrompt(contact, researchContext);
  console.log(`[enrich] Prompt:\n${userPrompt}`);

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT_TEXT,
        cache_control: { type: "ephemeral" },
      },
    ] as never,
    messages: [{ role: "user", content: userPrompt }],
  });

  const u = response.usage as {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };

  const inputCost = (u.input_tokens / 1_000_000) * 1.00;
  const outputCost = (u.output_tokens / 1_000_000) * 5.00;
  const cacheReadCost = ((u.cache_read_input_tokens ?? 0) / 1_000_000) * 0.10;
  const cacheWriteCost = ((u.cache_creation_input_tokens ?? 0) / 1_000_000) * 1.25;
  const totalCost = inputCost + outputCost + cacheReadCost + cacheWriteCost;

  console.log(
    `[enrich] tokens: input=${u.input_tokens} output=${u.output_tokens} cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} | ` +
    `cost: $${totalCost.toFixed(6)}`
  );

  const finalText = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n");

  console.log(`[enrich] Raw agent response:\n${finalText}`);
  const result = parseAgentResponse(finalText);
  console.log(`[enrich] Parsed result:`, JSON.stringify(result, null, 2));

  return result;
}

function buildPrompt(contact: GHLContact, researchContext: string): string {
  const parts = ["Enrich this lead:"];

  if (contact.firstName || contact.lastName) {
    parts.push(`Name: ${[contact.firstName, contact.lastName].filter(Boolean).join(" ")}`);
  }
  if (contact.email) parts.push(`Email: ${contact.email}`);
  if (contact.phone) parts.push(`Phone: ${contact.phone}`);
  if (contact.companyName) parts.push(`Company: ${contact.companyName}`);
  if (contact.website) parts.push(`Website: ${contact.website}`);

  const f = contact.formFields;
  if (f && Object.keys(f).length > 0) {
    parts.push("\n--- Self-reported form answers (use these directly for BANT scoring) ---");
    if (f.monthlyBudget) parts.push(`Monthly marketing budget (Budget): ${f.monthlyBudget}`);
    if (f.monthlyRevenue) parts.push(`Monthly revenue (Budget signal): ${f.monthlyRevenue}`);
    if (f.primaryDecisionMaker) parts.push(`Primary decision maker (Authority): ${f.primaryDecisionMaker}`);
    if (f.urgencyLevel) parts.push(`Urgency level (Timeline): ${f.urgencyLevel}`);
    parts.push("--- End of form answers ---");
  }

  parts.push("\n--- Web Research (from Exa) ---");
  parts.push(researchContext);
  parts.push("--- End of research ---");
  parts.push("\nReturn the JSON enrichment object based on the research above.");

  return parts.join("\n");
}

export function parseAgentResponse(text: string): EnrichmentResult {
  const parsed = extractJSON<Record<string, unknown>>(text);
  if (!parsed) {
    console.log(`[enrich] No JSON found in agent response`);
    return { enrichmentSummary: text.trim() || "Agent returned no structured data.", leadScore: 0 };
  }
  return {
    companySize: parsed.companySize as string ?? undefined,
    industry: parsed.industry as string ?? undefined,
    linkedInUrl: parsed.linkedInUrl as string ?? undefined,
    twitterUrl: parsed.twitterUrl as string ?? undefined,
    instagramUrl: parsed.instagramUrl as string ?? undefined,
    facebookUrl: parsed.facebookUrl as string ?? undefined,
    websiteUrl: parsed.websiteUrl as string ?? undefined,
    leadScore: typeof parsed.leadScore === "number" ? parsed.leadScore : undefined,
    qualificationNotes: parsed.qualificationNotes as string ?? undefined,
    enrichmentSummary: parsed.enrichmentSummary as string ?? undefined,
  };
}
