import { ProviderRegistry } from "@ak-vision-ai/ai-core";
import { MockProvider } from "./mock.provider.js";

const registry = new ProviderRegistry();
const mockProvider = new MockProvider();

registry.register(mockProvider);

const providers = registry.findForTask("chat");

if (providers.length !== 1) {
  throw new Error(
    `Expected exactly 1 chat provider, found ${providers.length}`,
  );
}

if (providers[0]?.providerId !== "mock") {
  throw new Error(
    `Expected mock provider, found ${providers[0]?.providerId ?? "none"}`,
  );
}

console.log("Provider registry test passed.");
