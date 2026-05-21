import axios from "axios";

const ghlClient = axios.create({
  baseURL: "https://services.leadconnectorhq.com",
  headers: {
    Authorization: `Bearer ${process.env.GHL_API_KEY}`,
    Version: "2021-07-28",
    "Content-Type": "application/json",
  },
});

export interface GHLContact {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  website?: string;
  locationId: string;
  customFields?: Array<{ id: string; value: string }>;
}

export interface EnrichmentResult {
  companySize?: string;
  industry?: string;
  linkedInUrl?: string;
  twitterUrl?: string;
  instagramUrl?: string;
  leadScore?: number;
  qualificationNotes?: string;
  enrichmentSummary?: string;
}

export async function getContact(contactId: string): Promise<GHLContact> {
  const { data } = await ghlClient.get(`/contacts/${contactId}`);
  return data.contact;
}

export async function updateContactFields(
  contactId: string,
  enrichment: EnrichmentResult
): Promise<void> {
  const customFields: Array<{ key: string; field_value: string }> = [];

  if (enrichment.companySize) {
    customFields.push({ key: "company_size", field_value: enrichment.companySize });
  }
  if (enrichment.industry) {
    customFields.push({ key: "industry", field_value: enrichment.industry });
  }
  if (enrichment.linkedInUrl) {
    customFields.push({ key: "linkedin_url", field_value: enrichment.linkedInUrl });
  }
  if (enrichment.twitterUrl) {
    customFields.push({ key: "twitter_url", field_value: enrichment.twitterUrl });
  }
  if (enrichment.instagramUrl) {
    customFields.push({ key: "instagram_url", field_value: enrichment.instagramUrl });
  }
  if (enrichment.leadScore !== undefined) {
    customFields.push({
      key: "lead_score",
      field_value: enrichment.leadScore.toString(),
    });
  }
  if (enrichment.qualificationNotes) {
    customFields.push({
      key: "qualification_notes",
      field_value: enrichment.qualificationNotes,
    });
  }
  if (enrichment.enrichmentSummary) {
    customFields.push({
      key: "enrichment_summary",
      field_value: enrichment.enrichmentSummary,
    });
  }

  await ghlClient.put(`/contacts/${contactId}`, { customFields });
}
