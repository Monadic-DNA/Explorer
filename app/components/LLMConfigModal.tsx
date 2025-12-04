"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  LLMConfig,
  LLMProvider,
  getLLMConfig,
  saveLLMConfig,
  isConfigValid,
} from "@/lib/llm-config";
import { trackAIProviderSwitched } from "@/lib/analytics";

type LLMConfigModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSave?: () => void;
};

export default function LLMConfigModal({ isOpen, onClose, onSave }: LLMConfigModalProps) {
  const [config, setConfig] = useState<LLMConfig>(getLLMConfig());
  const [showApiKey, setShowApiKey] = useState(false);
  const [initialProvider, setInitialProvider] = useState<LLMProvider>(getLLMConfig().provider);

  useEffect(() => {
    if (isOpen) {
      // Reload config when modal opens and track initial provider
      const currentConfig = getLLMConfig();
      setConfig(currentConfig);
      setInitialProvider(currentConfig.provider);
    }
  }, [isOpen]);

  const handleSave = () => {
    const validation = isConfigValid(config);
    if (!validation.valid) {
      alert(validation.error);
      return;
    }

    saveLLMConfig(config);

    // Track if provider was changed
    if (config.provider !== initialProvider) {
      trackAIProviderSwitched(config.provider);
    }

    onSave?.();
    onClose();
  };

  if (!isOpen) return null;

  const modalContent = (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-dialog llm-config-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-content">
          <h2>⚙️ LLM Provider Settings</h2>

          <div className="config-section">
            <label className="config-label">
              <strong>LLM Provider</strong>
            </label>
            <select
              className="config-select"
              value={config.provider}
              onChange={(e) => {
                const newProvider = e.target.value as LLMProvider;
                const newConfig = { ...config, provider: newProvider };
                // Set defaults for Ollama when switching to it
                if (newProvider === 'ollama' && !config.ollamaAddress && !config.ollamaPort) {
                  newConfig.ollamaAddress = 'localhost';
                  newConfig.ollamaPort = 11434;
                }
                setConfig(newConfig);
              }}
            >
              <option value="nilai">nilAI (Default)</option>
              <option value="ollama">Ollama (Local)</option>
              <option value="huggingface">HuggingFace</option>
            </select>
            <p className="config-help">
              {config.provider === 'nilai' && (
                <>🛡️ Privacy-preserving LLM in a Trusted Execution Environment. No API key required.</>
              )}
              {config.provider === 'ollama' && (
                <>🖥️ Run LLM models locally on your machine. Requires Ollama installation.</>
              )}
              {config.provider === 'huggingface' && (
                <>☁️ Cloud-based LLM via HuggingFace Router. Requires API key.</>
              )}
            </p>
          </div>

          <div className="config-section">
            <label className="config-label">
              <strong>Model</strong>
            </label>
            <select
              className="config-select"
              value={config.model}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
            >
              {config.provider === 'ollama' ? (
                <>
                  <option value="gpt-oss:latest">gpt-oss:latest (Ollama format)</option>
                  <option value="gpt-oss-20b">gpt-oss-20b</option>
                  <option value="openai/gpt-oss-120b">openai/gpt-oss-120b</option>
                  <option value="custom">Custom...</option>
                </>
              ) : config.provider === 'nilai' ? (
                <>
                  <option value="gpt-oss-20b">gpt-oss-20b</option>
                  <option value="custom">Custom...</option>
                </>
              ) : (
                <>
                  <option value="gpt-oss-20b">gpt-oss-20b</option>
                  <option value="openai/gpt-oss-120b">openai/gpt-oss-120b</option>
                  <option value="deepseek-ai/DeepSeek-V3.2">deepseek-ai/DeepSeek-V3.2</option>
                  <option value="moonshotai/Kimi-K2-Thinking">moonshotai/Kimi-K2-Thinking</option>
                  <option value="zai-org/GLM-4.6">zai-org/GLM-4.6</option>
                  <option value="custom">Custom...</option>
                </>
              )}
            </select>
            <p className="config-help">
              {config.provider === 'ollama'
                ? 'Select the model format that matches your Ollama installation or choose Custom to enter your own.'
                : 'Select a preset model or choose Custom to enter your own model name.'}
            </p>
          </div>

          {config.model === 'custom' && (
            <div className="config-section">
              <label className="config-label">
                <strong>Custom Model Name</strong>
              </label>
              <input
                type="text"
                className="config-input"
                value={config.customModel || ''}
                onChange={(e) =>
                  setConfig({ ...config, customModel: e.target.value })
                }
                placeholder="Enter model name (e.g., gpt-oss-20b, openai/gpt-oss-120b)"
              />
              <p className="config-help">
                Enter the exact model identifier for your provider.
              </p>
            </div>
          )}

          {config.provider === 'ollama' && (
            <>
              <div className="config-section">
                <label className="config-label">
                  <strong>Ollama Address</strong>
                </label>
                <input
                  type="text"
                  className="config-input"
                  value={config.ollamaAddress || 'localhost'}
                  onChange={(e) =>
                    setConfig({ ...config, ollamaAddress: e.target.value })
                  }
                  placeholder="localhost"
                />
              </div>

              <div className="config-section">
                <label className="config-label">
                  <strong>Ollama Port</strong>
                </label>
                <input
                  type="number"
                  className="config-input"
                  value={config.ollamaPort || 11434}
                  onChange={(e) =>
                    setConfig({ ...config, ollamaPort: parseInt(e.target.value) || 11434 })
                  }
                  placeholder="11434"
                />
              </div>
            </>
          )}

          {config.provider === 'huggingface' && (
            <div className="config-section">
              <label className="config-label">
                <strong>HuggingFace API Key</strong>
              </label>
              <div className="config-input-group">
                <input
                  type={showApiKey ? "text" : "password"}
                  className="config-input"
                  value={config.huggingfaceApiKey || ''}
                  onChange={(e) =>
                    setConfig({ ...config, huggingfaceApiKey: e.target.value })
                  }
                  placeholder="hf_..."
                />
                <button
                  className="config-toggle-button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  type="button"
                >
                  {showApiKey ? '🙈' : '👁️'}
                </button>
              </div>
              <p className="config-help">
                Get your API key from <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noopener noreferrer">HuggingFace Settings</a>
              </p>
            </div>
          )}

          <div className="config-info llm-privacy-notice">
            <h4>🔒 Privacy & Data Flow</h4>
            <div className="privacy-details">
              <p><strong>How it works:</strong></p>
              <ul>
                <li><strong>nilAI (Default):</strong> Your genetic variants are sent to a Trusted Execution Environment (TEE) where analysis happens in an encrypted, isolated environment. No one, not even Nillion, can see your raw data. Usage is covered by your Monadic DNA subscription.</li>
                <li><strong>Ollama (Advanced):</strong> Everything runs locally on your computer. No data leaves your device. <a href="https://ollama.com" target="_blank" rel="noopener noreferrer" className="inline-link">Download Ollama</a> and note that you need a powerful GPU (8GB+ VRAM recommended) for acceptable performance.</li>
                <li><strong>HuggingFace:</strong> Your variants are sent directly from your browser to HuggingFace's servers for analysis. Requires your own HuggingFace account and paid subscription. We never see or store your data.</li>
              </ul>
              <p><strong>What's sent:</strong> Only the specific genetic variants (SNPs) relevant to each trait you analyze, not your entire genome.</p>
              <p><strong>Our servers:</strong> Your genetic data never passes through Monadic DNA's servers. We only facilitate the connection.</p>
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button className="disclaimer-button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="disclaimer-button primary" onClick={handleSave}>
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(modalContent, document.body)
    : null;
}
