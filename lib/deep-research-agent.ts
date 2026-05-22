import Exa from "exa-js";
import Anthropic from "@anthropic-ai/sdk";
import type { GHLContact } from "./ghl";

const exa = new Exa(process.env.EXA_API_KEY!);
const anthropic = new Anthropic();

export interface DeepResearchResult {
  reportHtml: string;
  keyFindings: string[];
  companySnapshot: string;
  personSnapshot: string;
  buyingSignals: string[];
}

export async function runDeepResearch(contact: GHLContact): Promise<DeepResearchResult> {
  console.log(`[deep-research] Starting for contact: ${contact.id} (${contact.firstName} ${contact.lastName})`);

  const rawContext = await gatherDeepContext(contact);

  console.log(`[deep-research] Context gathered, running synthesis...`);
  const result = await synthesizeReport(contact, rawContext);

  console.log(`[deep-research] Done`);
  return result;
}

async function gatherDeepContext(contact: GHLContact): Promise<string> {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  const emailDomain = contact.email ? extractDomain(contact.email) : null;
  const company = contact.companyName;
  const website = contact.website || (emailDomain && !isGenericDomain(emailDomain) ? `https://${emailDomain}` : null);

  const searches = await Promise.allSettled([
    exa.searchAndContents(
      `${name} ${company ?? ""} LinkedIn profile`,
      { type: "auto", numResults: 3, includeDomains: ["linkedin.com"], text: { maxCharacters: 2000 } }
    ),

    company
      ? exa.searchAndContents(
          `${company} company news funding growth 2024 2025`,
          { type: "neural", numResults: 5, text: { maxCharacters: 2000 } }
        )
      : null,

    company
      ? exa.searchAndContents(
          `${company} ${emailDomain ?? ""} marketing agency clients results`,
          { type: "neural", numResults: 3, text: { maxCharacters: 2000 } }
        )
      : null,

    website
      ? exa.getContents([website], { text: { maxCharacters: 4000 } })
      : null,

    name && company
      ? exa.searchAndContents(
          `"${name}" OR "${company}" site:twitter.com OR site:x.com`,
          { type: "auto", numResults: 3, text: { maxCharacters: 1000 } }
        )
      : null,
  ]);

  const sections: string[] = [];

  const [linkedinSearch, newsSearch, marketingSearch, websiteContent, socialSearch] = searches;

  if (linkedinSearch.status === "fulfilled" && linkedinSearch.value) {
    const results = linkedinSearch.value.results;
    if (results.length > 0) {
      sections.push("=== LINKEDIN PROFILE DATA ===");
      for (const r of results) {
        sections.push(`URL: ${r.url}`);
        if (r.title) sections.push(`Title: ${r.title}`);
        if (r.text) sections.push(`Content:\n${r.text.slice(0, 1500)}`);
        sections.push("");
      }
    }
  } else if (linkedinSearch.status === "rejected") {
    console.error("[deep-research] LinkedIn search failed:", linkedinSearch.reason?.message);
  }

  if (newsSearch.status === "fulfilled" && newsSearch.value) {
    const results = newsSearch.value.results;
    if (results.length > 0) {
      sections.push("=== COMPANY NEWS & GROWTH SIGNALS ===");
      for (const r of results) {
        sections.push(`URL: ${r.url}`);
        if (r.title) sections.push(`Title: ${r.title}`);
        if (r.text) sections.push(`Content:\n${r.text.slice(0, 1500)}`);
        sections.push("");
      }
    }
  } else if (newsSearch.status === "rejected") {
    console.error("[deep-research] News search failed:", newsSearch.reason?.message);
  }

  if (marketingSearch.status === "fulfilled" && marketingSearch.value) {
    const results = marketingSearch.value.results;
    if (results.length > 0) {
      sections.push("=== MARKETING/CLIENT SIGNALS ===");
      for (const r of results) {
        sections.push(`URL: ${r.url}`);
        if (r.title) sections.push(`Title: ${r.title}`);
        if (r.text) sections.push(`Content:\n${r.text.slice(0, 1200)}`);
        sections.push("");
      }
    }
  } else if (marketingSearch.status === "rejected") {
    console.error("[deep-research] Marketing search failed:", marketingSearch.reason?.message);
  }

  if (websiteContent.status === "fulfilled" && websiteContent.value) {
    const text = websiteContent.value.results[0]?.text;
    if (text) {
      sections.push("=== COMPANY WEBSITE CONTENT ===");
      sections.push(text.slice(0, 4000));
      sections.push("");
    }
  } else if (websiteContent.status === "rejected") {
    console.error("[deep-research] Website scrape failed:", websiteContent.reason?.message);
  }

  if (socialSearch.status === "fulfilled" && socialSearch.value) {
    const results = socialSearch.value.results;
    if (results.length > 0) {
      sections.push("=== SOCIAL MEDIA ACTIVITY ===");
      for (const r of results) {
        sections.push(`URL: ${r.url}`);
        if (r.title) sections.push(`Title: ${r.title}`);
        if (r.text) sections.push(`Content:\n${r.text.slice(0, 800)}`);
        sections.push("");
      }
    }
  } else if (socialSearch.status === "rejected") {
    console.error("[deep-research] Social search failed:", socialSearch.reason?.message);
  }

  return sections.length > 0 ? sections.join("\n") : "No additional research data found.";
}

async function synthesizeReport(contact: GHLContact, context: string): Promise<DeepResearchResult> {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Unknown";
  const company = contact.companyName || "Unknown Company";

  const systemPrompt = `You are a senior sales intelligence analyst. Given raw web research data about a lead, produce a structured intelligence report to help a sales team prepare for an outreach call.

Respond with ONLY a valid JSON object using these exact keys:
{
  "companySnapshot": "2-3 sentences: what the company does, size, market position, notable clients or verticals",
  "personSnapshot": "2-3 sentences: the person's role, background, online presence, credibility signals",
  "buyingSignals": ["array", "of", "specific signals suggesting they need marketing/sales services now"],
  "keyFindings": ["array", "of", "5-8 notable facts a salesperson should know before calling"],
  "callAngle": "1-2 sentences: recommended opening angle or value prop for the first call based on the research"
}

Rules:
- Be specific and factual — only state what the research actually shows
- Never fabricate details
- buyingSignals and keyFindings must be concrete, not generic
- Output raw JSON only`;

  const userPrompt = `Analyze this lead and produce the sales intelligence report:

Contact: ${name}
Company: ${company}
Email: ${contact.email ?? "N/A"}
Website: ${contact.website ?? "N/A"}

--- RESEARCH DATA ---
${context}
--- END OF RESEARCH ---

Return the JSON report.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }] as never,
    messages: [{ role: "user", content: userPrompt }],
  });

  const u = response.usage as {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  const cost =
    (u.input_tokens / 1_000_000) * 3.0 +
    (u.output_tokens / 1_000_000) * 15.0 +
    ((u.cache_read_input_tokens ?? 0) / 1_000_000) * 0.3 +
    ((u.cache_creation_input_tokens ?? 0) / 1_000_000) * 3.75;

  console.log(
    `[deep-research] tokens: input=${u.input_tokens} output=${u.output_tokens} | cost: $${cost.toFixed(6)}`
  );

  const raw = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n");

  console.log(`[deep-research] Raw response:\n${raw}`);

  const parsed = parseReport(raw, name, company);
  return {
    ...parsed,
    reportHtml: buildReportHtml(name, company, parsed),
  };
}

interface ParsedReport {
  companySnapshot: string;
  personSnapshot: string;
  buyingSignals: string[];
  keyFindings: string[];
  callAngle?: string;
}

function parseReport(text: string, name: string, company: string): ParsedReport {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      companySnapshot: `${company} — no structured data available.`,
      personSnapshot: `${name} — no structured data available.`,
      buyingSignals: [],
      keyFindings: ["Research data was insufficient to generate findings."],
    };
  }

  try {
    const p = JSON.parse(jsonMatch[0]);
    return {
      companySnapshot: p.companySnapshot ?? "",
      personSnapshot: p.personSnapshot ?? "",
      buyingSignals: Array.isArray(p.buyingSignals) ? p.buyingSignals : [],
      keyFindings: Array.isArray(p.keyFindings) ? p.keyFindings : [],
      callAngle: p.callAngle ?? undefined,
    };
  } catch {
    return {
      companySnapshot: `${company}`,
      personSnapshot: `${name}`,
      buyingSignals: [],
      keyFindings: [text.slice(0, 300)],
    };
  }
}

function buildReportHtml(name: string, company: string, report: ParsedReport): string {
  const signalItems = report.buyingSignals.map((s) => `<li style="margin-bottom:4px;">${s}</li>`).join("");
  const findingItems = report.keyFindings.map((f) => `<li style="margin-bottom:4px;">${f}</li>`).join("");

  return `
<div style="background:#f0fdf4;border-left:4px solid #16a34a;border-radius:6px;padding:16px;font-family:sans-serif;">
  <div style="font-size:15px;font-weight:700;color:#14532d;margin-bottom:16px;">🔬 Deep Research Report — ${name} / ${company}</div>

  ${report.companySnapshot ? `
  <div style="margin-bottom:14px;">
    <div style="font-weight:700;color:#15803d;margin-bottom:4px;">Company</div>
    <div style="color:#1e293b;">${report.companySnapshot}</div>
  </div>` : ""}

  ${report.personSnapshot ? `
  <div style="margin-bottom:14px;">
    <div style="font-weight:700;color:#15803d;margin-bottom:4px;">Person</div>
    <div style="color:#1e293b;">${report.personSnapshot}</div>
  </div>` : ""}

  ${signalItems ? `
  <div style="margin-bottom:14px;">
    <div style="font-weight:700;color:#15803d;margin-bottom:6px;">🟢 Buying Signals</div>
    <ul style="margin:0;padding-left:18px;color:#1e293b;">${signalItems}</ul>
  </div>` : ""}

  ${findingItems ? `
  <div style="margin-bottom:14px;">
    <div style="font-weight:700;color:#15803d;margin-bottom:6px;">Key Findings</div>
    <ul style="margin:0;padding-left:18px;color:#1e293b;">${findingItems}</ul>
  </div>` : ""}

  ${report.callAngle ? `
  <div style="background:#dcfce7;border-radius:4px;padding:10px;margin-bottom:14px;">
    <div style="font-weight:700;color:#15803d;margin-bottom:4px;">📞 Recommended Call Angle</div>
    <div style="color:#1e293b;">${report.callAngle}</div>
  </div>` : ""}

  <div style="margin-top:8px;font-size:11px;color:#86efac;">Generated by XMA Deep Research · ${new Date().toISOString()}</div>
</div>`.trim();
}

function extractDomain(email: string): string | null {
  const match = email.match(/@(.+)$/);
  return match ? match[1] : null;
}

function isGenericDomain(domain: string): boolean {
  return /^(gmail|yahoo|hotmail|outlook|icloud|protonmail|me|mac|live|msn)\./i.test(domain);
}
