"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SavedResult } from "@/lib/results-manager";
import { useCustomization } from "./CustomizationContext";
import { callLLM } from "@/lib/llm-client";
import { trackContinueInDNAChat } from "@/lib/analytics";

type Props = {
  result: SavedResult;
  pubmedId?: string | null;
  mappedGene?: string | null;
  reportedTrait?: string | null;
};

type Suggestions = {
  chat: string[];
  browse: string[];
};

function formatRiskScore(score: number, level: string, effectType?: 'OR' | 'beta'): string {
  if (level === 'neutral') return effectType === 'beta' ? 'baseline' : '1.0x';
  if (effectType === 'beta') return `β=${score >= 0 ? '+' : ''}${score.toFixed(3)} units`;
  return `${score.toFixed(2)}x`;
}

function markdownToHtml(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/^[\*\-] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .split('\n\n')
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => (p.startsWith('<h') || p.startsWith('<ul')) ? p : `<p>${p}</p>`)
    .join('');
}

function describeEffect(effectSize: string, effectType?: 'OR' | 'beta', riskLevel?: string): string {
  const val = parseFloat(effectSize);
  if (isNaN(val)) return '';

  if (effectType === 'beta') {
    const sign = val >= 0 ? '+' : '';
    return `Each risk allele is associated with a ${sign}${val.toFixed(3)} unit change in the trait value (beta coefficient from linear regression).`;
  }

  // OR interpretation
  if (val === 1) return 'This variant has no effect on odds (OR = 1.0).';
  if (val > 1) {
    const pct = ((val - 1) * 100).toFixed(0);
    return `Each copy of the risk allele raises the odds by ${pct}% relative to non-carriers (OR = ${val.toFixed(2)}).`;
  }
  // val < 1 — protective
  const pct = ((1 - val) * 100).toFixed(0);
  return `Each copy of this allele lowers the odds by ${pct}% relative to non-carriers (OR = ${val.toFixed(2)}).`;
}

function parseSuggestions(raw: string): { commentary: string; suggestions: Suggestions } {
  const idx = raw.indexOf('SUGGESTIONS:');
  if (idx === -1) return { commentary: raw, suggestions: { chat: [], browse: [] } };

  const commentaryPart = raw.slice(0, idx).trimEnd();
  const jsonPart = raw.slice(idx + 'SUGGESTIONS:'.length).trim();

  try {
    const parsed = JSON.parse(jsonPart);
    return {
      commentary: commentaryPart,
      suggestions: {
        chat: Array.isArray(parsed.chat) ? parsed.chat.slice(0, 2) : [],
        browse: Array.isArray(parsed.browse) ? parsed.browse.slice(0, 3) : [],
      },
    };
  } catch {
    return { commentary: raw, suggestions: { chat: [], browse: [] } };
  }
}

export default function StudyInlineAnalysis({ result, pubmedId, mappedGene, reportedTrait }: Props) {
  const { customization } = useCustomization();
  const [commentary, setCommentary] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestions>({ chat: [], browse: [] });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pubmedWarning, setPubmedWarning] = useState<string | null>(null);

  const analyze = async () => {
    setIsLoading(true);
    setError(null);
    setCommentary("");
    setSuggestions({ chat: [], browse: [] });
    setPubmedWarning(null);

    try {
      // Fetch PubMed abstract for richer context
      let pubmedContext = '';
      if (pubmedId) {
        try {
          const pmRes = await fetch(`/api/pubmed-abstract?pmid=${pubmedId}`);
          if (pmRes.ok) {
            const { abstract } = await pmRes.json();
            if (abstract) {
              pubmedContext = `\n\nPUBMED ABSTRACT:\n${abstract}`;
            }
          } else {
            setPubmedWarning("PubMed data unavailable; interpretation based on GWAS metadata only.");
          }
        } catch {
          setPubmedWarning("PubMed data unavailable; interpretation based on GWAS metadata only.");
        }
      }

      // Fetch study metadata for quality context
      let studyQualityContext = '';
      const metaRes = await fetch(`/api/study-metadata?studyId=${result.studyId}`);
      if (metaRes.ok) {
        const { metadata } = await metaRes.json();
        if (metadata) {
          const parseSampleSize = (str: string | null) => {
            if (!str) return 0;
            const m = str.match(/[\d,]+/);
            return m ? parseInt(m[0].replace(/,/g, '')) : 0;
          };
          const initialSize = parseSampleSize(metadata.initial_sample_size);
          const replicationSize = parseSampleSize(metadata.replication_sample_size);
          studyQualityContext = `

STUDY QUALITY:
- Sample size: ${initialSize.toLocaleString()} participants${initialSize < 5000 ? ' (small — interpret with caution)' : initialSize < 50000 ? ' (medium)' : ' (large, well-powered)'}
- Ancestry: ${metadata.initial_sample_size || 'not specified'}
- Replication: ${replicationSize > 0 ? `yes (${replicationSize.toLocaleString()} participants)` : 'none reported'}
- P-value: ${metadata.p_value || 'not reported'}`;
        }
      }

      // Build user background context from customization
      let userContext = '';
      if (customization) {
        const parts: string[] = [];
        if (customization.ethnicities.length > 0) parts.push(`Ethnicities: ${customization.ethnicities.join(', ')}`);
        if (customization.countriesOfOrigin.length > 0) parts.push(`Countries of origin: ${customization.countriesOfOrigin.join(', ')}`);
        if (customization.genderAtBirth) parts.push(`Gender at birth: ${customization.genderAtBirth}`);
        if (customization.age) parts.push(`Age: ${customization.age}`);
        if (customization.personalConditions?.length) parts.push(`Personal conditions: ${customization.personalConditions.join(', ')}`);
        if (customization.familyConditions?.length) parts.push(`Family conditions: ${customization.familyConditions.join(', ')}`);
        if (parts.length > 0) {
          userContext = `

USER BACKGROUND:
${parts.join('\n')}`;
        }
      }

      const prompt = `You are a genetic counselor writing a brief interpretation of a GWAS result shown on a study page.${pubmedContext}${studyQualityContext}${userContext}

RESULT:
Trait (mapped): ${result.traitName}${reportedTrait && reportedTrait !== result.traitName ? `\nTrait (as measured in study): ${reportedTrait}` : ''}
Mapped gene: ${mappedGene || 'not specified'}
Genotype: ${result.userGenotype}
Risk allele: ${result.riskAllele}
Effect size: ${result.effectSize} (${result.effectType === 'beta' ? 'beta coefficient' : 'odds ratio'})
Effect in plain terms: ${describeEffect(result.effectSize, result.effectType, result.riskLevel)}
Risk score: ${formatRiskScore(result.riskScore, result.riskLevel, result.effectType)} (${result.riskLevel})
Matched SNP: ${result.matchedSnp}

Write a plain-language interpretation covering:
1. The trait itself — what is being measured, what it represents biologically, and why scientists study it. Lead with the trait, not the gene. If the measured trait (see "Trait as measured") is a complex ratio, imaging metric, or mass spec measurement, explain what that measurement captures and what it means in the body. Only bring in the mapped gene as supporting context for how it influences this specific trait — do not describe the gene's general fame or its associations with unrelated conditions unless those associations directly explain the trait being studied.
2. How well-established this association is, considering the sample size, replication, and p-value. Note any ancestry or population limitations relevant to the user.
3. What this specific genotype means for the user — at least two sentences. Explain how many copies of the risk allele they carry and calculate the cumulative effect (e.g. 2 copies × per-allele effect). For beta coefficients, use your knowledge of how this trait is measured to express the effect in concrete terms. For odds ratios, use your knowledge of baseline prevalence to give approximate absolute risk figures. Always signal when you are inferring rather than reading from the data.
4. The "so what" — what does this result actually imply for the user's biology, health, or function? Commit to what IS known about this trait, even if incomplete. For example, if higher white matter connectivity is generally associated with better cognitive performance in the literature, say that. If a gene variant's known biology has implications for how the brain or body ages, say that specifically. Do not retreat into pure neutrality ("associated with variations in how the brain processes information" is not useful). Be calibrated — these are common population variants, not diagnoses — but calibrated does not mean saying nothing. State what is currently understood as confidently as the evidence allows, and flag uncertainty clearly where it exists.

Do not repeat the genotype, effect size, or SNP — the user can already see those on the page. Do not include disclaimers. 250-350 words, direct and informative.

After the interpretation, on a new line, output follow-up suggestions in this exact format (valid JSON, no markdown):
SUGGESTIONS:{"chat":["question 1 for DNA Chat","question 2 for DNA Chat"],"browse":["related trait 1","related trait 2","related trait 3"]}

The chat questions should be specific, conversational questions the user might want to ask about their own DNA data. The browse traits should be short trait names (2-4 words) they might want to explore next.`;

      const response = await callLLM([
        {
          role: "system",
          content: "You are a knowledgeable genetic counselor. Explain GWAS results clearly and concisely. No disclaimers, no repetition of information the user can already see on the page. Avoid vague hedges — say something specific and useful about health implications. Do not use LaTeX or math notation; write numbers in plain text (e.g. 9×10⁻¹⁰ or p=9e-10). Always end your response with the SUGGESTIONS line as instructed.",
        },
        { role: "user", content: prompt },
      ], { maxTokens: 1100, temperature: 0.7, reasoningEffort: 'low' });

      if (!response.content) throw new Error("No commentary generated");
      const { commentary: parsed, suggestions: parsedSuggestions } = parseSuggestions(response.content);
      setCommentary(markdownToHtml(parsed));
      setSuggestions(parsedSuggestions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    analyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasSuggestions = suggestions.chat.length > 0 || suggestions.browse.length > 0;

  const dnaChatContinueUrl = (() => {
    const riskAllele = result.riskAllele.split('-').pop() || result.riskAllele;
    const q = `I've just read the AI interpretation of my result for "${result.traitName}" (study: "${result.studyTitle}"). I carry the ${result.userGenotype} genotype at ${result.matchedSnp} — the risk allele is ${riskAllele} and my effect is ${result.riskLevel}. I'd like to discuss this result and ask follow-up questions.`;
    return `/dna-chat?q=${encodeURIComponent(q)}`;
  })();

  return (
    <div className="study-inline-analysis">
      <div className="sia-header">
        <span className="sia-icon">🤖</span>
        <h3 className="sia-title">AI Interpretation</h3>
        <span className="sia-powered-by">Private AI</span>
        {!isLoading && (commentary || error) && (
          <button className="sia-rerun-button" onClick={analyze} title="Regenerate analysis">↺</button>
        )}
      </div>

      {isLoading && (
        <div className="sia-loading">
          <div className="loading-spinner" />
          <p>Generating interpretation...</p>
        </div>
      )}

      {error && (
        <div className="sia-error">
          <p>❌ {error}</p>
          <button className="retry-button" onClick={analyze}>Try Again</button>
        </div>
      )}

      {pubmedWarning && (
        <p className="sia-warning">{pubmedWarning}</p>
      )}

      {!isLoading && !error && commentary && (
        <div className="sia-body" dangerouslySetInnerHTML={{ __html: commentary }} />
      )}

      {!isLoading && hasSuggestions && (
        <div className="sia-suggestions">
          {suggestions.chat.length > 0 && (
            <div className="sia-suggestion-group">
              <p className="sia-suggestion-label">Ask in DNA Chat</p>
              <div className="sia-chips">
                {suggestions.chat.map((q, i) => (
                  <Link
                    key={i}
                    href={`/dna-chat?q=${encodeURIComponent(q)}`}
                    className="sia-chip sia-chip--chat"
                  >
                    {q}
                  </Link>
                ))}
              </div>
            </div>
          )}
          {suggestions.browse.length > 0 && (
            <div className="sia-suggestion-group">
              <p className="sia-suggestion-label">Explore related traits</p>
              <div className="sia-chips">
                {suggestions.browse.map((t, i) => (
                  <Link
                    key={i}
                    href={`/browse?q=${encodeURIComponent(t)}`}
                    className="sia-chip sia-chip--browse"
                  >
                    {t}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!isLoading && commentary && (
        <div className="sia-continue-row">
          <Link href={dnaChatContinueUrl} className="sia-continue-button" onClick={() => trackContinueInDNAChat('study_analysis')}>
            Continue this conversation in DNA Chat →
          </Link>
        </div>
      )}
    </div>
  );
}
