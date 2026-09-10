# Current Checkpoint

Date: 2026-09-10

## V1 status

Backend integrity remains GREEN. API 106/106, Providers 17/17, and Worker 14/14 remain locked authoritative regression evidence from the preceding checkpoint.

## Customer Generation Composer

Implemented on branch `feat/customer-generation-modes`:

- Customer API client supports an explicit `GenerationMode` contract.
- Customer composer exposes first-class Text to Video, Image to Video, and AI Director modes.
- Text to Video submits prompt-only requests and leaves provider routing to the server.
- Image to Video uses authenticated uploaded `imageAssetId`; no raw image URL is requested from the customer.
- AI Director is visible as `Coming soon` and cannot submit a generation request.
- Provider/model names and provider-specific controls are hidden from the customer UI.
- Prompt field accepts Hindi, Marathi, Chinese, English, and other Unicode scripts.
- Customer-facing controls are limited to duration and prompt enhancement.

## Verification state

Customer typecheck and production build were verified locally and passed:

- `npm run -w @ak-vision-ai/customer typecheck` — PASS
- `npm run -w @ak-vision-ai/customer build` — PASS
- Vite transformed 2224 modules and produced a production bundle.

Fresh browser Text to Video E2E reached the authoritative pricing layer but failed because the live database had no active `seedance_2_0` / INR / second pricing row.

## Pricing fix

Migration `packages/database/drizzle/0015_seedance_2_0_pricing.sql` was added on this branch. It inserts a guarded Seedance 2.0 baseline at 2500 minor units per second (₹25/sec), effective 2026-09-10, without silently overriding an already-active row.

This is a project baseline derived from a public approximately $0.25/sec model-cost reference and rounded upward for conservative accounting. Future provider billing changes must be handled by authoritative pricing updates rather than application fallbacks.

## Known compatibility follow-up

The current customer duration selector still exposes 3 seconds, while the Seedance 2.0 provider adapter requires 4–15 seconds for Text to Video. Do not use the 3-second T2V option until that UI/contract mismatch is removed. Image to Video DoP remains on its existing 3/5-second path.

## Next exact gate

1. Pull the branch and run `npm run -w @ak-vision-ai/database db:migrate`.
2. Verify the active Seedance pricing row directly in PostgreSQL.
3. Retry Text to Video with 5 seconds and record pricing + HTTP 201 evidence.
4. Run focused Image to Video regression.
5. Then proceed to fresh real-customer E2E and P3-61E close.

Do not reopen green backend work unless regression evidence requires it.
