import Exa from "exa-js";
import type { GHLContact } from "./ghl";

const exa = new Exa(process.env.EXA_API_KEY!);

interface ExaResult {
  title?: string;
  url: string;
  highlights?: string[];
  profileUrl?: string;
}

export interface ExaResearchData {
  personResults: ExaResult[];
  companyResults: ExaResult[];
  socialResults: ExaResult[];
  websiteSocialLinks: string[];
}

export async function researchContact(contact: GHLContact): Promise<ExaResearchData> {
  const personQuery = buildPersonQuery(contact);
  const companyQuery = buildCompanyQuery(contact);
  const socialQuery = buildSocialQuery(contact);

  console.log(`[exa] Person query: "${personQuery}"`);
  console.log(`[exa] Company query: "${companyQuery}"`);
  console.log(`[exa] Social query: "${socialQuery}"`);

  const [personSearch, companySearch, socialSearch] = await Promise.all([
    exa.search(personQuery, {
      type: "deep",
      numResults: 5,
      category: "people",
      contents: { highlights: true },
    }).catch((err) => {
      console.error("[exa] Person search failed:", err.message);
      return { results: [] };
    }),

    companyQuery
      ? exa.search(companyQuery, {
          type: "deep",
          numResults: 5,
          category: "company",
          contents: { highlights: true },
        }).catch((err) => {
          console.error("[exa] Company search failed:", err.message);
          return { results: [] };
        })
      : Promise.resolve({ results: [] }),

    socialQuery
      ? exa.search(socialQuery, {
          type: "auto",
          numResults: 5,
          includeDomains: ["instagram.com", "twitter.com", "x.com", "facebook.com"],
          contents: { highlights: true },
        }).catch((err) => {
          console.error("[exa] Social search failed:", err.message);
          return { results: [] };
        })
      : Promise.resolve({ results: [] }),
  ]);

  const mapResults = (results: typeof personSearch.results) =>
    results.map((r) => ({
      title: r.title ?? undefined,
      url: r.url,
      highlights: (r as unknown as { highlights?: { text: string }[] }).highlights?.map((h) =>
        typeof h === "string" ? h : h.text
      ),
    }));

  const personResults = mapResults(personSearch.results);
  const companyResults = mapResults(companySearch.results);
  const socialResults = mapResults(socialSearch.results).map((r) => ({
    ...r,
    profileUrl: extractSocialProfileUrl(r.url),
  }));

  const websiteSocialLinks = await scrapeWebsiteSocialLinks(contact);

  console.log(`[exa] Person results: ${personResults.length}, Company results: ${companyResults.length}, Social results: ${socialResults.length}, Website social links: ${websiteSocialLinks.length}`);

  return { personResults, companyResults, socialResults, websiteSocialLinks };
}

function buildPersonQuery(contact: GHLContact): string {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  const parts = [name];
  if (contact.companyName) parts.push(`at ${contact.companyName}`);
  const emailDomain = contact.email ? extractDomain(contact.email) : null;
  if (emailDomain) parts.push(emailDomain);
  const region = inferRegion(contact.phone);
  if (region) parts.push(region);
  return parts.join(" ");
}

async function scrapeWebsiteSocialLinks(contact: GHLContact): Promise<string[]> {
  const emailDomain = contact.email ? extractDomain(contact.email) : null;
  const websiteUrl = contact.website || (emailDomain && !isGenericDomain(emailDomain) ? `https://${emailDomain}` : null);

  if (!websiteUrl) return [];

  try {
    const result = await exa.getContents([websiteUrl], {
      text: { maxCharacters: 3000 },
    });

    const text = result.results[0]?.text ?? "";
    const socialPattern = /https?:\/\/(?:www\.)?(?:instagram\.com|twitter\.com|x\.com|facebook\.com|linkedin\.com)\/[^\s"'<>)]+/gi;
    const found = [...new Set(text.match(socialPattern) ?? [])];

    const profileLinks = found
      .map(extractSocialProfileUrl)
      .filter((u): u is string => !!u);

    console.log(`[exa] Website social links found: ${profileLinks.join(", ") || "none"}`);
    return [...new Set(profileLinks)];
  } catch (err) {
    console.error("[exa] Website scrape failed:", (err as Error).message);
    return [];
  }
}

function extractSocialProfileUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const segments = u.pathname.split("/").filter(Boolean);

    if ((host === "instagram.com" || host === "x.com" || host === "twitter.com" || host === "facebook.com") && segments.length >= 1) {
      return `https://${host}/${segments[0]}`;
    }
  } catch {}
  return undefined;
}

function buildSocialQuery(contact: GHLContact): string | null {
  const emailDomain = contact.email ? extractDomain(contact.email) : null;
  if (emailDomain && !isGenericDomain(emailDomain)) return emailDomain;
  if (contact.companyName) return contact.companyName;
  return null;
}

function buildCompanyQuery(contact: GHLContact): string | null {
  const emailDomain = contact.email ? extractDomain(contact.email) : null;
  if (emailDomain && !isGenericDomain(emailDomain)) return emailDomain;
  if (contact.website) return contact.website;
  if (contact.companyName) {
    const region = inferRegion(contact.phone);
    return region ? `${contact.companyName} ${region}` : contact.companyName;
  }
  return null;
}

function extractDomain(email: string): string | null {
  const match = email.match(/@(.+)$/);
  return match ? match[1] : null;
}

function isGenericDomain(domain: string): boolean {
  return /^(gmail|yahoo|hotmail|outlook|icloud|protonmail|me|mac|live|msn)\./i.test(domain);
}

function inferRegion(phone?: string): string | null {
  if (!phone) return null;
  if (phone.startsWith("+971")) return "UAE";
  if (phone.startsWith("+966")) return "Saudi Arabia";
  if (phone.startsWith("+965")) return "Kuwait";
  if (phone.startsWith("+20")) return "Egypt";
  if (phone.startsWith("+44")) return "UK";
  if (phone.startsWith("+1")) return null;
  return null;
}

export function formatExaResults(data: ExaResearchData): string {
  const lines: string[] = [];

  if (data.websiteSocialLinks.length > 0) {
    lines.push("=== SOCIAL LINKS FROM COMPANY WEBSITE (authoritative) ===");
    for (const link of data.websiteSocialLinks) lines.push(`  ${link}`);
    lines.push("");
  }

  if (data.personResults.length > 0) {
    lines.push("=== PERSON RESEARCH (from Exa) ===");
    for (const r of data.personResults) {
      lines.push(`URL: ${r.url}`);
      if (r.title) lines.push(`Title: ${r.title}`);
      if (r.highlights?.length) {
        lines.push("Excerpts:");
        for (const h of r.highlights) lines.push(`  - ${h}`);
      }
      lines.push("");
    }
  }

  if (data.companyResults.length > 0) {
    lines.push("=== COMPANY RESEARCH (from Exa) ===");
    for (const r of data.companyResults) {
      lines.push(`URL: ${r.url}`);
      if (r.title) lines.push(`Title: ${r.title}`);
      if (r.highlights?.length) {
        lines.push("Excerpts:");
        for (const h of r.highlights) lines.push(`  - ${h}`);
      }
      lines.push("");
    }
  }

  if (data.socialResults.length > 0) {
    lines.push("=== SOCIAL PROFILES (from Exa) ===");
    for (const r of data.socialResults) {
      if (r.profileUrl) lines.push(`PROFILE URL: ${r.profileUrl}`);
      lines.push(`URL: ${r.url}`);
      if (r.title) lines.push(`Title: ${r.title}`);
      if (r.highlights?.length) {
        lines.push("Excerpts:");
        for (const h of r.highlights) lines.push(`  - ${h}`);
      }
      lines.push("");
    }
  }

  if (lines.length === 0) {
    lines.push("No external research data found.");
  }

  return lines.join("\n");
}
