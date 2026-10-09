"use client";

import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from "react";
import { decryptData, EncryptedData } from "@/lib/encryption-utils";
import {
  VaultHeader,
  VaultSection,
  createVault,
  deleteVault,
  getVaultHeader,
  readVaultSection,
  removeVaultSection,
  unlockVault,
  writeVaultSection,
} from "@/lib/secure-vault";

// Removed dev mode kept a plaintext passphrase in this database. Delete it from existing browsers.
const LEGACY_DEV_MODE_DB = "monadic_dna_explorer_dev_mode";

// Personalization used to be stored here on its own. It moves into the vault on first unlock.
export const LEGACY_PERSONALIZATION_KEY = "user_customization_encrypted";

export const MIN_PASSPHRASE_LENGTH = 10;

type VaultStatus = "loading" | "none" | "locked" | "unlocked";

type VaultContextType = {
  status: VaultStatus;
  header: VaultHeader | null;
  hasLegacyPersonalization: boolean;
  create: (passphrase: string) => Promise<void>;
  unlock: (passphrase: string) => Promise<boolean>;
  lock: () => void;
  deleteAll: () => Promise<void>;
  saveSection: (section: VaultSection, data: Uint8Array) => Promise<void>;
  loadSection: (section: VaultSection) => Promise<Uint8Array | null>;
  removeSection: (section: VaultSection) => Promise<void>;
  // Fingerprint of the genotype and results as of the last save or restore
  savedFingerprint: string | null;
  setSavedFingerprint: (fingerprint: string | null) => void;
};

const VaultContext = createContext<VaultContextType | null>(null);

function readLegacyPersonalization(): EncryptedData | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(LEGACY_PERSONALIZATION_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as EncryptedData;
  } catch {
    return null;
  }
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<VaultStatus>("loading");
  const [header, setHeader] = useState<VaultHeader | null>(null);
  const [hasLegacyPersonalization, setHasLegacyPersonalization] = useState(false);
  const [savedFingerprint, setSavedFingerprint] = useState<string | null>(null);
  // SECURITY: The derived key lives only in memory and is gone when the tab closes.
  const keyRef = useRef<CryptoKey | null>(null);
  const headerRef = useRef<VaultHeader | null>(null);

  const updateHeader = (next: VaultHeader | null) => {
    headerRef.current = next;
    setHeader(next);
  };

  useEffect(() => {
    indexedDB.deleteDatabase(LEGACY_DEV_MODE_DB);

    const legacy = !!readLegacyPersonalization();
    setHasLegacyPersonalization(legacy);
    getVaultHeader()
      .then((existing) => {
        updateHeader(existing);
        setStatus(existing || legacy ? "locked" : "none");
      })
      .catch((error) => {
        console.error("[Vault] Failed to read vault header:", error);
        setStatus(legacy ? "locked" : "none");
      });
  }, []);

  // Moves the old localStorage personalization blob into the vault if the passphrase opens it.
  const migrateLegacy = async (key: CryptoKey, passphrase: string): Promise<boolean> => {
    const legacy = readLegacyPersonalization();
    if (!legacy || !headerRef.current) return false;
    try {
      const decrypted = await decryptData(legacy, passphrase);
      const updated = await writeVaultSection(
        key,
        headerRef.current,
        "personalization",
        new TextEncoder().encode(decrypted)
      );
      updateHeader(updated);
      localStorage.removeItem(LEGACY_PERSONALIZATION_KEY);
      setHasLegacyPersonalization(false);
      return true;
    } catch {
      return false;
    }
  };

  const create = async (passphrase: string) => {
    const legacy = readLegacyPersonalization();
    if (legacy) {
      // Creating a new vault here would orphan the old personalization data.
      try {
        await decryptData(legacy, passphrase);
      } catch {
        throw new Error("Use your existing personalization password, or delete saved data first.");
      }
    } else if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      throw new Error(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);
    }

    const created = await createVault(passphrase);
    keyRef.current = created.key;
    updateHeader(created.header);
    await migrateLegacy(created.key, passphrase);
    setStatus("unlocked");
  };

  const unlock = async (passphrase: string): Promise<boolean> => {
    const existing = headerRef.current;

    if (!existing) {
      // Only legacy personalization exists. A matching password becomes the vault passphrase.
      const legacy = readLegacyPersonalization();
      if (!legacy) return false;
      try {
        await decryptData(legacy, passphrase);
      } catch {
        return false;
      }
      await create(passphrase);
      return true;
    }

    const key = await unlockVault(existing, passphrase);
    if (!key) return false;

    keyRef.current = key;
    await migrateLegacy(key, passphrase);
    setStatus("unlocked");
    return true;
  };

  const lock = () => {
    keyRef.current = null;
    setStatus(headerRef.current || readLegacyPersonalization() ? "locked" : "none");
  };

  const deleteAll = async () => {
    keyRef.current = null;
    await deleteVault();
    localStorage.removeItem(LEGACY_PERSONALIZATION_KEY);
    setHasLegacyPersonalization(false);
    updateHeader(null);
    setSavedFingerprint(null);
    setStatus("none");
  };

  const saveSection = async (section: VaultSection, data: Uint8Array) => {
    if (!keyRef.current || !headerRef.current) {
      throw new Error("Saved data is locked");
    }
    updateHeader(await writeVaultSection(keyRef.current, headerRef.current, section, data));
  };

  const loadSection = useCallback(async (section: VaultSection) => {
    if (!keyRef.current || !headerRef.current?.sections[section]) return null;
    return readVaultSection(keyRef.current, section);
  }, []);

  const removeSection = async (section: VaultSection) => {
    if (!headerRef.current?.sections[section]) return;
    updateHeader(await removeVaultSection(headerRef.current, section));
  };

  return (
    <VaultContext.Provider
      value={{
        status,
        header,
        hasLegacyPersonalization,
        create,
        unlock,
        lock,
        deleteAll,
        saveSection,
        loadSection,
        removeSection,
        savedFingerprint,
        setSavedFingerprint,
      }}
    >
      {children}
    </VaultContext.Provider>
  );
}

export function useVault() {
  const context = useContext(VaultContext);
  if (!context) {
    throw new Error("useVault must be used within VaultProvider");
  }
  return context;
}
