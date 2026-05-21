import Anthropic from "@anthropic-ai/sdk";
import type { GHLContact, EnrichmentResult } from "./ghl";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AGENT_ID = process.env.ANTHROPIC_AGENT_ID;
const ENVIRONMENT_ID = process.env.ANTHROPIC_ENVIRONMENT_ID;

async function ensureAgent(): Promise<string> {
  if (AGENT_ID) return AGENT_ID;

  const agent = await client.beta.agents.create({
    name: "XMA Lead Enrichment Agent",
    model: "claude-sonnet-4-6",
    system: `You are a B2B lead enrichment specialist. Given contact information, you:
1. Search for the person's LinkedIn profile, Twitter/X, and Instagram
2. Research their company: size, industry, funding stage, and website
3. Score the lead 1-100 based on: company size (larger = higher), clear B2B fit, decision-maker title, and active online presence
4. Write qualification notes explaining the score

Always respond with a JSON object matching this exact shape:
{
  "companySize": "1-10 | 11-50 | 51-200 | 201-500 | 500+",
  "industry": "string",
  "linkedInUrl": "string | null",
  "twitterUrl": "string | null",
  "instagramUrl": "string | null",
  "leadScore": number between 1-100,
  "qualificationNotes": "2-3 sentence explanation",
  "enrichmentSummary": "1 paragraph summary of findings"
}

If you cannot find information, use null for optional fields. Never fabricate URLs.`,
    tools: [{ type: "agent_toolset_20260401" as const }],
  });

  console.log(`Created agent: ${agent.id} — set ANTHROPIC_AGENT_ID=${agent.id} to reuse`);
  return agent.id;
}

async function ensureEnvironment(): Promise<string> {
  if (ENVIRONMENT_ID) return ENVIRONMENT_ID;

  const environment = await client.beta.environments.create({
    name: "xma-lead-enrichment-env",
    config: {
      type: "cloud" as const,
      networking: { type: "unrestricted" as const },
    },
  });

  console.log(
    `Created environment: ${environment.id} — set ANTHROPIC_ENVIRONMENT_ID=${environment.id} to reuse`
  );
  return environment.id;
}

export async function enrichLead(contact: GHLContact): Promise<EnrichmentResult> {
  const [agentId, environmentId] = await Promise.all([
    ensureAgent(),
    ensureEnvironment(),
  ]);

  const session = await client.beta.sessions.create({
    agent: agentId,
    environment_id: environmentId,
    title: `Enrich: ${contact.firstName ?? ""} ${contact.lastName ?? ""} ${contact.email ?? ""}`.trim(),
  });

  const prompt = buildPrompt(contact);

  const stream = await client.beta.sessions.events.stream(session.id);

  await client.beta.sessions.events.send(session.id, {
    events: [
      {
        type: "user.message",
        content: [{ type: "text", text: prompt }],
      },
    ],
  });

  let finalText = "";

  for await (const event of stream) {
    if (event.type === "agent.message") {
      for (const block of event.content) {
        if ("text" in block) finalText += block.text;
      }
    } else if (event.type === "session.status_idle") {
      break;
    }
  }

  await client.beta.sessions.delete(session.id);

  return parseAgentResponse(finalText);
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

  parts.push(
    "\nSearch for their LinkedIn, Twitter/X, Instagram, and company info. Then return the JSON enrichment object."
  );

  return parts.join("\n");
}

function parseAgentResponse(text: string): EnrichmentResult {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
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
    return { enrichmentSummary: text.trim(), leadScore: 0 };
  }
}
