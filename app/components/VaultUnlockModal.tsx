"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useGenotype } from "./UserDataUpload";
import { useResults } from "./ResultsContext";
import { useVault } from "./VaultContext";
import { dataFingerprint, deserializeGenotype, deserializeResults } from "@/lib/vault-snapshots";

// Asks for the passphrase when saved data exists, and restores it once the vault is unlocked.
export default function VaultUnlockModal() {
  const vault = useVault();
  const { isUploaded, restoreGenotype } = useGenotype();
  const { savedResults, restoreResults } = useResults();
  const [dismissed, setDismissed] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const restoreAttempted = useRef(false);

  // Restore on any unlock (this prompt, Save, or Personalize), but never over data already in memory
  useEffect(() => {
    if (vault.status !== "unlocked" || restoreAttempted.current) return;
    restoreAttempted.current = true;
    if (isUploaded || savedResults.length > 0) return;

    const restore = async () => {
      const genotypeBytes = await vault.loadSection("genotype");
      const snapshot = genotypeBytes ? deserializeGenotype(genotypeBytes) : null;
      if (snapshot) restoreGenotype(snapshot);

      const resultsBytes = await vault.loadSection("results");
      const results = resultsBytes ? deserializeResults(resultsBytes) : [];
      if (results.length > 0) await restoreResults(results);

      vault.setSavedFingerprint(dataFingerprint(snapshot?.fileHash ?? null, results));
    };

    restore().catch((err) => console.error("[Vault] Restore failed:", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault.status]);

  const sections = vault.header?.sections ?? {};
  const hasSavedDNA = !!(sections.genotype || sections.results);
  // Users with only personalization saved keep unlocking it from the Personalize button
  if (vault.status !== "locked" || !hasSavedDNA || dismissed) return null;

  const lastSaved = [sections.genotype, sections.results]
    .filter((date): date is string => !!date)
    .sort()
    .pop();

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsWorking(true);
    const success = await vault.unlock(passphrase);
    setIsWorking(false);
    if (success) {
      setPassphrase("");
    } else {
      setError("Incorrect passphrase");
    }
  };

  const handleDelete = async () => {
    if (confirm("Delete all data saved on this device, including personalization? This cannot be undone.")) {
      await vault.deleteAll();
    }
  };

  const modalContent = (
    <div className="modal-overlay">
      <div className="modal-dialog customization-modal">
        <div className="modal-content">
          <h2>Welcome Back</h2>
          <div className="customization-info">
            <p>
              You have encrypted data saved on this device
              {lastSaved ? ` from ${new Date(lastSaved).toLocaleDateString()}` : ""}.
              Enter your passphrase to load it.
            </p>
          </div>
          <form onSubmit={handleUnlock}>
            <div className="form-group">
              <label htmlFor="vault-unlock-passphrase">Passphrase</label>
              <input
                type="password"
                id="vault-unlock-passphrase"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Enter passphrase"
                autoFocus
              />
            </div>

            {error && <div className="error-message">❌ {error}</div>}

            <div className="modal-actions">
              <button type="button" className="disclaimer-button danger" onClick={handleDelete}>
                Delete Saved Data
              </button>
              <button type="button" className="disclaimer-button secondary" onClick={() => setDismissed(true)}>
                Not Now
              </button>
              <button type="submit" className="disclaimer-button primary" disabled={isWorking || !passphrase}>
                {isWorking ? "Unlocking..." : "Unlock"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modalContent, document.body) : null;
}
