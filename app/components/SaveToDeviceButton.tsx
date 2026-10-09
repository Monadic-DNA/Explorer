"use client";

import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useGenotype } from "./UserDataUpload";
import { useResults } from "./ResultsContext";
import { useVault, MIN_PASSPHRASE_LENGTH } from "./VaultContext";
import { SaveIcon } from "./Icons";
import { dataFingerprint, serializeGenotype, serializeResults } from "@/lib/vault-snapshots";

type SaveState = "idle" | "saving" | "saved" | "error";

export default function SaveToDeviceButton() {
  const vault = useVault();
  const { fileHash, getGenotypeSnapshot } = useGenotype();
  const { savedResults } = useResults();
  const [showPassphraseModal, setShowPassphraseModal] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const fingerprint = useMemo(() => dataFingerprint(fileHash, savedResults), [fileHash, savedResults]);
  const hasData = !!fileHash || savedResults.length > 0;
  const isDirty = hasData && fingerprint !== vault.savedFingerprint;

  // Warn before leaving only for users who have opted in to saving
  useEffect(() => {
    if (!vault.header || !isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [vault.header, isDirty]);

  // Saving with nothing in memory for a section removes that section from the vault
  const saveAll = async () => {
    setSaveState("saving");
    try {
      const snapshot = getGenotypeSnapshot();
      if (snapshot) {
        await vault.saveSection("genotype", serializeGenotype(snapshot));
      } else {
        await vault.removeSection("genotype");
      }

      if (savedResults.length > 0) {
        await vault.saveSection("results", serializeResults(savedResults));
      } else {
        await vault.removeSection("results");
      }

      vault.setSavedFingerprint(fingerprint);
      setSaveState("saved");
    } catch (error) {
      console.error("[Vault] Save failed:", error);
      setSaveState("error");
    }
  };

  const handleClick = () => {
    if (vault.status === "unlocked") {
      saveAll();
    } else {
      setShowPassphraseModal(true);
    }
  };

  const handlePassphrase = async (passphrase: string): Promise<string | null> => {
    if (vault.status === "locked") {
      if (!(await vault.unlock(passphrase))) return "Incorrect passphrase";
    } else {
      try {
        await vault.create(passphrase);
      } catch (error) {
        return error instanceof Error ? error.message : "Could not create saved data";
      }
    }
    setShowPassphraseModal(false);
    await saveAll();
    return null;
  };

  let badge: string | null = null;
  if (saveState === "saving") badge = "Saving...";
  else if (saveState === "error") badge = "Failed";
  else if (isDirty && vault.header) badge = "Unsaved";
  else if (saveState === "saved" && !isDirty) badge = "Saved";

  return (
    <>
      <button
        className="menu-icon-button"
        onClick={handleClick}
        disabled={!hasData || vault.status === "loading" || saveState === "saving"}
        title="Save your DNA data and results on this device, encrypted with your passphrase"
        data-tour="save-button"
      >
        <span className="icon">
          <SaveIcon size={32} />
        </span>
        <span className="label">Save</span>
        {badge && <span className="badge">{badge}</span>}
      </button>
      <PassphraseModal
        isOpen={showPassphraseModal}
        mode={vault.status === "locked" ? "unlock" : "create"}
        usesLegacyPassword={vault.hasLegacyPersonalization && !vault.header}
        onSubmit={handlePassphrase}
        onClose={() => setShowPassphraseModal(false)}
      />
    </>
  );
}

function PassphraseModal({
  isOpen,
  mode,
  usesLegacyPassword,
  onSubmit,
  onClose,
}: {
  isOpen: boolean;
  mode: "create" | "unlock";
  usesLegacyPassword: boolean;
  onSubmit: (passphrase: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPassphrase("");
      setConfirmPassphrase("");
      setError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Users with only legacy personalization reuse that password, so no new passphrase is chosen
  const isCreating = mode === "create" && !usesLegacyPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isCreating) {
      if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
        setError(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);
        return;
      }
      if (passphrase !== confirmPassphrase) {
        setError("Passphrases do not match");
        return;
      }
    }

    setIsWorking(true);
    const result = await onSubmit(passphrase);
    setIsWorking(false);
    if (result) setError(result);
  };

  let title = "Save on This Device";
  let description = "Choose a passphrase. Your DNA data and results will be encrypted with it and stored only in this browser. Nothing is sent to our servers. The passphrase cannot be recovered if you forget it.";
  if (mode === "unlock") {
    title = "Unlock Saved Data";
    description = "Enter the passphrase for the data already saved on this device. Saving will replace the saved DNA data and results with what is loaded now.";
  } else if (usesLegacyPassword) {
    description = "Enter your personalization password. It will also protect your DNA data and results, which are encrypted and stored only in this browser.";
  }

  const modalContent = (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog customization-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-content">
          <h2>{title}</h2>
          <div className="customization-info">
            <p>{description}</p>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="vault-passphrase">Passphrase</label>
              <input
                type="password"
                id="vault-passphrase"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Enter passphrase"
                autoFocus
              />
            </div>
            {isCreating && (
              <div className="form-group">
                <label htmlFor="vault-passphrase-confirm">Confirm Passphrase</label>
                <input
                  type="password"
                  id="vault-passphrase-confirm"
                  value={confirmPassphrase}
                  onChange={(e) => setConfirmPassphrase(e.target.value)}
                  placeholder="Re-enter passphrase"
                />
              </div>
            )}

            {error && <div className="error-message">❌ {error}</div>}

            <div className="modal-actions">
              <button type="button" className="disclaimer-button secondary" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="disclaimer-button primary" disabled={isWorking || !passphrase}>
                {isWorking ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modalContent, document.body) : null;
}
