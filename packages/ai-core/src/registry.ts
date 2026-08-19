import type {
  AITaskType,
  ProviderCapability,
} from "@ak-vision-ai/types";
import type { AIProvider } from "./provider.js";

export class ProviderRegistry {
  private readonly providers = new Map<string, AIProvider>();

  register(provider: AIProvider): void {
    if (this.providers.has(provider.providerId)) {
      throw new Error(
        `Provider already registered: ${provider.providerId}`,
      );
    }

    this.providers.set(provider.providerId, provider);
  }

  get(providerId: string): AIProvider | undefined {
    return this.providers.get(providerId);
  }

  findForTask(taskType: AITaskType): AIProvider[] {
    return Array.from(this.providers.values()).filter(
      (provider) =>
        provider.status !== "disabled" &&
        provider.supports(taskType),
    );
  }

  findForCapability(
    capability: ProviderCapability,
  ): AIProvider[] {
    return Array.from(this.providers.values()).filter(
      (provider) =>
        provider.status !== "disabled" &&
        provider.supportsCapability(capability),
    );
  }

  list(): AIProvider[] {
    return Array.from(this.providers.values());
  }

  listActive(): AIProvider[] {
    return Array.from(this.providers.values()).filter(
      (provider) => provider.status === "active",
    );
  }

  has(providerId: string): boolean {
    return this.providers.has(providerId);
  }

  unregister(providerId: string): boolean {
    return this.providers.delete(providerId);
  }

  clear(): void {
    this.providers.clear();
  }

  size(): number {
    return this.providers.size;
  }
}
