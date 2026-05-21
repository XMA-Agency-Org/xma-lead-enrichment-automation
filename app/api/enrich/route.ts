import { NextRequest, NextResponse } from "next/server";
import { getContact, updateContactFields, createEnrichmentNote } from "@/lib/ghl";
import { enrichLead } from "@/lib/enrichment-agent";

export const maxDuration = 300;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const internalSecret = req.headers.get("x-internal-secret");
  if (
    process.env.INTERNAL_SECRET &&
    internalSecret !== process.env.INTERNAL_SECRET
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { contactId } = await req.json();
  if (!contactId) {
    return NextResponse.json({ error: "contactId required" }, { status: 400 });
  }

  const contact = await getContact(contactId);
  const enrichment = await enrichLead(contact);

  await Promise.all([
    updateContactFields(contactId, enrichment),
    createEnrichmentNote(contactId, contact.locationId, enrichment),
  ]);

  console.log(`Enriched contact ${contactId}:`, enrichment);

  return NextResponse.json({ success: true, contactId, enrichment });
}
