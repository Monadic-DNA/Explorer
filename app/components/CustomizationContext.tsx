"use client";

import { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";
import { useVault, LEGACY_PERSONALIZATION_KEY } from "./VaultContext";

export interface UserCustomization {
  ethnicities: string[];
  countriesOfOrigin: string[];
  genderAtBirth: string;
  age: number | null;
  personalConditions: string[];
  familyConditions: string[];
  smokingHistory?: 'still-smoking' | 'past-smoker' | 'never-smoked' | '';
  alcoholUse?: 'none' | 'rare' | 'mild' | 'moderate' | 'heavy' | '';
  medications?: string[];
  diet?: 'regular' | 'vegetarian' | 'vegan' | 'pescatarian' | 'keto' | 'paleo' | 'carnivore' | 'mediterranean' | 'low-carb' | 'gluten-free' | '';
}

type CustomizationStatus = 'not-set' | 'locked' | 'unlocked';

type CustomizationContextType = {
  customization: UserCustomization | null;
  status: CustomizationStatus;
  // True when saving needs a passphrase because the vault is locked or does not exist yet
  needsPassword: boolean;
  vaultExists: boolean;
  saveCustomization: (data: UserCustomization, password?: string) => Promise<void>;
  unlockCustomization: (password: string) => Promise<boolean>;
  lockCustomization: () => void;
  clearCustomization: () => Promise<void>;
  // Memory-only personalization, used for sample data so no vault is created
  setSessionCustomization: (data: UserCustomization) => void;
};

const CustomizationContext = createContext<CustomizationContextType | null>(null);

export function CustomizationProvider({ children }: { children: ReactNode }) {
  const vault = useVault();
  const [customization, setCustomization] = useState<UserCustomization | null>(null);
  // Whether the current customization came from (or was written to) the vault
  const persistedRef = useRef(false);

  const hasSavedPersonalization = !!vault.header?.sections.personalization || vault.hasLegacyPersonalization;

  // Load personalization from the vault once it is unlocked
  useEffect(() => {
    if (vault.status !== 'unlocked') {
      if (persistedRef.current) {
        persistedRef.current = false;
        setCustomization(null);
      }
      return;
    }
    if (persistedRef.current || !vault.header?.sections.personalization) return;

    vault.loadSection('personalization')
      .then((bytes) => {
        if (!bytes) return;
        persistedRef.current = true;
        setCustomization(JSON.parse(new TextDecoder().decode(bytes)));
      })
      .catch((error) => console.error('[Personalization] Failed to load from vault:', error));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault.status, vault.header?.sections.personalization]);

  let status: CustomizationStatus = 'not-set';
  if (customization) {
    status = 'unlocked';
  } else if (vault.status === 'locked' && hasSavedPersonalization) {
    status = 'locked';
  }

  const saveCustomization = async (data: UserCustomization, password?: string) => {
    if (vault.status !== 'unlocked') {
      if (!password) {
        throw new Error('Password is required');
      }
      if (vault.status === 'locked') {
        if (!(await vault.unlock(password))) {
          throw new Error('Incorrect password');
        }
      } else {
        await vault.create(password);
      }
    }

    await vault.saveSection('personalization', new TextEncoder().encode(JSON.stringify(data)));
    persistedRef.current = true;
    setCustomization(data);
  };

  const unlockCustomization = (password: string) => vault.unlock(password);

  // Locking forgets the vault key, which also locks saved DNA data until the next unlock
  const lockCustomization = () => {
    persistedRef.current = false;
    setCustomization(null);
    vault.lock();
  };

  const clearCustomization = async () => {
    localStorage.removeItem(LEGACY_PERSONALIZATION_KEY);
    await vault.removeSection('personalization');
    persistedRef.current = false;
    setCustomization(null);
  };

  const setSessionCustomization = (data: UserCustomization) => {
    persistedRef.current = false;
    setCustomization(data);
  };

  return (
    <CustomizationContext.Provider
      value={{
        customization,
        status,
        needsPassword: vault.status !== 'unlocked',
        vaultExists: !!vault.header || vault.hasLegacyPersonalization,
        saveCustomization,
        unlockCustomization,
        lockCustomization,
        clearCustomization,
        setSessionCustomization,
      }}
    >
      {children}
    </CustomizationContext.Provider>
  );
}

export function useCustomization() {
  const context = useContext(CustomizationContext);
  if (!context) {
    throw new Error('useCustomization must be used within CustomizationProvider');
  }
  return context;
}
