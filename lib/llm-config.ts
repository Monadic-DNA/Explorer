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

const STORAGE_KEY = 'gwasifier_llm_config';

const DEFAULT_CONFIG: LLMConfig = {
  provider: 'nilai',
  model: 'gpt-oss-20b',
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
      // Validate provider
      if (!['nilai', 'ollama', 'huggingface'].includes(parsed.provider)) {
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
export function getProviderDisplayName(provider: LLMProvider): string {
  switch (provider) {
    case 'nilai':
      return 'Nillion nilAI';
    case 'ollama':
      return 'Ollama (Local)';
    case 'huggingface':
      return 'HuggingFace';
  }
}

/**
 * Get the full model identifier for API calls
 */
export function getModelIdentifier(config: LLMConfig): string {
  // If custom model is selected, use the custom model name
  if (config.model === 'custom' && config.customModel) {
    return config.customModel;
  }

  switch (config.provider) {
    case 'nilai':
      return config.model === 'gpt-oss-20b' ? 'openai/gpt-oss-20b' : config.model;
    case 'ollama':
      return config.model;
    case 'huggingface':
      // For HuggingFace, append :together suffix if not already present
      if (config.model === 'gpt-oss-20b') {
        return 'openai/gpt-oss-20b:together';
      } else if (config.model === 'openai/gpt-oss-120b') {
        return 'openai/gpt-oss-120b:together';
      }
      return config.model.includes(':') ? config.model : `${config.model}:together`;
  }
}

/**
 * Get the API endpoint for the current provider
 */
export function getAPIEndpoint(config: LLMConfig): string {
  switch (config.provider) {
    case 'nilai':
      return 'https://nilai-f910.nillion.network/nuc/v1/';
    case 'ollama':
      const address = config.ollamaAddress || 'localhost';
      const port = config.ollamaPort || 11434;
      return `http://${address}:${port}`;
    case 'huggingface':
      return 'https://router.huggingface.co/v1';
  }
}

/**
 * Check if the current configuration requires client-side only processing
 */
export function isClientSideOnly(provider: LLMProvider): boolean {
  // nilAI uses delegation tokens and is client-side only
  // Ollama and HuggingFace can be called from client directly
  return true; // All providers are client-side only now
}

/**
 * Get available models for a provider
 */
export function getAvailableModels(provider: LLMProvider): string[] {
  switch (provider) {
    case 'nilai':
      return ['gpt-oss-20b'];
    case 'ollama':
      return ['gpt-oss-20b']; // Default, user can enter custom
    case 'huggingface':
      return ['gpt-oss-20b'];
  }
}

/**
 * Validate if a configuration is complete
 */
export function isConfigValid(config: LLMConfig): { valid: boolean; error?: string } {
  if (config.provider === 'huggingface' && !config.huggingfaceApiKey) {
    return { valid: false, error: 'HuggingFace API key is required' };
  }

  if (config.model === 'custom' && !config.customModel?.trim()) {
    return { valid: false, error: 'Custom model name is required when "Custom..." is selected' };
  }

  // Ollama address and port have defaults ('localhost' and 11434) so always valid
  // No additional validation needed

  return { valid: true };
}
