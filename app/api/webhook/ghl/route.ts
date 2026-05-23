import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runContactPipeline } from "@/lib/pipeline";

export const maxDuration = 300;

const GHLWebhookSchema = z.object({
  type: z.string().optional(),
  locationId: z.string().optional(),
  id: z.string().optional(),
  contactId: z.string().optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  console.log("[webhook/ghl] Received request");

  const secret = req.headers.get("x-ghl-signature");
  if (process.env.GHL_WEBHOOK_SECRET && secret !== process.env.GHL_WEBHOOK_SECRET) {
    console.warn("[webhook/ghl] Unauthorized — signature mismatch. Got:", secret);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = GHLWebhookSchema.safeParse(body);

  if (!parsed.success) {
    console.error("[webhook/ghl] Schema validation failed:", parsed.error.flatten());
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const contactId = parsed.data.contactId ?? parsed.data.id;
  if (!contactId) {
    console.error("[webhook/ghl] No contact ID in payload");
    return NextResponse.json({ error: "No contact ID" }, { status: 400 });
  }

  console.log("[webhook/ghl] Running pipeline for contact:", contactId);
  const result = await runContactPipeline(contactId);

  return NextResponse.json({ success: true, ...result });
}
