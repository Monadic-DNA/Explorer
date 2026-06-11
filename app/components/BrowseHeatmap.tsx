"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useResults } from "./ResultsContext";
import type { SavedResult } from "@/lib/results-manager";

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

function effectMagnitude(r: SavedResult): number {
  if (r.effectType === 'beta') return Math.abs(r.riskScore);
  if (r.riskScore <= 0) return 0;
  return Math.abs(Math.log(r.riskScore));
}

function chipBg(r: SavedResult): string {
  const mag = effectMagnitude(r);
  const a = Math.min(0.95, 0.35 + mag * 0.6).toFixed(2);
  if (r.riskLevel === 'increased') return `rgba(220,38,38,${a})`;
  if (r.riskLevel === 'decreased') return `rgba(22,163,74,${a})`;
  return 'rgba(148,163,184,0.5)';
}

function effectLabel(r: SavedResult): string {
  if (r.effectType === 'beta') return `β=${r.riskScore >= 0 ? '+' : ''}${r.riskScore.toFixed(3)}`;
  return `OR ${r.riskScore.toFixed(2)}x`;
}

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
      .map(([trait, items]) => {
        const withResults = items
          .map(s => ({ study: s, result: hasResult(s.id) ? getResult(s.id) : null }))
          .sort((a, b) => {
            if (!a.result && !b.result) return 0;
            if (!a.result) return 1;
            if (!b.result) return -1;
            return effectMagnitude(b.result) - effectMagnitude(a.result);
          });

        const increased = withResults.filter(x => x.result?.riskLevel === 'increased').length;
        const decreased = withResults.filter(x => x.result?.riskLevel === 'decreased').length;
        const analyzed = withResults.filter(x => x.result).length;
        const dominant = increased > decreased ? 'increased' : decreased > increased ? 'decreased' : increased > 0 ? 'mixed' : 'none';

        return { trait, items: withResults, increased, decreased, analyzed, total: items.length, dominant };
      })
      // Sort: most analyzed first, break ties by dominant signal magnitude
      .sort((a, b) => {
        if (b.analyzed !== a.analyzed) return b.analyzed - a.analyzed;
        return b.total - a.total;
      });
  }, [studies, hasResult, getResult]);

  return (
    <div className="browse-heatmap">
      <div className="browse-heatmap-legend">
        <span className="heatmap-legend-item">
          <span className="heatmap-badge heatmap-badge--increased">↑ 4</span>
          Elevated risk studies
        </span>
        <span className="heatmap-legend-item">
          <span className="heatmap-badge heatmap-badge--decreased">↓ 2</span>
          Reduced risk studies
        </span>
        <span className="heatmap-legend-item">
          <span className="heatmap-chip heatmap-chip--none" />
          Not analyzed — darker chip = stronger effect
        </span>
      </div>

      <div className="browse-heatmap-rows">
        {groups.map(({ trait, items, increased, decreased, total, dominant }) => (
          <div key={trait} className={`browse-heatmap-row browse-heatmap-row--${dominant}`}>
            <span className="browse-heatmap-trait" title={trait}>{trait}</span>
            <div className="browse-heatmap-summary">
              {increased > 0 && (
                <span className="heatmap-badge heatmap-badge--increased">↑ {increased}</span>
              )}
              {decreased > 0 && (
                <span className="heatmap-badge heatmap-badge--decreased">↓ {decreased}</span>
              )}
              {increased === 0 && decreased === 0 && (
                <span className="heatmap-badge heatmap-badge--none">{total}</span>
              )}
            </div>
            <div className="browse-heatmap-chips">
              {items.map(({ study: s, result }) =>
                result ? (
                  <Link
                    key={s.id}
                    href={`/study/${s.id}`}
                    className="heatmap-chip"
                    style={{ background: chipBg(result) }}
                    title={`${s.study || trait}\n${effectLabel(result)}`}
                  />
                ) : (
                  <Link
                    key={s.id}
                    href={`/study/${s.id}`}
                    className="heatmap-chip heatmap-chip--none"
                    title={s.study || trait}
                  />
                )
              )}
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
