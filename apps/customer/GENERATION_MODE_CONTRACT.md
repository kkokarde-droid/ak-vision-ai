# Customer Generation Mode Contract

## Customer-facing modes

The customer composer exposes three first-class creation paths:

- **Text to Video** — natural-language prompt only. No provider/model input is exposed.
- **Image to Video** — natural-language motion direction plus an uploaded image asset. Customers never enter an image URL.
- **AI Director** — visible as an upcoming capability and must remain non-executable until the server capability is complete.

## Hidden implementation details

Provider IDs, provider URLs, routing decisions, pricing internals, and provider-specific input fields remain server-controlled.

For the current V1 image-to-video path, the customer client may request the established default internally, while the UI must not expose the provider/model name.

## Language acceptance

Prompt text must remain Unicode-safe. The composer explicitly accepts English, Hindi, Marathi, Chinese, and other Unicode scripts without client-side ASCII restrictions.

## Generation controls

Customer-facing controls are limited to intent-level choices such as duration and prompt enhancement. Provider-specific model controls are not part of the customer contract.
