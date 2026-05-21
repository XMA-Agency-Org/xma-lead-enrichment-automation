import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const GHLWebhookSchema = z.object({
  type: z.string(),
  locationId: z.string(),
  id: z.string().optional(),
  contactId: z.string().optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = req.headers.get("x-ghl-signature");
  if (process.env.GHL_WEBHOOK_SECRET && secret !== process.env.GHL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = GHLWebhookSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const contactId = parsed.data.contactId ?? parsed.data.id;
  if (!contactId) {
    return NextResponse.json({ error: "No contact ID" }, { status: 400 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? `https://${req.headers.get("host")}`;
  fetch(`${baseUrl}/api/enrich`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-secret": process.env.INTERNAL_SECRET ?? "" },
    body: JSON.stringify({ contactId }),
  }).catch((err) => console.error("Failed to trigger enrichment:", err));

  return NextResponse.json({ received: true, contactId });
}
