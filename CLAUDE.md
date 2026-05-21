# Project: XMA Lead Enrichment Automation

## Overview
- **Type**: Next.js API server (no frontend)
- **Stack**: Next.js 16 App Router, TypeScript, Anthropic Managed Agents SDK, Axios
- **Package Manager**: bun
- **Purpose**: Receive GHL contact webhooks → run Claude managed agent to enrich lead → write back to GHL custom fields

## Architecture

```
GHL Webhook → POST /api/webhook/ghl
                ↓ fire-and-forget fetch
              POST /api/enrich
                ↓
              getContact() from GHL API
                ↓
              enrichLead() → Anthropic Managed Agent session
                             (web search for LinkedIn, company info, social profiles)
                ↓
              updateContactFields() → GHL API (custom fields)
```

## Key Files
- `lib/ghl.ts` — GHL API client (get contact, update custom fields)
- `lib/exa.ts` — Exa search client (people + company deep search, result formatting)
- `lib/enrichment-agent.ts` — Enrichment orchestration (Exa research → single Claude call → parse JSON)
- `app/api/webhook/ghl/route.ts` — GHL webhook receiver, returns 200 immediately
- `app/api/enrich/route.ts` — Actual enrichment runner, `maxDuration = 300`

## Environment Variables
| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `EXA_API_KEY` | Exa API key for web research (people + company search) |
| `GHL_API_KEY` | GHL Private Integration token |
| `GHL_WEBHOOK_SECRET` | Optional webhook signature verification |
| `INTERNAL_SECRET` | Shared secret between webhook and enrich endpoints |
| `NEXT_PUBLIC_BASE_URL` | Deployed URL for fire-and-forget calls |

## GHL Setup
1. Create Private Integration: GHL → Settings → Integrations → API Keys
2. Create webhook: GHL → Settings → Integrations → Webhooks → Add Webhook
   - URL: `https://your-app.vercel.app/api/webhook/ghl`
   - Events: Contact Created, Contact Updated
3. Create custom fields on contacts: company_size, industry, linkedin_url, twitter_url, instagram_url, lead_score, qualification_notes, enrichment_summary


## Vercel Deployment
- `maxDuration = 300` on enrich endpoint (requires Pro plan for full 300s)
- Set all env vars via `vercel env add`
- GHL webhook → set `NEXT_PUBLIC_BASE_URL` to deployed URL
