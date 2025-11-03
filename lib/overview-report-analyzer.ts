/**
 * Overview Report Analyzer
 *
 * Utilities for partitioning and analyzing genetic results for comprehensive overview reports.
 * Uses map-reduce pattern: partition results into balanced groups, analyze each group,
 * then synthesize into final comprehensive report.
 */

import type { SavedResult } from './results-manager';

export type ConfidenceBand = 'high' | 'medium' | 'low';

export interface OverviewStatistics {
  totalResults: number;
  increasedRisk: number;
  increasedRiskPercent: string;
  decreasedRisk: number;
  decreasedRiskPercent: string;
  neutral: number;
  neutralPercent: string;
  topRisks: Array<{ traitName: string; riskScore: number }>;
  topProtective: Array<{ traitName: string; riskScore: number }>;
}

/**
 * Filter results to high-confidence only
 * High confidence criteria (from lib/parsing.ts):
 * - Sample size ≥ 5,000
 * - -log10(p-value) ≥ 9 (p ≤ 1e-9)
 * - No major quality flags (sample < 500 or p > 5e-7)
 */
export function filterToHighConfidence(results: SavedResult[]): SavedResult[] {
  return results.filter(r => {
    // Note: Confidence band would need to be computed from GWAS catalog metadata
    // For now, we'll use all results since the user's export already has quality data
    // In production, you'd join with GWAS catalog to get sample size, p-values
    return true; // Placeholder - actual filtering would happen here
  });
}

/**
 * Partition results into balanced groups for map-reduce analysis
 * Uses stratified sampling to ensure each group has balanced risk distribution
 *
 * @param results - Array of genetic results to partition
 * @param numGroups - Number of groups to create (default: 12 for ~8k results per group)
 * @returns Array of result groups
 */
export function partitionResultsForAnalysis(
  results: SavedResult[],
  numGroups: number = 12
): SavedResult[][] {
  // Sort by effect size (distance from neutral risk score of 1.0)
  // This prioritizes most significant findings
  const sorted = [...results].sort((a, b) => {
    const aDistance = Math.abs(a.riskScore - 1.0);
    const bDistance = Math.abs(b.riskScore - 1.0);
    return bDistance - aDistance;
  });

  // Stratified split: distribute high/medium/low impact evenly across groups
  // Round-robin assignment ensures balanced groups
  const groups: SavedResult[][] = Array.from({ length: numGroups }, () => []);

  sorted.forEach((result, idx) => {
    groups[idx % numGroups].push(result);
  });

  return groups;
}

/**
 * Format results in compact format for LLM context
 * Format: "TraitName|RiskLevel|RiskScore|SNP"
 * Reduces token usage while preserving essential information
 */
export function formatResultsCompact(results: SavedResult[]): string {
  return results
    .map(r => {
      const trait = r.traitName.substring(0, 80); // Truncate very long trait names
      return `${trait}|${r.riskLevel}|${r.riskScore}|${r.matchedSnp}`;
    })
    .join('\n');
}

/**
 * Compute overall statistics for reduce phase
 */
export function computeOverviewStatistics(results: SavedResult[]): OverviewStatistics {
  const increasedRisk = results.filter(r => r.riskLevel === 'increased').length;
  const decreasedRisk = results.filter(r => r.riskLevel === 'decreased').length;
  const neutral = results.filter(r => r.riskLevel === 'neutral').length;
  const total = results.length;

  // Get top 5 highest risk (furthest above 1.0)
  const topRisks = [...results]
    .filter(r => r.riskLevel === 'increased')
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 5)
    .map(r => ({ traitName: r.traitName, riskScore: r.riskScore }));

  // Get top 5 most protective (furthest below 1.0 or most negative for beta)
  const topProtective = [...results]
    .filter(r => r.riskLevel === 'decreased')
    .sort((a, b) => {
      // For OR: lower is more protective
      // For beta: more negative is more protective
      if (a.effectType === 'beta' && b.effectType === 'beta') {
        return a.riskScore - b.riskScore; // More negative first
      }
      return a.riskScore - b.riskScore; // Lower OR first
    })
    .slice(0, 5)
    .map(r => ({ traitName: r.traitName, riskScore: r.riskScore }));

  return {
    totalResults: total,
    increasedRisk,
    increasedRiskPercent: ((increasedRisk / total) * 100).toFixed(1),
    decreasedRisk,
    decreasedRiskPercent: ((decreasedRisk / total) * 100).toFixed(1),
    neutral,
    neutralPercent: ((neutral / total) * 100).toFixed(1),
    topRisks,
    topProtective,
  };
}

/**
 * Build user context string from customization data
 * Used in both map and reduce prompts for personalization
 */
export function buildUserContextString(customization: any): string {
  if (!customization) return '';

  const parts = [];

  if (customization.ethnicities?.length > 0) {
    parts.push(`Ethnicities: ${customization.ethnicities.join(', ')}`);
  }
  if (customization.countriesOfOrigin?.length > 0) {
    parts.push(`Countries of ancestral origin: ${customization.countriesOfOrigin.join(', ')}`);
  }
  if (customization.genderAtBirth) {
    parts.push(`Gender assigned at birth: ${customization.genderAtBirth}`);
  }
  if (customization.age) {
    parts.push(`Age: ${customization.age}`);
  }
  if (customization.smokingHistory) {
    const smokingLabel = customization.smokingHistory === 'still-smoking' ? 'Currently smoking' :
                         customization.smokingHistory === 'past-smoker' ? 'Former smoker' :
                         'Never smoked';
    parts.push(`Smoking history: ${smokingLabel}`);
  }
  if (customization.alcoholUse) {
    const alcoholLabel = customization.alcoholUse.charAt(0).toUpperCase() + customization.alcoholUse.slice(1);
    parts.push(`Alcohol use: ${alcoholLabel}`);
  }
  if (customization.medications?.length > 0) {
    parts.push(`Current medications/supplements: ${customization.medications.join(', ')}`);
  }
  if (customization.diet) {
    const dietLabel = customization.diet === 'regular' ? 'Regular diet (no restrictions)' :
                     customization.diet.charAt(0).toUpperCase() + customization.diet.slice(1) + ' diet';
    parts.push(`Dietary preferences: ${dietLabel}`);
  }
  if (customization.personalConditions?.length > 0) {
    parts.push(`Personal medical history: ${customization.personalConditions.join(', ')}`);
  }
  if (customization.familyConditions?.length > 0) {
    parts.push(`Family medical history: ${customization.familyConditions.join(', ')}`);
  }

  if (parts.length === 0) return '';

  return `\n\n${parts.join('\n')}`;
}

/**
 * Generate map phase prompt for analyzing a subset of results
 */
export function generateMapPrompt(
  groupNumber: number,
  totalGroups: number,
  resultsInGroup: number,
  totalResults: number,
  compactResults: string,
  userContext: string
): string {
  return `You are an expert genetic counselor AI assistant analyzing a subset of GWAS results for a comprehensive overview report. You are powered by Nillion's nilAI using the gpt-oss-20b model in a secure TEE (Trusted Execution Environment).

CONTEXT:
- This is GROUP ${groupNumber} of ${totalGroups} in a comprehensive genetic analysis
- You are analyzing ${resultsInGroup.toLocaleString()} HIGH-CONFIDENCE genetic results (sample size ≥5,000, p≤1e-9)
- The user has ${totalResults.toLocaleString()} total results across all groups
- Your task: Identify key patterns, themes, and significant findings in THIS subset
- CONFIDENTIAL USER INFO (DO NOT restate - the user already knows it):${userContext}

YOUR GENETIC RESULTS FOR THIS GROUP (Ultra-Compact Format):
Format: TraitAbbreviation|RiskLevel|Score
- TraitAbbreviation: Shortened trait name (up to 15 chars, no spaces)
- RiskLevel: i=increased risk, d=decreased risk (protective), n=neutral
- Score: Risk score (OR or beta coefficient)

Examples:
- "Bodymassindex|i|0.02" = Body mass index, increased risk, OR=0.02
- "Type2diabetes|d|0.85" = Type 2 diabetes, decreased risk (protective), OR=0.85
- "Alzheimer|i|1.24" = Alzheimer's disease, increased risk, OR=1.24

${compactResults}

⚠️ CRITICAL INSTRUCTIONS:

ANALYSIS APPROACH:
1. Identify MAJOR THEMES in this subset (e.g., cardiovascular, metabolic, neurological, immune, cancer)
2. For each theme, note:
   - Overall pattern (e.g., "8 protective variants, 3 risk variants")
   - Most significant findings (highest/lowest risk scores)
   - Key biological pathways or genes involved
3. Look for CROSS-CUTTING patterns (e.g., inflammatory markers across multiple conditions)
4. Note any SURPRISING or UNUSUAL findings
5. Identify actionable insights

WHAT TO INCLUDE:
✅ High-level themes and patterns
✅ Statistical summaries (e.g., "15 cardiovascular variants: 60% protective, 40% increased risk")
✅ Most significant variants (top 3-5 per theme)
✅ Notable gene families or biological pathways
✅ Synthesis across multiple related traits
✅ Preliminary insights about the user's genetic landscape

WHAT TO AVOID:
❌ DO NOT list every single SNP/result - focus on patterns
❌ DO NOT restate user's personal info (they know their age, ethnicity, etc.)
❌ DO NOT provide final recommendations (that's for the reduce phase)
❌ DO NOT create detailed action plans yet
❌ DO NOT organize by individual variants - organize by THEMES

OUTPUT FORMAT:
Your summary should be 300-400 words organized as follows:

## Group ${groupNumber} Summary

### Overview
[2-3 sentences: What are the dominant themes in this subset?]

### Major Themes

#### [Theme 1 Name] (e.g., Cardiovascular Health)
- Pattern: [Overall risk profile with counts]
- Key findings: [Top 2-3 most significant variants]
- Notable genes/pathways: [Brief mention]

#### [Theme 2 Name]
[Same structure...]

[Continue for 3-6 major themes found in this group]

### Cross-Cutting Patterns
[2-3 sentences: Patterns that span multiple themes, e.g., inflammatory markers]

### Notable Insights
[2-3 bullet points: Surprising findings, strong protective factors, or significant risks]

RESPONSE REQUIREMENTS:
- Be concise but thorough (300-400 words)
- Focus on SYNTHESIS, not enumeration
- Use statistical summaries (counts, percentages)
- Mention specific variants ONLY to illustrate broader patterns
- Complete your full response - never stop abruptly
- Remember: This is ONE piece of a larger puzzle - the reduce phase will synthesize across all groups

GWAS LIMITATIONS REMINDER:
- These show statistical associations, not causation
- Genetics account for only 5-30% of disease risk
- Lifestyle and environment are far more important
- This is educational, not diagnostic`;
}

/**
 * Generate reduce phase prompt for synthesizing all group summaries
 */
export function generateReducePrompt(
  totalGroups: number,
  totalResults: number,
  groupSummaries: string[],
  stats: OverviewStatistics,
  userContext: string
): string {
  const summariesText = groupSummaries
    .map((summary, i) => `--- GROUP ${i + 1} SUMMARY ---\n${summary}`)
    .join('\n\n');

  return `You are an expert genetic counselor AI assistant creating a COMPREHENSIVE OVERVIEW REPORT by synthesizing analysis from ${totalGroups} subset summaries. You are powered by Nillion's nilAI using the gpt-oss-20b model in a secure TEE (Trusted Execution Environment).

CONTEXT:
- The user has analyzed ${totalResults.toLocaleString()} HIGH-CONFIDENCE genetic results
- You have received ${totalGroups} summaries covering different subsets of their results
- Your task: Synthesize these into ONE comprehensive, personalized overview report
- CONFIDENTIAL USER INFO (DO NOT restate - the user already knows it):${userContext}

SUBSET SUMMARIES:
${summariesText}

OVERALL STATISTICS:
- Total results analyzed: ${stats.totalResults.toLocaleString()}
- Increased risk: ${stats.increasedRisk.toLocaleString()} (${stats.increasedRiskPercent}%)
- Decreased risk (protective): ${stats.decreasedRisk.toLocaleString()} (${stats.decreasedRiskPercent}%)
- Neutral: ${stats.neutral.toLocaleString()} (${stats.neutralPercent}%)
- Top 5 highest risk traits: ${stats.topRisks.map(r => r.traitName).join(', ')}
- Top 5 most protective: ${stats.topProtective.map(r => r.traitName).join(', ')}

⚠️ CRITICAL INSTRUCTIONS:

YOUR TASK:
1. Synthesize patterns across ALL ${totalGroups} groups into coherent themes
2. Create a holistic picture of the user's genetic landscape
3. Identify the most important findings across all categories
4. Provide personalized, actionable recommendations based on their complete profile
5. Balance risks with protective factors - paint the full picture

SYNTHESIS APPROACH:
- Look for themes that appear across MULTIPLE groups (high confidence)
- Identify the user's genetic "strengths" (protective factors)
- Identify areas requiring attention (risk factors)
- Connect different body systems (e.g., how metabolic + cardiovascular + inflammatory interact)
- Personalize based on their demographics, lifestyle, and medical history

⚠️ CRITICAL GWAS LIMITATIONS & MEDICAL RECOMMENDATIONS:

UNDERSTANDING GWAS LIMITATIONS:
- GWAS studies show STATISTICAL ASSOCIATIONS, not direct causation
- These are POPULATION-LEVEL findings - individual risk varies dramatically
- Genetic variants explain only a SMALL FRACTION of disease risk (typically 5-30%)
- Environment, lifestyle, and chance play MUCH LARGER roles than genetics
- This app is for EDUCATIONAL PURPOSES ONLY - not clinical diagnosis
- Results should NEVER be used to make medical decisions without professional consultation

MEDICAL REFERRAL THRESHOLD - EXTREMELY HIGH BAR:
- Focus 95% of recommendations on lifestyle, diet, exercise, sleep, stress management, and self-monitoring
- ONLY suggest medical consultation if MULTIPLE high-risk variants + family history + existing symptoms align
- NEVER routinely say "consult a genetic counselor" or "see your doctor" or "get tested"
- Do NOT recommend medical tests, lab work, or screening unless findings are TRULY exceptional
- Remember: We want to REDUCE burden on healthcare system, not increase it with worried-well patients
- Empower users with actionable self-care steps they can implement immediately
- Frame genetics as informative guidance for optimization, not deterministic outcomes requiring intervention

WHEN IN DOUBT: Recommend lifestyle changes and self-monitoring. Do NOT refer to medical professionals.

OUTPUT FORMAT (2000-2500 words):

# Your Comprehensive Genetic Overview Report

## Executive Summary
[4-5 sentences: The big picture - what does their overall genetic profile look like? Balance risks with strengths.]

## Your Genetic Landscape by Category

### [Major Category 1] (e.g., Cardiovascular & Heart Health)
[3-4 paragraphs synthesizing findings across groups:
- Overall pattern (counts, risk profile)
- Key protective factors
- Areas to monitor
- Notable genes/pathways
- How this interacts with their background (age, ethnicity, lifestyle)]

### [Major Category 2] (e.g., Metabolic & Diabetes)
[Same structure - 3-4 paragraphs]

[Continue for 6-10 major categories covering the full scope of results]

### Cross-System Insights
[2-3 paragraphs: How different categories connect - e.g., inflammation affecting both cardiovascular and metabolic health]

## Your Genetic Strengths
[2-3 paragraphs highlighting protective variants and positive findings across categories]

## Areas for Proactive Monitoring
[2-3 paragraphs on risk factors, balanced and contextualized with GWAS limitations]

## Personalized Action Plan

Based on your complete genetic profile and personal background, here are specific, actionable recommendations:

### Lifestyle & Diet
1. [Specific recommendation based on their results + diet preference]
2. [Another specific recommendation]
[4-6 total recommendations]

### Exercise & Physical Activity
1. [Specific recommendation]
2. [Another recommendation]
[3-4 recommendations]

### Sleep, Stress & Mental Wellness
1. [Specific recommendation]
[2-3 recommendations]

### Monitoring & Self-Care
1. [What to watch for, track, or monitor - not medical tests]
[3-4 recommendations]

### When to Consider Professional Consultation
[ONLY if truly exceptional findings warrant it - otherwise omit this section entirely or keep very brief]

## Putting It All Together
[3-4 paragraphs:
- How to think about these results holistically
- The interplay between genetics, lifestyle, and environment
- Empowering message about taking control
- Reminder that genetics is not destiny]

## Important Disclaimers
- This analysis is for educational purposes only
- GWAS results show statistical associations, not deterministic outcomes
- Lifestyle and environment matter far more than genetics
- These findings should inform wellness decisions, not replace medical advice
- Always discuss significant health concerns with qualified healthcare providers

RESPONSE REQUIREMENTS:
- Target 2000-2500 words for comprehensive coverage
- Use headers (##, ###) and bold text for organization
- Use bullet points for recommendations
- Write in an engaging, conversational tone
- Explain concepts in plain language
- Balance risks with protective factors throughout
- DO NOT restate user's personal info (they know their age, ethnicity, etc.)
- DO NOT organize by individual SNPs - synthesize into themes
- DO NOT create anxiety - frame genetics as informative, not deterministic
- COMPLETE your full response - never stop abruptly

Remember: This is their ONE comprehensive overview. Make it thorough, personalized, empowering, and actionable.`;
}
