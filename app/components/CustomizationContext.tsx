"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { encryptData, decryptData, EncryptedData } from "@/lib/encryption-utils";

export interface UserCustomization {
  ethnicities: string[];
  countriesOfOrigin: string[];
  genderAtBirth: string;
  age: number | null;
  personalConditions: string[];
  familyConditions: string[];
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
  conditionsOfInterest: [],
};

export function CustomizationProvider({ children }: { children: ReactNode }) {
  const [customization, setCustomization] = useState<UserCustomization | null>(null);
  const [status, setStatus] = useState<CustomizationStatus>('not-set');

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

  const saveCustomization = async (data: UserCustomization, password: string) => {
    if (!password || password.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }

    const encrypted = await encryptData(JSON.stringify(data), password);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(encrypted));

    setCustomization(data);
    setStatus('unlocked');
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
