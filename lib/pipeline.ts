import { getContact, updateContactFields, createEnrichmentNote, createDeepResearchNote } from "./ghl";
import type { EnrichmentResult } from "./ghl";
import { enrichLead } from "./enrichment-agent";
import { runDeepResearch } from "./deep-research-agent";

export interface PipelineResult {
  contactId: string;
  enrichment: EnrichmentResult | null;
  deepResearch: { ok: boolean };
}

export async function runContactPipeline(contactId: string): Promise<PipelineResult> {
  console.log(`[pipeline] Starting for contact: ${contactId}`);

  const contact = await getContact(contactId);
  console.log(`[pipeline] Contact fetched: ${contact.firstName} ${contact.lastName} <${contact.email}>`);

  const [enrichResult, deepResult] = await Promise.allSettled([
    enrichLead(contact).then(async (result) => {
      await Promise.all([
        updateContactFields(contactId, result, contact.locationId),
        createEnrichmentNote(contactId, contact.locationId, result),
      ]);
      console.log("[pipeline] Enrichment done");
      return result;
    }).catch((err) => {
      console.error("[pipeline] Enrichment failed:", err);
      return null;
    }),

    runDeepResearch(contact).then(async (result) => {
      await createDeepResearchNote(contactId, result.reportHtml);
      console.log("[pipeline] Deep research done");
      return true;
    }).catch((err) => {
      console.error("[pipeline] Deep research failed:", err);
      return false;
    }),
  ]);

  const enrichment = enrichResult.status === "fulfilled" ? enrichResult.value : null;
  const deepOk = deepResult.status === "fulfilled" ? (deepResult.value as boolean) : false;

  console.log(`[pipeline] Done — contact ${contactId} | enrichment: ${enrichment ? "ok" : "failed"} | deep-research: ${deepOk ? "ok" : "failed"}`);

  return { contactId, enrichment, deepResearch: { ok: deepOk } };
}
