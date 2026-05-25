import axios, { AxiosError } from "axios";

export class GHLError extends Error {
  constructor(
    public code: "NOT_FOUND" | "WRITE_FAILED" | "FIELD_MISMATCH" | "TIMEOUT" | "UNKNOWN",
    message: string,
    public cause?: unknown
  ) {
    super(message);
    this.name = "GHLError";
  }
}

function toGHLError(err: unknown, context: string): GHLError {
  const axErr = err as AxiosError;
  if (axErr.code === "ECONNABORTED" || axErr.code === "ETIMEDOUT") {
    return new GHLError("TIMEOUT", `${context}: request timed out`, err);
  }
  if (axErr.response?.status === 404) {
    return new GHLError("NOT_FOUND", `${context}: 404 not found`, err);
  }
  if (axErr.response?.status && axErr.response.status >= 400) {
    return new GHLError("WRITE_FAILED", `${context}: HTTP ${axErr.response.status}`, err);
  }
  return new GHLError("UNKNOWN", `${context}: ${(err as Error).message}`, err);
}

const ghlClient = axios.create({
  baseURL: "https://services.leadconnectorhq.com",
  timeout: 15_000,
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
  formFields?: {
    monthlyBudget?: string;
    urgencyLevel?: string;
    primaryDecisionMaker?: string;
    monthlyRevenue?: string;
  };
}

export interface EnrichmentResult {
  companySize?: string;
  industry?: string;
  linkedInUrl?: string;
  twitterUrl?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  websiteUrl?: string;
  leadScore?: number;
  qualificationNotes?: string;
  enrichmentSummary?: string;
}

const FORM_FIELD_KEYS: Record<string, keyof NonNullable<GHLContact["formFields"]>> = {
  whats_your_monthly_marketing_budget: "monthlyBudget",
  urgency_level: "urgencyLevel",
  primary_decision_maker: "primaryDecisionMaker",
  monthly_revenue: "monthlyRevenue",
};

const FIELD_IDS = {
  companySize: "r8L7vWokMMK2YSCgIyGI",
  industry: "4SXJuIroSxzlyeIUxoW4",
  linkedInUrl: "1H1khVsKBEJL8I9UfDGu",
  twitterUrl: "2frMMLIVrT2vfslsjp2o",
  instagramUrl: "bGLi05U3XUSxLxHmBnD1",
  facebookUrl: "",
  websiteUrl: "seqqSTidxAFpOZq7JxqA",
  leadScore: "MLQ2av6LeYgdjUmLN2gI",
  qualificationNotes: "RcP4I0UAtOC2BN1d1jbZ",
  enrichmentSummary: "ofM65PVMv6RHMPSAGa1J",
};

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  fields: Map<string, string>;
  expiresAt: number;
}

const fieldKeyCache = new Map<string, CacheEntry>();
const validatedLocations = new Set<string>();

export function flushFieldCache(locationId?: string): void {
  if (locationId) {
    fieldKeyCache.delete(locationId);
    validatedLocations.delete(locationId);
  } else {
    fieldKeyCache.clear();
    validatedLocations.clear();
  }
}

async function fetchFieldMap(locationId: string): Promise<Map<string, string>> {
  const { data } = await ghlClient.get(`/locations/${locationId}/customFields`);
  const map = new Map<string, string>();
  for (const field of data.customFields ?? []) {
    if (field.fieldKey && field.id) {
      const key = (field.fieldKey as string).replace(/^contact\./, "");
      map.set(field.id, key);
    }
  }
  console.log(`[ghl] Loaded ${map.size} custom field definitions for location ${locationId}`);
  return map;
}

async function getFieldMap(locationId: string): Promise<Map<string, string>> {
  const cached = fieldKeyCache.get(locationId);
  if (cached && cached.expiresAt > Date.now()) return cached.fields;

  const fields = await fetchFieldMap(locationId);
  fieldKeyCache.set(locationId, { fields, expiresAt: Date.now() + CACHE_TTL_MS });
  return fields;
}

async function validateFieldIds(locationId: string): Promise<void> {
  if (validatedLocations.has(locationId)) return;

  const fieldMap = await getFieldMap(locationId);
  const allIds = new Set(fieldMap.keys());
  const missing = Object.entries(FIELD_IDS)
    .filter(([, id]) => id !== "" && !allIds.has(id))
    .map(([name, id]) => `${name}=${id}`);

  if (missing.length > 0) {
    throw new GHLError(
      "FIELD_MISMATCH",
      `FIELD_IDS not found in GHL location ${locationId}: ${missing.join(", ")}`
    );
  }

  validatedLocations.add(locationId);
  console.log(`[ghl] Field ID validation passed for location ${locationId}`);
}

async function resolveFormFields(
  locationId: string,
  customFields: Array<{ id: string; value: string }>
): Promise<NonNullable<GHLContact["formFields"]>> {
  const idToKey = await getFieldMap(locationId);
  const formFields: NonNullable<GHLContact["formFields"]> = {};

  for (const { id, value } of customFields) {
    const key = idToKey.get(id);
    if (key && key in FORM_FIELD_KEYS) {
      const prop = FORM_FIELD_KEYS[key];
      (formFields as Record<string, string>)[prop] = value;
    }
  }

  return formFields;
}

export async function getContact(contactId: string): Promise<GHLContact> {
  try {
    const { data } = await ghlClient.get(`/contacts/${contactId}`);
    const contact: GHLContact = data.contact;

    if (contact.customFields?.length) {
      contact.formFields = await resolveFormFields(contact.locationId, contact.customFields);
      console.log(`[ghl] Resolved form fields:`, JSON.stringify(contact.formFields));
    }

    return contact;
  } catch (err) {
    throw toGHLError(err, `getContact(${contactId})`);
  }
}

export async function getContactOpportunityId(contactId: string, locationId: string): Promise<string | null> {
  try {
    const { data } = await ghlClient.get(`/opportunities/search`, {
      params: { contact_id: contactId, location_id: locationId },
    });
    return data.opportunities?.[0]?.id ?? null;
  } catch (err) {
    throw toGHLError(err, `getContactOpportunityId(${contactId})`);
  }
}

export async function updateContactFields(
  contactId: string,
  enrichment: EnrichmentResult,
  locationId: string
): Promise<void> {
  await validateFieldIds(locationId);

  const customFields: Array<{ id: string; field_value: string }> = [];

  if (enrichment.companySize) customFields.push({ id: FIELD_IDS.companySize, field_value: enrichment.companySize });
  if (enrichment.industry) customFields.push({ id: FIELD_IDS.industry, field_value: enrichment.industry });
  if (enrichment.linkedInUrl) customFields.push({ id: FIELD_IDS.linkedInUrl, field_value: enrichment.linkedInUrl });
  if (enrichment.twitterUrl) customFields.push({ id: FIELD_IDS.twitterUrl, field_value: enrichment.twitterUrl });
  if (enrichment.instagramUrl) customFields.push({ id: FIELD_IDS.instagramUrl, field_value: enrichment.instagramUrl });
  if (enrichment.facebookUrl && FIELD_IDS.facebookUrl) customFields.push({ id: FIELD_IDS.facebookUrl, field_value: enrichment.facebookUrl });
  if (enrichment.websiteUrl && FIELD_IDS.websiteUrl) customFields.push({ id: FIELD_IDS.websiteUrl, field_value: enrichment.websiteUrl });
  if (enrichment.leadScore !== undefined) customFields.push({ id: FIELD_IDS.leadScore, field_value: enrichment.leadScore.toString() });
  if (enrichment.qualificationNotes) customFields.push({ id: FIELD_IDS.qualificationNotes, field_value: enrichment.qualificationNotes });
  if (enrichment.enrichmentSummary) customFields.push({ id: FIELD_IDS.enrichmentSummary, field_value: enrichment.enrichmentSummary });

  console.log(`[ghl] Updating ${customFields.length} custom fields for contact ${contactId}`);
  try {
    await ghlClient.put(`/contacts/${contactId}`, { customFields });
  } catch (err) {
    throw toGHLError(err, `updateContactFields(${contactId})`);
  }
}

export async function createDeepResearchNote(contactId: string, reportHtml: string): Promise<void> {
  try {
    await ghlClient.post(`/contacts/${contactId}/notes`, { body: reportHtml });
    console.log(`[ghl] Deep research note created for contact: ${contactId}`);
  } catch (err) {
    throw toGHLError(err, `createDeepResearchNote(${contactId})`);
  }
}

export async function createEnrichmentNote(
  contactId: string,
  locationId: string,
  enrichment: EnrichmentResult
): Promise<void> {
  const opportunityId = await getContactOpportunityId(contactId, locationId);

  const relations: Array<{ objectKey: string; recordId: string }> = [
    { objectKey: "contact", recordId: contactId },
  ];

  if (opportunityId) {
    relations.push({ objectKey: "opportunity", recordId: opportunityId });
    console.log(`[ghl] Associating note with opportunity: ${opportunityId}`);
  } else {
    console.log(`[ghl] No opportunity found for contact — note will be contact-only`);
  }

  const body = buildNoteHtml(enrichment);

  try {
    await ghlClient.post(`/contacts/${contactId}/notes`, { body, relations });
    console.log(`[ghl] Enrichment note created for contact: ${contactId}`);
  } catch (err) {
    throw toGHLError(err, `createEnrichmentNote(${contactId})`);
  }
}

function buildNoteHtml(enrichment: EnrichmentResult): string {
  const score = enrichment.leadScore ?? "N/A";
  const scoreColor = typeof enrichment.leadScore === "number"
    ? enrichment.leadScore >= 70 ? "#16a34a" : enrichment.leadScore >= 40 ? "#d97706" : "#dc2626"
    : "#6b7280";

  const rows = [
    enrichment.companySize ? `<tr><td style="padding:4px 8px;font-weight:600;color:#1e40af;">Company Size</td><td style="padding:4px 8px;">${enrichment.companySize}</td></tr>` : "",
    enrichment.industry ? `<tr><td style="padding:4px 8px;font-weight:600;color:#1e40af;">Industry</td><td style="padding:4px 8px;">${enrichment.industry}</td></tr>` : "",
    enrichment.linkedInUrl ? `<tr><td style="padding:4px 8px;font-weight:600;color:#1e40af;">LinkedIn</td><td style="padding:4px 8px;"><a href="${enrichment.linkedInUrl}">${enrichment.linkedInUrl}</a></td></tr>` : "",
    enrichment.twitterUrl ? `<tr><td style="padding:4px 8px;font-weight:600;color:#1e40af;">Twitter/X</td><td style="padding:4px 8px;"><a href="${enrichment.twitterUrl}">${enrichment.twitterUrl}</a></td></tr>` : "",
    enrichment.instagramUrl ? `<tr><td style="padding:4px 8px;font-weight:600;color:#1e40af;">Instagram</td><td style="padding:4px 8px;"><a href="${enrichment.instagramUrl}">${enrichment.instagramUrl}</a></td></tr>` : "",
    enrichment.facebookUrl ? `<tr><td style="padding:4px 8px;font-weight:600;color:#1e40af;">Facebook</td><td style="padding:4px 8px;"><a href="${enrichment.facebookUrl}">${enrichment.facebookUrl}</a></td></tr>` : "",
    enrichment.websiteUrl ? `<tr><td style="padding:4px 8px;font-weight:600;color:#1e40af;">Website</td><td style="padding:4px 8px;"><a href="${enrichment.websiteUrl}">${enrichment.websiteUrl}</a></td></tr>` : "",
  ].filter(Boolean).join("");

  return `
<div style="background:#eff6ff;border-left:4px solid #2563eb;border-radius:6px;padding:16px;font-family:sans-serif;">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
    <span style="font-size:15px;font-weight:700;color:#1e3a8a;">🔍 Lead Enrichment Report</span>
    <span style="background:${scoreColor};color:#fff;font-weight:700;padding:4px 12px;border-radius:999px;font-size:14px;">Score: ${score}/100</span>
  </div>

  ${rows ? `<table style="width:100%;border-collapse:collapse;margin-bottom:12px;">${rows}</table>` : ""}

  ${enrichment.qualificationNotes ? `
  <div style="margin-bottom:10px;">
    <div style="font-weight:700;color:#1e40af;margin-bottom:4px;">Qualification Notes</div>
    <div style="color:#1e293b;">${enrichment.qualificationNotes}</div>
  </div>` : ""}

  ${enrichment.enrichmentSummary ? `
  <div>
    <div style="font-weight:700;color:#1e40af;margin-bottom:4px;">Summary</div>
    <div style="color:#1e293b;">${enrichment.enrichmentSummary}</div>
  </div>` : ""}

  <div style="margin-top:12px;font-size:11px;color:#93c5fd;">Generated by XMA Lead Enrichment · ${new Date().toISOString()}</div>
</div>`.trim();
}
