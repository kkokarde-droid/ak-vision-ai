import test from "node:test";
import assert from "node:assert/strict";

import { ProviderRegistry } from "@ak-vision-ai/ai-core";
import type {
  AIProvider,
  AIProviderContext,
  AIProviderRequest,
} from "@ak-vision-ai/ai-core";
import type {
  AIResponse,
  AITaskType,
  ProviderCapability,
} from "@ak-vision-ai/types";

class TestProvider implements AIProvider {
  readonly status: "active" | "disabled";
  readonly capabilities: readonly ProviderCapability[];

  constructor(
    public readonly providerId: string,
    public readonly providerName: string,
    capabilities: readonly ProviderCapability[],
    status: "active" | "disabled" = "active",
  ) {
    this.capabilities = capabilities;
    this.status = status;
  }

  supports(taskType: AITaskType): boolean {
    return this.capabilities.includes(taskType);
  }

  supportsCapability(capability: ProviderCapability): boolean {
    return this.capabilities.includes(capability);
  }

  async generate<T = unknown>(
    input: AIProviderRequest,
    context: AIProviderContext,
  ): Promise<AIResponse<T>> {
    return {
      requestId: context.requestId,
      success: true,
      result: {
        provider: this.providerId,
        taskType: input.taskType,
      } as T,
      createdAt: new Date().toISOString(),
    };
  }
}

test("register/get/has/size", () => {
  const registry = new ProviderRegistry();

  const provider = new TestProvider(
    "chat-provider",
    "Chat Provider",
    ["chat"],
  );

  assert.equal(registry.size(), 0);
  assert.equal(registry.has("chat-provider"), false);
  assert.equal(registry.get("chat-provider"), undefined);

  registry.register(provider);

  assert.equal(registry.size(), 1);
  assert.equal(registry.has("chat-provider"), true);
  assert.equal(registry.get("chat-provider"), provider);
});

test("duplicate provider registration is rejected", () => {
  const registry = new ProviderRegistry();

  const provider = new TestProvider(
    "duplicate-provider",
    "Duplicate Provider",
    ["chat"],
  );

  registry.register(provider);

  assert.throws(
    () => registry.register(provider),
    /Provider already registered: duplicate-provider/,
  );

  assert.equal(registry.size(), 1);
});

test("findForTask returns only enabled providers supporting the task", () => {
  const registry = new ProviderRegistry();

  const chatProvider = new TestProvider(
    "chat-provider",
    "Chat Provider",
    ["chat"],
  );

  const videoProvider = new TestProvider(
    "video-provider",
    "Video Provider",
    ["video-generation"],
  );

  const disabledChatProvider = new TestProvider(
    "disabled-chat-provider",
    "Disabled Chat Provider",
    ["chat"],
    "disabled",
  );

  registry.register(chatProvider);
  registry.register(videoProvider);
  registry.register(disabledChatProvider);

  const chatProviders = registry.findForTask("chat");
  const videoProviders = registry.findForTask("video-generation");

  assert.deepEqual(
    chatProviders.map((provider) => provider.providerId),
    ["chat-provider"],
  );

  assert.deepEqual(
    videoProviders.map((provider) => provider.providerId),
    ["video-provider"],
  );
});

test("findForCapability returns only enabled providers with the capability", () => {
  const registry = new ProviderRegistry();

  const chatProvider = new TestProvider(
    "chat-provider",
    "Chat Provider",
    ["chat"],
  );

  const multiProvider = new TestProvider(
    "multi-provider",
    "Multi Provider",
    ["chat", "video-generation"],
  );

  const disabledMultiProvider = new TestProvider(
    "disabled-multi-provider",
    "Disabled Multi Provider",
    ["chat", "video-generation"],
    "disabled",
  );

  registry.register(chatProvider);
  registry.register(multiProvider);
  registry.register(disabledMultiProvider);

  const providers = registry.findForCapability("video-generation");

  assert.deepEqual(
    providers.map((provider) => provider.providerId),
    ["multi-provider"],
  );
});

test("list returns all registered providers including disabled providers", () => {
  const registry = new ProviderRegistry();

  registry.register(
    new TestProvider(
      "active-provider",
      "Active Provider",
      ["chat"],
      "active",
    ),
  );

  registry.register(
    new TestProvider(
      "disabled-provider",
      "Disabled Provider",
      ["chat"],
      "disabled",
    ),
  );

  assert.deepEqual(
    registry.list().map((provider) => provider.providerId),
    ["active-provider", "disabled-provider"],
  );
});

test("listActive returns only active providers", () => {
  const registry = new ProviderRegistry();

  registry.register(
    new TestProvider(
      "active-provider",
      "Active Provider",
      ["chat"],
      "active",
    ),
  );

  registry.register(
    new TestProvider(
      "disabled-provider",
      "Disabled Provider",
      ["chat"],
      "disabled",
    ),
  );

  assert.deepEqual(
    registry.listActive().map((provider) => provider.providerId),
    ["active-provider"],
  );
});

test("unregister removes provider and reports whether removal occurred", () => {
  const registry = new ProviderRegistry();

  const provider = new TestProvider(
    "removable-provider",
    "Removable Provider",
    ["chat"],
  );

  registry.register(provider);

  assert.equal(registry.unregister("removable-provider"), true);
  assert.equal(registry.unregister("removable-provider"), false);
  assert.equal(registry.has("removable-provider"), false);
  assert.equal(registry.get("removable-provider"), undefined);
  assert.equal(registry.size(), 0);
});

test("clear removes all providers", () => {
  const registry = new ProviderRegistry();

  registry.register(
    new TestProvider(
      "provider-one",
      "Provider One",
      ["chat"],
    ),
  );

  registry.register(
    new TestProvider(
      "provider-two",
      "Provider Two",
      ["video-generation"],
    ),
  );

  assert.equal(registry.size(), 2);

  registry.clear();

  assert.equal(registry.size(), 0);
  assert.deepEqual(registry.list(), []);
  assert.deepEqual(registry.listActive(), []);
});

test("unknown task and capability return empty results", () => {
  const registry = new ProviderRegistry();

  registry.register(
    new TestProvider(
      "chat-provider",
      "Chat Provider",
      ["chat"],
    ),
  );

  assert.deepEqual(
    registry.findForTask("video-generation"),
    [],
  );

  assert.deepEqual(
    registry.findForCapability("video-generation"),
    [],
  );
});

console.log("Provider registry regression tests registered.");
