import { NextRequest, NextResponse } from "next/server";
import { getContact, createDeepResearchNote } from "@/lib/ghl";
import { runDeepResearch } from "@/lib/deep-research-agent";

export const maxDuration = 300;

export async function POST(req: NextRequest): Promise<NextResponse> {
  console.log("[deep-research] Received request");

  const internalSecret = req.headers.get("x-internal-secret");
  if (process.env.INTERNAL_SECRET && internalSecret !== process.env.INTERNAL_SECRET) {
    console.warn("[deep-research] Unauthorized — bad internal secret");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { contactId } = await req.json();

  if (!contactId) {
    console.error("[deep-research] Missing contactId");
    return NextResponse.json({ error: "contactId required" }, { status: 400 });
  }

  console.log("[deep-research] Fetching contact:", contactId);
  const contact = await getContact(contactId);

  console.log("[deep-research] Running deep research...");
  const result = await runDeepResearch(contact);

  console.log("[deep-research] Writing note to GHL...");
  await createDeepResearchNote(contactId, result.reportHtml);

  console.log(`[deep-research] Done — contact ${contactId}`);
  return NextResponse.json({ success: true, contactId });
}
