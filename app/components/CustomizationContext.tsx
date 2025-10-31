"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { encryptData, decryptData, EncryptedData } from "@/lib/encryption-utils";
import { isDevModeEnabled, getPersonalizationPassword, savePersonalizationPassword } from "@/lib/dev-mode";

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
  saveCustomization: (data: UserCustomization, password: string) => Promise<void>;
  unlockCustomization: (password: string) => Promise<boolean>;
  lockCustomization: () => void;
  clearCustomization: () => void;
};

const CustomizationContext = createContext<CustomizationContextType | null>(null);

const STORAGE_KEY = 'user_customization_encrypted';

const defaultCustomization: UserCustomization = {
  ethnicities: [],
  countriesOfOrigin: [],
  genderAtBirth: '',
  age: null,
  personalConditions: [],
  familyConditions: [],
  smokingHistory: '',
  alcoholUse: '',
  medications: [],
  diet: '',
};

export function CustomizationProvider({ children }: { children: ReactNode }) {
  const [customization, setCustomization] = useState<UserCustomization | null>(null);
  const [status, setStatus] = useState<CustomizationStatus>('not-set');
  const [devModeAutoUnlockAttempted, setDevModeAutoUnlockAttempted] = useState(false);

  useEffect(() => {
    // Check if encrypted data exists in localStorage
    if (typeof window !== 'undefined') {
      const encrypted = localStorage.getItem(STORAGE_KEY);
      if (encrypted) {
        setStatus('locked');
      } else {
        setStatus('not-set');
      }
    }
  }, []);

  // Dev mode: Auto-unlock personalization on mount
  useEffect(() => {
    if (devModeAutoUnlockAttempted || status !== 'locked') return;

    const autoUnlock = async () => {
      if (!isDevModeEnabled()) {
        setDevModeAutoUnlockAttempted(true);
        return;
      }

      console.log('[Dev Mode] 🚀 Attempting to auto-unlock personalization...');

      try {
        const savedPassword = await getPersonalizationPassword();
        if (savedPassword) {
          const success = await unlockCustomization(savedPassword);
          if (success) {
            console.log('[Dev Mode] ✓ Personalization auto-unlocked successfully');
          } else {
            console.log('[Dev Mode] Failed to unlock - password may have changed');
          }
        } else {
          console.log('[Dev Mode] No saved password found. Unlock once to enable auto-unlock.');
        }
      } catch (error) {
        console.error('[Dev Mode] Failed to auto-unlock personalization:', error);
      } finally {
        setDevModeAutoUnlockAttempted(true);
      }
    };

    autoUnlock();
  }, [status, devModeAutoUnlockAttempted]);

  const saveCustomization = async (data: UserCustomization, password: string) => {
    if (!password || password.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }

    const encrypted = await encryptData(JSON.stringify(data), password);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(encrypted));

    setCustomization(data);
    setStatus('unlocked');

    // Dev mode: Save password for auto-unlock
    if (isDevModeEnabled()) {
      await savePersonalizationPassword(password);
    }
  };

  const unlockCustomization = async (password: string): Promise<boolean> => {
    const encryptedStr = localStorage.getItem(STORAGE_KEY);
    if (!encryptedStr) {
      return false;
    }

    try {
      const encrypted: EncryptedData = JSON.parse(encryptedStr);
      const decrypted = await decryptData(encrypted, password);
      const data: UserCustomization = JSON.parse(decrypted);

      setCustomization(data);
      setStatus('unlocked');

      // Dev mode: Save password for auto-unlock
      if (isDevModeEnabled()) {
        await savePersonalizationPassword(password);
      }

      return true;
    } catch (error) {
      return false;
    }
  };

  const lockCustomization = () => {
    setCustomization(null);
    setStatus('locked');
  };

  const clearCustomization = () => {
    localStorage.removeItem(STORAGE_KEY);
    setCustomization(null);
    setStatus('not-set');
  };

  return (
    <CustomizationContext.Provider
      value={{
        customization,
        status,
        saveCustomization,
        unlockCustomization,
        lockCustomization,
        clearCustomization,
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
