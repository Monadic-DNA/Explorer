"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  trackTourCompleted,
  trackTourDismissed,
  trackTourStarted,
  trackTourStepViewed,
} from "@/lib/analytics";
import type { TourContent, TourStep } from "./tours/tourContent";

type GuidedTourProps = {
  tour: TourContent;
  isOpen: boolean;
  onClose: () => void;
};

type Rect = { top: number; left: number; width: number; height: number };

const SPOTLIGHT_PADDING = 8;
const POPOVER_GAP = 14;
const POPOVER_WIDTH = 340;
const POPOVER_MARGIN = 12;

const storageKey = (tourId: string) => `tour_completed_${tourId}`;

export function hasCompletedTour(tourId: string): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(storageKey(tourId)) === "true";
}

function getTargetRect(selector: string | undefined): Rect | null {
  if (!selector || typeof window === "undefined") return null;
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function scrollTargetIntoView(selector: string | undefined) {
  if (!selector || typeof window === "undefined") return;
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
}

type PopoverPosition = {
  top: number;
  left: number;
  placement: "top" | "bottom" | "left" | "right" | "center";
};

function computePopoverPosition(
  target: Rect | null,
  preferred: TourStep["placement"],
  vw: number,
  vh: number,
  popoverHeight: number,
): PopoverPosition {
  if (!target) {
    return {
      top: Math.max(POPOVER_MARGIN, vh / 2 - popoverHeight / 2),
      left: Math.max(POPOVER_MARGIN, vw / 2 - POPOVER_WIDTH / 2),
      placement: "center",
    };
  }

  const order: Array<NonNullable<TourStep["placement"]>> =
    preferred === "top"
      ? ["top", "bottom", "right", "left"]
      : preferred === "left"
        ? ["left", "right", "bottom", "top"]
        : preferred === "right"
          ? ["right", "left", "bottom", "top"]
          : ["bottom", "top", "right", "left"];

  for (const placement of order) {
    if (placement === "bottom") {
      const top = target.top + target.height + POPOVER_GAP;
      if (top + popoverHeight + POPOVER_MARGIN <= vh) {
        const left = clamp(target.left + target.width / 2 - POPOVER_WIDTH / 2, POPOVER_MARGIN, vw - POPOVER_WIDTH - POPOVER_MARGIN);
        return { top, left, placement };
      }
    } else if (placement === "top") {
      const top = target.top - POPOVER_GAP - popoverHeight;
      if (top >= POPOVER_MARGIN) {
        const left = clamp(target.left + target.width / 2 - POPOVER_WIDTH / 2, POPOVER_MARGIN, vw - POPOVER_WIDTH - POPOVER_MARGIN);
        return { top, left, placement };
      }
    } else if (placement === "right") {
      const left = target.left + target.width + POPOVER_GAP;
      if (left + POPOVER_WIDTH + POPOVER_MARGIN <= vw) {
        const top = clamp(target.top + target.height / 2 - popoverHeight / 2, POPOVER_MARGIN, vh - popoverHeight - POPOVER_MARGIN);
        return { top, left, placement };
      }
    } else if (placement === "left") {
      const left = target.left - POPOVER_GAP - POPOVER_WIDTH;
      if (left >= POPOVER_MARGIN) {
        const top = clamp(target.top + target.height / 2 - popoverHeight / 2, POPOVER_MARGIN, vh - popoverHeight - POPOVER_MARGIN);
        return { top, left, placement };
      }
    }
  }

  return {
    top: Math.max(POPOVER_MARGIN, vh / 2 - popoverHeight / 2),
    left: Math.max(POPOVER_MARGIN, vw / 2 - POPOVER_WIDTH / 2),
    placement: "center",
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export default function GuidedTour({ tour, isOpen, onClose }: GuidedTourProps) {
  const [mounted, setMounted] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [viewport, setViewport] = useState({ vw: 0, vh: 0 });
  const [popoverHeight, setPopoverHeight] = useState(220);

  const step = tour.steps[stepIndex];

  useEffect(() => {
    setMounted(true);
    setViewport({ vw: window.innerWidth, vh: window.innerHeight });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setStepIndex(0);
    setDontShowAgain(false);
    trackTourStarted(tour.id);
  }, [isOpen, tour.id]);

  useEffect(() => {
    if (!isOpen || !step) return;
    trackTourStepViewed(tour.id, stepIndex, step.name);
  }, [isOpen, stepIndex, step, tour.id]);

  // Scroll target into view when step changes
  useEffect(() => {
    if (!isOpen || !step?.selector) return;
    scrollTargetIntoView(step.selector);
  }, [isOpen, step]);

  // Track target rect with retries (target may not exist immediately after scroll)
  useLayoutEffect(() => {
    if (!isOpen) return;
    if (!step?.selector) {
      setTargetRect(null);
      return;
    }

    let raf = 0;
    let attempts = 0;
    const tick = () => {
      const rect = getTargetRect(step.selector);
      if (rect) {
        setTargetRect(rect);
      } else if (attempts < 30) {
        attempts++;
        raf = requestAnimationFrame(tick);
      } else {
        setTargetRect(null);
      }
    };
    tick();

    return () => cancelAnimationFrame(raf);
  }, [isOpen, step]);

  // Reposition on resize / scroll
  useEffect(() => {
    if (!isOpen) return;
    const update = () => {
      setViewport({ vw: window.innerWidth, vh: window.innerHeight });
      if (step?.selector) {
        const rect = getTargetRect(step.selector);
        setTargetRect(rect);
      }
    };
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [isOpen, step]);

  const persistDontShowAgain = useCallback(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(storageKey(tour.id), "true");
    }
  }, [tour.id]);

  const handleDismiss = useCallback(() => {
    trackTourDismissed(tour.id, stepIndex, dontShowAgain);
    if (dontShowAgain) {
      persistDontShowAgain();
    }
    onClose();
  }, [dontShowAgain, onClose, persistDontShowAgain, stepIndex, tour.id]);

  const handleFinish = useCallback(() => {
    persistDontShowAgain();
    trackTourCompleted(tour.id);
    onClose();
  }, [onClose, persistDontShowAgain, tour.id]);

  const handleNext = useCallback(() => {
    if (stepIndex < tour.steps.length - 1) {
      setStepIndex((i) => i + 1);
    } else {
      handleFinish();
    }
  }, [handleFinish, stepIndex, tour.steps.length]);

  const handleBack = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  // Escape key dismisses
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleDismiss();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, handleDismiss]);

  if (!mounted || !isOpen || !step) return null;

  const popoverPos = computePopoverPosition(targetRect, step.placement, viewport.vw, viewport.vh, popoverHeight);
  const isLastStep = stepIndex === tour.steps.length - 1;
  const isFirstStep = stepIndex === 0;
  const hasSpotlight = !!targetRect;

  const spotlightStyle = hasSpotlight
    ? {
        left: targetRect!.left - SPOTLIGHT_PADDING,
        top: targetRect!.top - SPOTLIGHT_PADDING,
        width: targetRect!.width + SPOTLIGHT_PADDING * 2,
        height: targetRect!.height + SPOTLIGHT_PADDING * 2,
      }
    : null;

  const content = (
    <>
      {/* Backdrop click-blocker */}
      <div className="guided-tour-backdrop" onClick={handleDismiss} />

      {/* Spotlight cutout via box-shadow trick */}
      {hasSpotlight && spotlightStyle && (
        <div className="guided-tour-spotlight" style={spotlightStyle} />
      )}

      {/* Popover */}
      <div
        className={`guided-tour-popover guided-tour-popover-${popoverPos.placement}`}
        style={{ top: popoverPos.top, left: popoverPos.left, width: POPOVER_WIDTH }}
        ref={(el) => {
          if (el && el.offsetHeight !== popoverHeight) {
            setPopoverHeight(el.offsetHeight);
          }
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="guided-tour-close"
          onClick={handleDismiss}
          aria-label="Close tour"
        >
          ✕
        </button>

        <div className="guided-tour-eyebrow">
          {tour.title} · Step {stepIndex + 1} of {tour.steps.length}
        </div>
        <h2 className="guided-tour-step-title">{step.title}</h2>
        <p className="guided-tour-step-body">{step.body}</p>

        <div className="guided-tour-progress" aria-hidden="true">
          {tour.steps.map((_, i) => (
            <span
              key={i}
              className={`guided-tour-dot ${i === stepIndex ? "active" : ""} ${i < stepIndex ? "done" : ""}`}
            />
          ))}
        </div>

        <div className="guided-tour-footer">
          <label className="guided-tour-checkbox">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
            />
            <span>Don&apos;t show again</span>
          </label>

          <div className="guided-tour-actions">
            {!isFirstStep && (
              <button className="guided-tour-secondary" onClick={handleBack}>
                Back
              </button>
            )}
            <button className="guided-tour-primary" onClick={handleNext}>
              {isLastStep ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(content, document.body);
}
