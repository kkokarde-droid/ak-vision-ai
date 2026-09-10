# Current Checkpoint

Date: 2026-09-10

## V1 status

Backend integrity remains GREEN. API 106/106, Providers 17/17, Worker 14/14 remain the authoritative regression evidence from the preceding checkpoint.

## Customer Generation Composer

Implemented on branch `feat/customer-generation-modes`:

- Customer API client now supports an explicit `GenerationMode` contract.
- Customer composer exposes first-class Text to Video, Image to Video, and AI Director modes.
- Text to Video submits prompt-only requests and leaves provider routing to the server.
- Image to Video uses authenticated uploaded `imageAssetId`; no raw image URL is requested from the customer.
- AI Director is visible as `Coming soon` and cannot submit a generation request.
- Provider/model names and provider-specific controls are hidden from the customer UI.
- Prompt field explicitly accepts Hindi, Marathi, Chinese, English, and other Unicode scripts.
- Customer-facing controls are limited to duration and prompt enhancement.

## Verification state

Code diff is isolated to `apps/customer/src/App.tsx`, `apps/customer/src/api.ts`, and customer contract/checkpoint documentation. Local typecheck/build could not be executed in the current execution environment because outbound DNS access to GitHub is unavailable. No claim of passing customer typecheck/build is made until the repository can run its normal commands.

## Next gate

Run customer typecheck/build in the project environment, then perform focused contract regression for Text to Video and Image to Video, followed by browser-based fresh real-customer E2E. Do not reopen green backend work unless regression evidence requires it.
