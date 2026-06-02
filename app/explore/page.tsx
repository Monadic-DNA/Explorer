"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import MenuBar from "../components/MenuBar";
import Footer from "../components/Footer";
import { useResults } from "../components/ResultsContext";

export default function ExplorePage() {
  const router = useRouter();
  const { savedResults } = useResults();
  const [navigating, setNavigating] = useState(false);

  const hasResults = savedResults.length > 0;

  const handleRandom = () => {
    if (!hasResults) return;
    setNavigating(true);
    const result = savedResults[Math.floor(Math.random() * savedResults.length)];
    router.push(`/study/${result.studyId}`);
  };

  return (
    <div className="app-container">
      <MenuBar />
      <main className="page">
        <div style={{ padding: "3rem 2rem", maxWidth: "600px" }}>
          <h1>Explore</h1>
          {hasResults ? (
            <>
              <p>Navigate to a random study from your saved results.</p>
              <p style={{ color: "#666", marginBottom: "1.5rem" }}>
                {savedResults.length.toLocaleString()} saved {savedResults.length === 1 ? "result" : "results"}
              </p>
              <button
                className="primary-button"
                onClick={handleRandom}
                disabled={navigating}
              >
                {navigating ? "Loading..." : "Discover a random study"}
              </button>
            </>
          ) : (
            <p style={{ color: "#666" }}>
              Load a results file, or upload your DNA data and hit Run All, to start exploring your personalized studies.
            </p>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
