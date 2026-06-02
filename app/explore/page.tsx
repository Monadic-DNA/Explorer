"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import MenuBar from "../components/MenuBar";
import Footer from "../components/Footer";

export default function ExplorePage() {
  const router = useRouter();
  const [total, setTotal] = useState<number | null>(null);
  const [navigating, setNavigating] = useState(false);

  useEffect(() => {
    fetch("/api/studies?limit=1")
      .then(r => r.json())
      .then(data => {
        if (data.total) setTotal(data.total);
      })
      .catch(() => {});
  }, []);

  const handleRandom = () => {
    if (total === null) return;
    setNavigating(true);
    const id = Math.floor(Math.random() * total) + 1;
    router.push(`/study/${id}`);
  };

  return (
    <div className="app-container">
      <MenuBar />
      <main className="page">
        <div style={{ padding: "3rem 2rem", maxWidth: "600px" }}>
          <h1>Explore</h1>
          <p>Navigate to a random study from the GWAS Catalog.</p>
          {total !== null && (
            <p style={{ color: "#666", marginBottom: "1.5rem" }}>
              {total.toLocaleString()} studies available
            </p>
          )}
          <button
            className="primary-button"
            onClick={handleRandom}
            disabled={total === null || navigating}
          >
            {navigating ? "Loading..." : "Discover a random study"}
          </button>
        </div>
      </main>
      <Footer />
    </div>
  );
}
