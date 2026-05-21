import { NextRequest, NextResponse } from "next/server";
import { getContact, updateContactFields, createEnrichmentNote } from "@/lib/ghl";
import { enrichLead } from "@/lib/enrichment-agent";

export const maxDuration = 300;

export async function POST(req: NextRequest): Promise<NextResponse> {
  console.log("[enrich] Received request");

  const internalSecret = req.headers.get("x-internal-secret");
  if (
    process.env.INTERNAL_SECRET &&
    internalSecret !== process.env.INTERNAL_SECRET
  ) {
    console.warn("[enrich] Unauthorized — bad internal secret");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { contactId } = await req.json();
  console.log("[enrich] contactId:", contactId);

  if (!contactId) {
    console.error("[enrich] Missing contactId");
    return NextResponse.json({ error: "contactId required" }, { status: 400 });
  }

  console.log("[enrich] Fetching contact from GHL...");
  const contact = await getContact(contactId);
  console.log("[enrich] Contact fetched:", JSON.stringify(contact));

  console.log("[enrich] Running enrichment agent...");
  const enrichment = await enrichLead(contact);
  console.log("[enrich] Enrichment result:", JSON.stringify(enrichment));

  console.log("[enrich] Writing back to GHL...");
  await Promise.all([
    updateContactFields(contactId, enrichment),
    createEnrichmentNote(contactId, contact.locationId, enrichment),
  ]);

  console.log(`[enrich] Done — contact ${contactId}`);
  return NextResponse.json({ success: true, contactId, enrichment });
}
