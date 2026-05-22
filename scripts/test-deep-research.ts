import { getContact, createDeepResearchNote } from "../lib/ghl";
import { enrichLead } from "../lib/enrichment-agent";
import { runDeepResearch } from "../lib/deep-research-agent";
import { writeFileSync } from "fs";

const CONTACT_ID = "8RE8lVdT9bEisMYukwXu"; // János Szeiff — Noble Waves Properties LLC

async function main() {
  console.log("Fetching contact...");
  const contact = await getContact(CONTACT_ID);
  console.log("Contact:", JSON.stringify(contact, null, 2));

  console.log("\nRunning enrichment + deep research in parallel...");
  const [enrichment, deepResearch] = await Promise.all([
    enrichLead(contact),
    runDeepResearch(contact),
  ]);

  console.log("\nEnrichment result:", JSON.stringify(enrichment, null, 2));
  console.log("\nDeep research result:", JSON.stringify(deepResearch, null, 2));

  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  const company = contact.companyName ?? "Unknown";

  const md = `# Lead Research Report — ${name} / ${company}

**Contact ID:** ${CONTACT_ID}
**Email:** ${contact.email ?? "N/A"}
**Phone:** ${contact.phone ?? "N/A"}
**Run at:** ${new Date().toISOString()}

---

## Enrichment (BANT Scoring)

| Field | Value |
|---|---|
| Lead Score | ${enrichment.leadScore ?? "N/A"} / 100 |
| Industry | ${enrichment.industry ?? "N/A"} |
| Company Size | ${enrichment.companySize ?? "N/A"} |
| LinkedIn | ${enrichment.linkedInUrl ?? "not found"} |
| Twitter/X | ${enrichment.twitterUrl ?? "not found"} |
| Instagram | ${enrichment.instagramUrl ?? "not found"} |

### Qualification Notes
${enrichment.qualificationNotes ?? "N/A"}

### Enrichment Summary
${enrichment.enrichmentSummary ?? "N/A"}

---

## Deep Research Report

### Company Snapshot
${deepResearch.companySnapshot}

### Person Snapshot
${deepResearch.personSnapshot}

### Buying Signals
${deepResearch.buyingSignals.map((s) => `- ${s}`).join("\n") || "- None identified"}

### Key Findings
${deepResearch.keyFindings.map((f) => `- ${f}`).join("\n") || "- None identified"}

---

## GHL Notes HTML Preview

### Enrichment Note
\`\`\`html
(see GHL contact)
\`\`\`

### Deep Research Note HTML
\`\`\`html
${deepResearch.reportHtml}
\`\`\`
`;

  writeFileSync("docs/test-deep-research-output.md", md);
  console.log("\nMarkdown written to docs/test-deep-research-output.md");

  console.log("\nPosting deep research note to GHL...");
  await createDeepResearchNote(CONTACT_ID, deepResearch.reportHtml);
  console.log("Note posted!");
}

main().catch(console.error);
