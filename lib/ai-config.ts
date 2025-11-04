/**
 * Centralized AI Configuration Service
 *
 * Manages AI provider and model selection with localStorage persistence.
 * All LLM invocations should use this service to get the current configuration.
 */

export type AIProvider = 'nilai' | 'ollama' | 'huggingface';

export interface AIConfig {
  provider: AIProvider;
  model: string;
  ollamaAddress?: string;
  ollamaPort?: number;
  huggingfaceApiKey?: string;
}

const STORAGE_KEY = 'gwasifier_ai_config';

const DEFAULT_CONFIG: AIConfig = {
  provider: 'nilai',
  model: 'gpt-oss-20b',
};

/**
 * Get the current AI configuration from localStorage
 */
export function getAIConfig(): AIConfig {
  if (typeof window === 'undefined') {
    return DEFAULT_CONFIG;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as AIConfig;
      // Validate provider
      if (!['nilai', 'ollama', 'huggingface'].includes(parsed.provider)) {
        return DEFAULT_CONFIG;
      }
      return parsed;
    }
  } catch (error) {
    console.error('[AI Config] Failed to load from localStorage:', error);
  }

  return DEFAULT_CONFIG;
}

/**
 * Save AI configuration to localStorage
 */
export function saveAIConfig(config: AIConfig): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (error) {
    console.error('[AI Config] Failed to save to localStorage:', error);
  }
}

/**
 * Get the display name for the current provider
 */
export function getProviderDisplayName(provider: AIProvider): string {
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
export function getModelIdentifier(config: AIConfig): string {
  switch (config.provider) {
    case 'nilai':
      return 'openai/gpt-oss-20b';
    case 'ollama':
      return config.model;
    case 'huggingface':
      return 'openai/gpt-oss-20b:together';
  }
}

/**
 * Get the API endpoint for the current provider
 */
export function getAPIEndpoint(config: AIConfig): string {
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
export function isClientSideOnly(provider: AIProvider): boolean {
  // nilAI uses delegation tokens and is client-side only
  // Ollama and HuggingFace can be called from client directly
  return true; // All providers are client-side only now
}

/**
 * Get available models for a provider
 */
export function getAvailableModels(provider: AIProvider): string[] {
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
export function isConfigValid(config: AIConfig): { valid: boolean; error?: string } {
  if (config.provider === 'huggingface' && !config.huggingfaceApiKey) {
    return { valid: false, error: 'HuggingFace API key is required' };
  }

  // Ollama address and port have defaults ('localhost' and 11434) so always valid
  // No additional validation needed

  return { valid: true };
}
