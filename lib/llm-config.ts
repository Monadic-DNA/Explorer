import { coreCall } from "./core";

/**
 * Centralized LLM Configuration Service
 *
 * Manages LLM provider and model selection with localStorage persistence.
 * All LLM invocations should use this service to get the current configuration.
 */

export type LLMProvider = 'nilai' | 'ollama' | 'huggingface';

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  customModel?: string;
  ollamaAddress?: string;
  ollamaPort?: number;
  huggingfaceApiKey?: string;
}

const STORAGE_KEY = 'monadic_dna_explorer_llm_config';

const DEFAULT_CONFIG: LLMConfig = {
  provider: 'nilai',
  model: 'gemma-4-26B-A4B-it',
};

/**
 * Get the current LLM configuration from localStorage
 */
export function getLLMConfig(): LLMConfig {
  if (typeof window === 'undefined') {
    return DEFAULT_CONFIG;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as LLMConfig;
      if (!['nilai', 'ollama', 'huggingface'].includes(parsed.provider)) {
        return DEFAULT_CONFIG;
      }
      // For nilai, reject models that are no longer supported (stale localStorage)
      if (parsed.provider === 'nilai' && parsed.model !== 'gemma-4-26B-A4B-it' && parsed.model !== 'custom') {
        return DEFAULT_CONFIG;
      }
      return parsed;
    }
  } catch (error) {
    console.error('[LLM Config] Failed to load from localStorage:', error);
  }

  return DEFAULT_CONFIG;
}

/**
 * Save LLM configuration to localStorage
 */
export function saveLLMConfig(config: LLMConfig): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (error) {
    console.error('[LLM Config] Failed to save to localStorage:', error);
  }
}

/**
 * Get the display name for the current provider
 */
type PortableConfig = { identifier: string; endpoint: string; displayName: string; models: string[]; validation: { valid: boolean; error?: string } };
export function getProviderDisplayName(provider: LLMProvider): string { return coreCall<PortableConfig>("llm_config", { provider }).displayName; }
export function getModelIdentifier(config: LLMConfig): string { return coreCall<PortableConfig>("llm_config", config).identifier; }
export function getAPIEndpoint(config: LLMConfig): string { return coreCall<PortableConfig>("llm_config", config).endpoint; }
export function isClientSideOnly(provider: LLMProvider): boolean { void provider; return true; }
export function getAvailableModels(provider: LLMProvider): string[] { return coreCall<PortableConfig>("llm_config", { provider }).models; }
export function isConfigValid(config: LLMConfig): { valid: boolean; error?: string } { return coreCall<PortableConfig>("llm_config", config).validation; }
