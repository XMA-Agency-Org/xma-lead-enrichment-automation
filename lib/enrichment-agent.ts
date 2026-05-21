import Anthropic from "@anthropic-ai/sdk";
import type { GHLContact, EnrichmentResult } from "./ghl";

const client = new Anthropic();

const SYSTEM_PROMPT_TEXT = `You are a B2B lead enrichment specialist. Research the given contact and company using web search, then respond with ONLY a single flat JSON object — no nested objects, no markdown, no explanation outside the JSON.

Required output format (copy these exact key names):
{
  "companySize": "1-10" | "11-50" | "51-200" | "201-500" | "500+",
  "industry": "string describing the industry",
  "linkedInUrl": "full URL or null",
  "twitterUrl": "full URL or null",
  "instagramUrl": "full URL or null",
  "leadScore": integer 1-100,
  "qualificationNotes": "2-3 sentences explaining the score",
  "enrichmentSummary": "1-2 sentences max: company type, size, industry, and one notable signal for a sales call"
}

Scoring guide (1-100):
- Company size: larger = higher score
- Decision-maker title (owner/CEO/director): +20
- ISO certified or regulated industry: +10
- Active social media presence: +10
- No personal profile found: -10

Rules:
- Use ONLY these exact key names
- Never nest objects inside the response
- Never fabricate URLs — use null if not found
- Output raw JSON only, nothing else
- You MUST use web_search to find information before responding
- Do maximum 3 web searches, then return the JSON`;

type BetaMessage = Awaited<ReturnType<(typeof client.beta.messages)["create"]>> extends infer R
  ? R extends { content: unknown[] } ? R : never
  : never;
type BetaContentBlock = BetaMessage["content"][number];
type BetaMessageParam = { role: "user" | "assistant"; content: string | BetaContentBlock[] };

export async function enrichLead(contact: GHLContact): Promise<EnrichmentResult> {
  console.log(`[enrich] Starting enrichment for contact: ${contact.id} (${contact.firstName} ${contact.lastName} <${contact.email}>)`);

  const userPrompt = buildPrompt(contact);
  console.log(`[enrich] Prompt:\n${userPrompt}`);

  const messages: BetaMessageParam[] = [
    { role: "user", content: userPrompt },
  ];

  let finalText = "";
  let turns = 0;
  const MAX_TURNS = 5;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheWriteTokens = 0;

  while (turns < MAX_TURNS) {
    turns++;

    const response = await client.beta.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT_TEXT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [{ type: "web_search_20250305", name: "web_search" }] as never,
      tool_choice: turns === 1 ? ({ type: "any" } as never) : ({ type: "auto" } as never),
      messages: messages as never,
      betas: ["web-search-2025-03-05"],
    });

    const u = response.usage as {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
    totalInputTokens += u.input_tokens;
    totalOutputTokens += u.output_tokens;
    totalCacheReadTokens += u.cache_read_input_tokens ?? 0;
    totalCacheWriteTokens += u.cache_creation_input_tokens ?? 0;
    console.log(`[agent] turn ${turns}, stop_reason: ${response.stop_reason}, content_blocks: ${response.content.map((b) => b.type).join(",")}, usage: input=${u.input_tokens} output=${u.output_tokens} cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0}`);

    const allText = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("\n");

    if (response.stop_reason === "end_turn") {
      finalText = allText;
      break;
    }

    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }

    finalText = allText;
    break;
  }

  // Haiku 4.5 pricing: $0.80/M input, $4/M output, $0.08/M cache_read, $1/M cache_write
  const inputCost = (totalInputTokens / 1_000_000) * 0.80;
  const outputCost = (totalOutputTokens / 1_000_000) * 4.00;
  const cacheReadCost = (totalCacheReadTokens / 1_000_000) * 0.08;
  const cacheWriteCost = (totalCacheWriteTokens / 1_000_000) * 1.00;
  const totalCost = inputCost + outputCost + cacheReadCost + cacheWriteCost;

  console.log(
    `[enrich] tokens: input=${totalInputTokens} output=${totalOutputTokens} cache_read=${totalCacheReadTokens} cache_write=${totalCacheWriteTokens} | ` +
    `cost: $${totalCost.toFixed(6)} (input=$${inputCost.toFixed(6)} output=$${outputCost.toFixed(6)} cache_read=$${cacheReadCost.toFixed(6)} cache_write=$${cacheWriteCost.toFixed(6)})`
  );

  console.log(`[enrich] Raw agent response:\n${finalText}`);
  const result = parseAgentResponse(finalText);
  console.log(`[enrich] Parsed result:`, JSON.stringify(result, null, 2));

  return result;
}

function buildPrompt(contact: GHLContact): string {
  const parts = ["Enrich this lead:"];

  if (contact.firstName || contact.lastName) {
    parts.push(`Name: ${[contact.firstName, contact.lastName].filter(Boolean).join(" ")}`);
  }
  if (contact.email) parts.push(`Email: ${contact.email}`);
  if (contact.phone) parts.push(`Phone: ${contact.phone}`);
  if (contact.companyName) parts.push(`Company: ${contact.companyName}`);
  if (contact.website) parts.push(`Website: ${contact.website}`);

  parts.push("\nSearch for their LinkedIn, Twitter/X, Instagram, and company info. Then return the JSON enrichment object.");

  return parts.join("\n");
}

export function parseAgentResponse(text: string): EnrichmentResult {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.log(`[enrich] No JSON found in agent response`);
    return {
      enrichmentSummary: text.trim() || "Agent returned no structured data.",
      leadScore: 0,
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      companySize: parsed.companySize ?? undefined,
      industry: parsed.industry ?? undefined,
      linkedInUrl: parsed.linkedInUrl ?? undefined,
      twitterUrl: parsed.twitterUrl ?? undefined,
      instagramUrl: parsed.instagramUrl ?? undefined,
      leadScore: typeof parsed.leadScore === "number" ? parsed.leadScore : undefined,
      qualificationNotes: parsed.qualificationNotes ?? undefined,
      enrichmentSummary: parsed.enrichmentSummary ?? undefined,
    };
  } catch {
    console.log(`[enrich] Failed to parse JSON from agent response`);
    return { enrichmentSummary: text.trim(), leadScore: 0 };
  }
}
