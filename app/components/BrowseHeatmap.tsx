"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useResults } from "./ResultsContext";

type HeatmapStudy = {
  id: number;
  mapped_trait: string | null;
  disease_trait: string | null;
  study: string | null;
};

type Props = {
  studies: HeatmapStudy[];
  totalCount: number;
};

export default function BrowseHeatmap({ studies, totalCount }: Props) {
  const { getResult, hasResult } = useResults();

  const groups = useMemo(() => {
    const map = new Map<string, HeatmapStudy[]>();
    for (const s of studies) {
      const trait = s.mapped_trait?.trim() || s.disease_trait?.trim() || "Unknown";
      const existing = map.get(trait) || [];
      existing.push(s);
      map.set(trait, existing);
    }
    return Array.from(map.entries())
      .map(([trait, items]) => ({ trait, items }))
      .sort((a, b) => b.items.length - a.items.length);
  }, [studies]);

  return (
    <div className="browse-heatmap">
      <div className="browse-heatmap-legend">
        <span className="heatmap-legend-item">
          <span className="heatmap-chip heatmap-chip--increased" />
          Elevated risk
        </span>
        <span className="heatmap-legend-item">
          <span className="heatmap-chip heatmap-chip--decreased" />
          Reduced risk
        </span>
        <span className="heatmap-legend-item">
          <span className="heatmap-chip heatmap-chip--neutral" />
          Neutral
        </span>
        <span className="heatmap-legend-item">
          <span className="heatmap-chip heatmap-chip--none" />
          Not analyzed
        </span>
      </div>
      <div className="browse-heatmap-rows">
        {groups.map(({ trait, items }) => (
          <div key={trait} className="browse-heatmap-row">
            <span className="browse-heatmap-trait" title={trait}>{trait}</span>
            <div className="browse-heatmap-chips">
              {items.map(s => {
                const result = hasResult(s.id) ? getResult(s.id) : null;
                const level = result?.riskLevel ?? 'none';
                return (
                  <Link
                    key={s.id}
                    href={`/study/${s.id}`}
                    className={`heatmap-chip heatmap-chip--${level}`}
                    title={s.study || trait}
                  />
                );
              })}
              <span className="browse-heatmap-count">{items.length}</span>
            </div>
          </div>
        ))}
      </div>
      {studies.length < totalCount && (
        <p className="browse-heatmap-note">
          Showing {studies.length.toLocaleString()} of {totalCount.toLocaleString()} studies. Switch to Table view and use Load More to expand.
        </p>
      )}
    </div>
  );
}
