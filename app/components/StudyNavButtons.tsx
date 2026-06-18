"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useResults } from "./ResultsContext";

export default function StudyNavButtons() {
  const router = useRouter();
  const { savedResults } = useResults();
  const [totalStudies, setTotalStudies] = useState<number | null>(null);
  const [navigating, setNavigating] = useState(false);

  useEffect(() => {
    if (savedResults.length > 0) return;
    fetch("/api/studies?limit=1")
      .then(r => r.json())
      .then(data => { if (data.total) setTotalStudies(data.total); })
      .catch(() => {});
  }, [savedResults.length]);

  const handleNextRandom = () => {
    setNavigating(true);
    if (savedResults.length > 0) {
      const result = savedResults[Math.floor(Math.random() * savedResults.length)];
      router.push(`/study/${result.studyId}`);
    } else if (totalStudies !== null) {
      router.push(`/study/${Math.floor(Math.random() * totalStudies) + 1}`);
    }
  };

  const disabled = navigating || (savedResults.length === 0 && totalStudies === null);

  return (
    <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
      <Link href="/browse" style={{
        display: "inline-block",
        padding: "0.5rem 1rem",
        backgroundColor: "#667eea",
        color: "white",
        textDecoration: "none",
        borderRadius: "6px",
        fontSize: "0.85rem",
        fontWeight: 600,
      }}>
        ← Back to Browse
      </Link>
      <button
        onClick={handleNextRandom}
        disabled={disabled}
        style={{
          fontSize: "0.85rem",
          padding: "0.5rem 1rem",
          background: "linear-gradient(135deg, #667eea, #764ba2)",
          border: "none",
          color: "white",
          borderRadius: "6px",
          cursor: "pointer",
          whiteSpace: "nowrap",
          fontWeight: 600,
          boxShadow: "0 2px 6px rgba(102,126,234,0.4)",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {navigating ? "Loading..." : "Next Random Study →"}
      </button>
    </div>
  );
}
