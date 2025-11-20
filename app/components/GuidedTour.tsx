"use client";

import { useState, useEffect, useRef } from "react";

type TourStep = {
  id: string;
  title: string;
  description: string;
  target?: string; // CSS selector for element to highlight
  position?: "top" | "bottom" | "left" | "right";
  action?: string; // Optional action text
};

const tourSteps: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to Monadic DNA Explorer!",
    description: "Explore over 1 million genetic association studies from the GWAS Catalog. Whether you're a researcher or just curious about genetics, let's take a quick tour!",
    position: "bottom"
  },
  {
    id: "filters",
    title: "Search & Filter Studies",
    description: "Use powerful filters to explore genetic studies. Try semantic search to find studies by meaning, not just keywords! Filter by sample size, p-value, and more.",
    target: ".panel",
    position: "bottom"
  },
  {
    id: "results-table",
    title: "Browse Study Results",
    description: "This table shows genetic studies matching your filters. Each row contains key information like statistical significance (Relevance), study size (Power), and effect size.",
    target: ".summary",
    position: "bottom"
  },
  {
    id: "upload-data",
    title: "Upload Your DNA Data (Optional)",
    description: "Want personalized insights? Upload your 23andMe or AncestryDNA raw data file. Your data never leaves your browser - everything runs locally!",
    target: ".menu-icon-button:first-child",
    position: "bottom"
  },
  {
    id: "your-result",
    title: "See Your Genetic Results",
    description: "After uploading DNA data, click 'Reveal' in any study row to see how each genetic variant applies to you personally.",
    target: "thead tr th:last-child",
    position: "top"
  },
  {
    id: "llm-features",
    title: "LLM-Powered Analysis",
    description: "Use our LLM features to ask questions about your genetics, get personalized insights, and generate comprehensive reports. Configure your preferred LLM provider in the menu!",
    target: ".menu-icons",
    position: "bottom"
  },
  {
    id: "premium-tab",
    title: "Premium Features",
    description: "Upgrade to Premium for powerful features: Run All Analysis (analyze all million+ traits at once), LLM Chat (ask an LLM about your genetics), and Overview Report (comprehensive LLM analysis).",
    target: ".tab-button:last-child",
    position: "bottom"
  },
  {
    id: "menubar",
    title: "Explore the Menu",
    description: "Access your data, results export/import, personalization settings, LLM configuration, and cache management. You can also switch between light and dark themes!",
    target: ".menu-bar",
    position: "bottom"
  },
  {
    id: "complete",
    title: "You're All Set!",
    description: "Start exploring genetic studies right away, or upload your DNA data for personalized insights. Click the Help icon (❓) in the menu anytime to restart this tour!",
    position: "bottom"
  }
];

interface GuidedTourProps {
  isOpen: boolean;
  onClose: () => void;
  onNeverShowAgain: () => void;
}

export default function GuidedTour({ isOpen, onClose, onNeverShowAgain }: GuidedTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const step = tourSteps[currentStep];
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === tourSteps.length - 1;

  // Update target element position
  useEffect(() => {
    if (!isOpen || !step.target) {
      setTargetRect(null);
      return;
    }

    const updatePosition = () => {
      const target = document.querySelector(step.target!) as HTMLElement;
      if (target) {
        const rect = target.getBoundingClientRect();
        setTargetRect(rect);
      }
    };

    // Initial position
    updatePosition();

    // Update position on scroll and resize
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, step.target, currentStep]);

  // Reset to first step and show tour with animation delay
  useEffect(() => {
    if (isOpen) {
      setCurrentStep(0); // Always start from beginning
      setTimeout(() => setIsVisible(true), 100);
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  // Scroll target element into view
  useEffect(() => {
    if (isOpen && step.target) {
      const target = document.querySelector(step.target) as HTMLElement;
      if (target) {
        // Use 'start' positioning to keep tooltip visible, with offset for menu bar
        setTimeout(() => {
          const yOffset = -100; // Offset to account for sticky menu bar
          const y = target.getBoundingClientRect().top + window.pageYOffset + yOffset;
          window.scrollTo({ top: y, behavior: 'smooth' });
        }, 50);
      }
    }
  }, [isOpen, step.target, currentStep]);

  if (!isOpen) return null;

  const handleNext = () => {
    if (isLastStep) {
      onClose();
    } else {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handleBack = () => {
    setCurrentStep(prev => Math.max(0, prev - 1));
  };

  const handleSkip = () => {
    onClose();
  };

  const handleNeverShow = () => {
    onNeverShowAgain();
    onClose();
  };

  // Calculate tooltip position
  const getTooltipStyle = (): React.CSSProperties => {
    if (!targetRect) {
      // Center on screen for steps without targets
      return {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 10002
      };
    }

    const position = step.position || 'bottom';
    const offset = 20; // Distance from target element
    const style: React.CSSProperties = {
      position: 'fixed',
      zIndex: 10002
    };

    switch (position) {
      case 'top':
        style.bottom = `${window.innerHeight - targetRect.top + offset}px`;
        style.left = `${targetRect.left + targetRect.width / 2}px`;
        style.transform = 'translateX(-50%)';
        break;
      case 'bottom':
        style.top = `${targetRect.bottom + offset}px`;
        style.left = `${targetRect.left + targetRect.width / 2}px`;
        style.transform = 'translateX(-50%)';
        break;
      case 'left':
        style.top = `${targetRect.top + targetRect.height / 2}px`;
        style.right = `${window.innerWidth - targetRect.left + offset}px`;
        style.transform = 'translateY(-50%)';
        break;
      case 'right':
        style.top = `${targetRect.top + targetRect.height / 2}px`;
        style.left = `${targetRect.right + offset}px`;
        style.transform = 'translateY(-50%)';
        break;
    }

    return style;
  };

  return (
    <>
      {/* Overlay */}
      <div
        className={`tour-overlay ${isVisible ? 'visible' : ''}`}
        onClick={handleSkip}
      />

      {/* Spotlight on target element */}
      {targetRect && (
        <div
          className={`tour-spotlight ${isVisible ? 'visible' : ''}`}
          style={{
            position: 'fixed',
            top: `${targetRect.top - 8}px`,
            left: `${targetRect.left - 8}px`,
            width: `${targetRect.width + 16}px`,
            height: `${targetRect.height + 16}px`,
            pointerEvents: 'none',
            zIndex: 10001
          }}
        />
      )}

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className={`tour-tooltip ${isVisible ? 'visible' : ''}`}
        style={getTooltipStyle()}
      >
        <div className="tour-tooltip-header">
          <h3>{step.title}</h3>
          <button
            onClick={handleSkip}
            className="tour-close-button"
            aria-label="Close tour"
          >
            ×
          </button>
        </div>

        <p className="tour-tooltip-description">{step.description}</p>

        <div className="tour-tooltip-footer">
          <div className="tour-progress">
            {tourSteps.map((_, index) => (
              <div
                key={index}
                className={`tour-progress-dot ${index === currentStep ? 'active' : ''} ${index < currentStep ? 'completed' : ''}`}
              />
            ))}
          </div>

          <div className="tour-tooltip-actions">
            {isFirstStep && (
              <button onClick={handleNeverShow} className="tour-button secondary">
                Never show again
              </button>
            )}
            {!isFirstStep && (
              <button onClick={handleBack} className="tour-button secondary">
                Back
              </button>
            )}
            <button onClick={handleSkip} className="tour-button secondary">
              Skip tour
            </button>
            <button onClick={handleNext} className="tour-button primary">
              {isLastStep ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
