"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useCustomization, UserCustomization } from "./CustomizationContext";

type CustomizationModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export default function CustomizationModal({ isOpen, onClose }: CustomizationModalProps) {
  const { customization, status, saveCustomization, unlockCustomization, lockCustomization, clearCustomization } = useCustomization();

  const [isUnlockMode, setIsUnlockMode] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Form fields
  const [ethnicities, setEthnicities] = useState('');
  const [countriesOfOrigin, setCountriesOfOrigin] = useState('');
  const [genderAtBirth, setGenderAtBirth] = useState('');
  const [customGender, setCustomGender] = useState('');
  const [age, setAge] = useState('');
  const [personalConditions, setPersonalConditions] = useState('');
  const [familyConditions, setFamilyConditions] = useState('');

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setPassword('');
      setConfirmPassword('');

      if (status === 'locked') {
        setIsUnlockMode(true);
      } else if (status === 'unlocked' && customization) {
        setIsUnlockMode(false);
        // Populate form with existing data
        setEthnicities(customization.ethnicities.join(', '));
        setCountriesOfOrigin(customization.countriesOfOrigin.join(', '));

        // Handle gender - check if it's a preset or custom value
        if (customization.genderAtBirth === 'male' || customization.genderAtBirth === 'female') {
          setGenderAtBirth(customization.genderAtBirth);
          setCustomGender('');
        } else {
          setGenderAtBirth('other');
          setCustomGender(customization.genderAtBirth);
        }

        setAge(customization.age?.toString() || '');
        // Handle backward compatibility with old data structure
        setPersonalConditions((customization.personalConditions || []).join(', '));
        setFamilyConditions((customization.familyConditions || []).join(', '));
      } else {
        setIsUnlockMode(false);
        // Reset form for new customization
        setEthnicities('');
        setCountriesOfOrigin('');
        setGenderAtBirth('');
        setCustomGender('');
        setAge('');
        setPersonalConditions('');
        setFamilyConditions('');
      }
    }
  }, [isOpen, status, customization]);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSaving(true);

    const success = await unlockCustomization(password);

    setIsSaving(false);

    if (success) {
      setIsUnlockMode(false);
      setPassword('');
    } else {
      setError('Incorrect password');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate password for new customization
    if (status === 'not-set' || status === 'unlocked') {
      if (!password) {
        setError('Password is required');
        return;
      }
      if (password.length < 6) {
        setError('Password must be at least 6 characters');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }
    }

    setIsSaving(true);

    try {
      const finalGender = genderAtBirth === 'other' ? customGender : genderAtBirth;

      const data: UserCustomization = {
        ethnicities: ethnicities.split(',').map(s => s.trim()).filter(Boolean),
        countriesOfOrigin: countriesOfOrigin.split(',').map(s => s.trim()).filter(Boolean),
        genderAtBirth: finalGender,
        age: age ? parseInt(age) : null,
        personalConditions: personalConditions.split(',').map(s => s.trim()).filter(Boolean),
        familyConditions: familyConditions.split(',').map(s => s.trim()).filter(Boolean),
      };

      await saveCustomization(data, password);
      setPassword('');
      setConfirmPassword('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save customization');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLock = () => {
    lockCustomization();
    onClose();
  };

  const handleClear = () => {
    if (confirm('Are you sure you want to delete all customization data? This cannot be undone.')) {
      clearCustomization();
      onClose();
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-dialog customization-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-content">
          <h2>⚙️ Customize AI Analysis</h2>

          <div className="customization-info">
            <p>
              Provide personal information to help the AI give more relevant interpretations.
              Your data is encrypted with your password and stored only in your browser.
            </p>
          </div>

          {isUnlockMode ? (
            <form onSubmit={handleUnlock}>
              <div className="form-group">
                <label htmlFor="unlock-password">Enter Password to Unlock</label>
                <input
                  type="password"
                  id="unlock-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoFocus
                />
              </div>

              {error && <div className="error-message">❌ {error}</div>}

              <div className="modal-actions">
                <button type="button" className="disclaimer-button secondary" onClick={onClose}>
                  Cancel
                </button>
                <button type="submit" className="disclaimer-button primary" disabled={isSaving}>
                  {isSaving ? 'Unlocking...' : 'Unlock'}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleSave}>
              <div className="form-group">
                <label htmlFor="ethnicities">
                  Ethnicities
                  <span className="field-hint">Comma-separated, e.g., "European, East Asian"</span>
                </label>
                <input
                  type="text"
                  id="ethnicities"
                  value={ethnicities}
                  onChange={(e) => setEthnicities(e.target.value)}
                  placeholder="e.g., European, East Asian"
                />
              </div>

              <div className="form-group">
                <label htmlFor="countries">
                  Countries of Ancestral Origin
                  <span className="field-hint">Comma-separated, e.g., "India, China"</span>
                </label>
                <input
                  type="text"
                  id="countries"
                  value={countriesOfOrigin}
                  onChange={(e) => setCountriesOfOrigin(e.target.value)}
                  placeholder="e.g., India, China"
                />
              </div>

              <div className="form-group">
                <label htmlFor="gender">Gender Assigned at Birth</label>
                <select
                  id="gender"
                  value={genderAtBirth}
                  onChange={(e) => setGenderAtBirth(e.target.value)}
                >
                  <option value="">Select...</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other (specify below)</option>
                </select>
              </div>

              {genderAtBirth === 'other' && (
                <div className="form-group">
                  <label htmlFor="custom-gender">Specify Gender</label>
                  <input
                    type="text"
                    id="custom-gender"
                    value={customGender}
                    onChange={(e) => setCustomGender(e.target.value)}
                    placeholder="Enter your gender"
                  />
                </div>
              )}

              <div className="form-group">
                <label htmlFor="age">Age</label>
                <input
                  type="number"
                  id="age"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  placeholder="e.g., 30"
                  min="0"
                  max="120"
                />
              </div>

              <div className="form-group">
                <label htmlFor="personal-conditions">
                  Personal Medical History
                  <span className="field-hint">Conditions you have, comma-separated</span>
                </label>
                <textarea
                  id="personal-conditions"
                  value={personalConditions}
                  onChange={(e) => setPersonalConditions(e.target.value)}
                  placeholder="e.g., diabetes, hypertension"
                  rows={2}
                />
              </div>

              <div className="form-group">
                <label htmlFor="family-conditions">
                  Family Medical History
                  <span className="field-hint">Conditions in your family, comma-separated</span>
                </label>
                <textarea
                  id="family-conditions"
                  value={familyConditions}
                  onChange={(e) => setFamilyConditions(e.target.value)}
                  placeholder="e.g., heart disease, cancer, Alzheimer's"
                  rows={2}
                />
              </div>

              <div className="form-group password-section">
                <label htmlFor="password">
                  {status === 'unlocked' ? 'Current Password' : 'Create Password'}
                  <span className="field-hint">Minimum 6 characters - you'll need this to access your data</span>
                </label>
                <input
                  type="password"
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  required
                />
              </div>

              {(status === 'not-set' || password) && (
                <div className="form-group">
                  <label htmlFor="confirm-password">Confirm Password</label>
                  <input
                    type="password"
                    id="confirm-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    required
                  />
                </div>
              )}

              {error && <div className="error-message">❌ {error}</div>}

              <div className="modal-actions">
                {status === 'unlocked' && (
                  <>
                    <button type="button" className="disclaimer-button danger" onClick={handleClear}>
                      Delete All
                    </button>
                    <button type="button" className="disclaimer-button secondary" onClick={handleLock}>
                      Lock & Close
                    </button>
                  </>
                )}
                {status !== 'unlocked' && (
                  <button type="button" className="disclaimer-button secondary" onClick={onClose}>
                    Cancel
                  </button>
                )}
                <button type="submit" className="disclaimer-button primary" disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Save & Encrypt'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(modalContent, document.body)
    : null;
}
