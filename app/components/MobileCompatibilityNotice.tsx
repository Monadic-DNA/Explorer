"use client";

import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "mobile_compatibility_notice_dismissed";
const MOBILE_QUERY = "(max-width: 768px)";

export default function MobileCompatibilityNotice() {
  const [shouldShow, setShouldShow] = useState(false);
  const noticeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dismissed = localStorage.getItem(STORAGE_KEY) === "true";
    const mediaQuery = window.matchMedia(MOBILE_QUERY);

    const updateVisibility = () => {
      setShouldShow(mediaQuery.matches && !dismissed);
    };

    updateVisibility();

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", updateVisibility);
      return () => mediaQuery.removeEventListener("change", updateVisibility);
    }

    mediaQuery.addListener(updateVisibility);
    return () => mediaQuery.removeListener(updateVisibility);
  }, []);

  useEffect(() => {
    const root = document.documentElement;

    if (!shouldShow) {
      root.classList.remove("mobile-compatibility-notice-visible");
      root.style.removeProperty("--mobile-compatibility-notice-height");
      return;
    }

    const updateHeight = () => {
      const height = noticeRef.current?.offsetHeight || 0;
      root.style.setProperty("--mobile-compatibility-notice-height", `${height}px`);
    };

    root.classList.add("mobile-compatibility-notice-visible");
    updateHeight();

    const resizeObserver = new ResizeObserver(updateHeight);
    if (noticeRef.current) {
      resizeObserver.observe(noticeRef.current);
    }
    window.addEventListener("resize", updateHeight);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateHeight);
      root.classList.remove("mobile-compatibility-notice-visible");
      root.style.removeProperty("--mobile-compatibility-notice-height");
    };
  }, [shouldShow]);

  if (!shouldShow) return null;

  return (
    <div className="mobile-compatibility-notice" role="status" ref={noticeRef}>
      <p>
        <strong>Mobile note:</strong> This app does intensive private processing in your browser. Some older phones may reload or stall during onboarding. If that happens, try it on desktop.
      </p>
      <button
        type="button"
        aria-label="Dismiss mobile compatibility notice"
        onClick={() => {
          localStorage.setItem(STORAGE_KEY, "true");
          setShouldShow(false);
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
