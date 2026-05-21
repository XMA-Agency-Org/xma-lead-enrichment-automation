import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { getContact } from "../lib/ghl";
import { enrichLead } from "../lib/enrichment-agent";

const CONTACT_ID = process.argv[2] || "rdJMa4E76yAaVdCWXVA3";

const client = new Anthropic();

const OLD_SYSTEM_PROMPT = `You are a B2B lead enrichment specialist. Research the given contact and company using web search, then respond with ONLY a single flat JSON object — no nested objects, no markdown, no explanation outside the JSON.

Required output format (copy these exact key names):
{
  "companySize": "1-10" | "11-50" | "51-200" | "201-500" | "500+",
  "industry": "string describing the industry",
  "linkedInUrl": "full URL or null",
  "twitterUrl": "full URL or null",
  "instagramUrl": "full URL or null",
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
- You MUST use web_search to find information before responding
- Do maximum 3 web searches, then return the JSON`;

type BetaMessageParam = { role: "user" | "assistant"; content: string | unknown[] };

async function runOldClaude(contact: Parameters<typeof enrichLead>[0]) {
  const parts = ["Enrich this lead:"];
  if (contact.firstName || contact.lastName)
    parts.push(`Name: ${[contact.firstName, contact.lastName].filter(Boolean).join(" ")}`);
  if (contact.email) parts.push(`Email: ${contact.email}`);
  if (contact.phone) parts.push(`Phone: ${contact.phone}`);
  if (contact.companyName) parts.push(`Company: ${contact.companyName}`);
  if (contact.website) parts.push(`Website: ${contact.website}`);

  const f = contact.formFields;
  if (f && Object.keys(f).length > 0) {
    parts.push("\n--- Self-reported form answers ---");
    if (f.monthlyBudget) parts.push(`Monthly marketing budget: ${f.monthlyBudget}`);
    if (f.monthlyRevenue) parts.push(`Monthly revenue: ${f.monthlyRevenue}`);
    if (f.primaryDecisionMaker) parts.push(`Primary decision maker: ${f.primaryDecisionMaker}`);
    if (f.urgencyLevel) parts.push(`Urgency level: ${f.urgencyLevel}`);
    parts.push("--- End of form answers ---");
  }
  parts.push("\nSearch for their LinkedIn, Twitter/X, Instagram, and company info. Then return the JSON enrichment object.");

  const messages: BetaMessageParam[] = [{ role: "user", content: parts.join("\n") }];

  let finalText = "";
  let turns = 0;
  const MAX_TURNS = 5;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  while (turns < MAX_TURNS) {
    turns++;
    const response = await client.beta.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: OLD_SYSTEM_PROMPT,
      tools: [{ type: "web_search_20250305", name: "web_search" }] as never,
      tool_choice: turns === 1 ? ({ type: "any" } as never) : ({ type: "auto" } as never),
      messages: messages as never,
      betas: ["web-search-2025-03-05"],
    });

    const u = response.usage as { input_tokens: number; output_tokens: number };
    totalInputTokens += u.input_tokens;
    totalOutputTokens += u.output_tokens;

    const allText = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("\n");

    if (response.stop_reason === "end_turn") {
      finalText = allText;
      break;
    }
    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content as unknown[] });
      continue;
    }
    finalText = allText;
    break;
  }

  return { finalText, totalInputTokens, totalOutputTokens, turns };
}

function parseJSON(text: string) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function main() {
  console.log(`\nFetching contact ${CONTACT_ID}...\n`);
  const contact = await getContact(CONTACT_ID);
  console.log(`Contact: ${contact.firstName} ${contact.lastName} <${contact.email}> @ ${contact.companyName}\n`);

  console.log("=".repeat(60));
  console.log("Running BOTH enrichment methods in parallel...");
  console.log("=".repeat(60) + "\n");

  const t0 = Date.now();

  const [exaResult, oldResult] = await Promise.all([
    (async () => {
      const t = Date.now();
      const result = await enrichLead(contact);
      return { result, ms: Date.now() - t };
    })(),
    (async () => {
      const t = Date.now();
      const raw = await runOldClaude(contact);
      const result = parseJSON(raw.finalText);
      return { result, ms: Date.now() - t, tokens: raw };
    })(),
  ]);

  const totalMs = Date.now() - t0;

  console.log("\n" + "=".repeat(60));
  console.log("RESULTS COMPARISON");
  console.log("=".repeat(60));

  const fields = ["companySize", "industry", "linkedInUrl", "twitterUrl", "instagramUrl", "leadScore", "qualificationNotes", "enrichmentSummary"] as const;

  for (const field of fields) {
    const exaVal = (exaResult.result as Record<string, unknown>)[field];
    const oldVal = oldResult.result?.[field];
    const match = JSON.stringify(exaVal) === JSON.stringify(oldVal);
    console.log(`\n── ${field} ${match ? "✓" : "≠"}`);
    console.log(`  EXA:   ${JSON.stringify(exaVal)}`);
    console.log(`  CLAUDE: ${JSON.stringify(oldVal)}`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("TIMING & COST");
  console.log("=".repeat(60));
  console.log(`  Exa method:    ${exaResult.ms}ms`);
  console.log(`  Claude method: ${oldResult.ms}ms  (${oldResult.tokens.turns} turns, ${oldResult.tokens.totalInputTokens} in + ${oldResult.tokens.totalOutputTokens} out tokens)`);
  console.log(`  Total wall:    ${totalMs}ms (parallel)`);
}

main().catch(console.error);
