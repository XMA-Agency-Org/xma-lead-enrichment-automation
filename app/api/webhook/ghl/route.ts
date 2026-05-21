import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const GHLWebhookSchema = z.object({
  type: z.string().optional(),
  locationId: z.string().optional(),
  id: z.string().optional(),
  contactId: z.string().optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  console.log("[webhook/ghl] Received request");

  const secret = req.headers.get("x-ghl-signature");
  console.log("[webhook/ghl] Headers:", JSON.stringify(Object.fromEntries(req.headers.entries())));

  if (process.env.GHL_WEBHOOK_SECRET && secret !== process.env.GHL_WEBHOOK_SECRET) {
    console.warn("[webhook/ghl] Unauthorized — signature mismatch. Got:", secret);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  console.log("[webhook/ghl] Body:", JSON.stringify(body));

  const parsed = GHLWebhookSchema.safeParse(body);

  if (!parsed.success) {
    console.error("[webhook/ghl] Schema validation failed:", parsed.error.flatten());
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const contactId = parsed.data.contactId ?? parsed.data.id;
  console.log("[webhook/ghl] Parsed contactId:", contactId, "| type:", parsed.data.type);

  if (!contactId) {
    console.error("[webhook/ghl] No contact ID in payload");
    return NextResponse.json({ error: "No contact ID" }, { status: 400 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? `https://${req.headers.get("host")}`;
  const enrichUrl = `${baseUrl}/api/enrich`;
  console.log("[webhook/ghl] Firing enrich request to:", enrichUrl);

  fetch(enrichUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-secret": process.env.INTERNAL_SECRET ?? "" },
    body: JSON.stringify({ contactId }),
  })
    .then((res) => console.log("[webhook/ghl] Enrich response status:", res.status))
    .catch((err) => console.error("[webhook/ghl] Failed to trigger enrichment:", err));

  console.log("[webhook/ghl] Returning 200 immediately");
  return NextResponse.json({ received: true, contactId });
}
