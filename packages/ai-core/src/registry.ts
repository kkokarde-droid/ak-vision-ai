import type { AITaskType } from "@ak-vision-ai/types";
import type { AIProvider } from "./provider.js";

export class ProviderRegistry {
  private readonly providers = new Map<string, AIProvider>();

  register(provider: AIProvider): void {
    this.providers.set(provider.providerId, provider);
  }

  get(providerId: string): AIProvider | undefined {
    return this.providers.get(providerId);
  }

  findForTask(taskType: AITaskType): AIProvider[] {
    return Array.from(this.providers.values()).filter((provider) =>
      provider.supports(taskType),
    );
  }

  list(): AIProvider[] {
    return Array.from(this.providers.values());
  }

  has(providerId: string): boolean {
    return this.providers.has(providerId);
  }
}
