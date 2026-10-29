# Explorer Android: deep-dive feedback with a real genotype imported

Date: 2026-10-29
Setup: Emulator, fresh install, imported the bundled sample file `.test-data/public-sample/23andme-public.txt` (967k lines, 25MB). Result: 929,696 variants parsed, 86,859 research matches, about 15 seconds on an emulator. Profile filled in (age 45, male, South Asian, hypertension, family history of type 2 diabetes). Health and Healthspan reports generated, Chat tested with a suggested question. This doc builds on the first-pass review (docs/pm-feedback-android-2026-10-29.md); items there are not repeated unless the import changed the picture.

## Executive summary

The core loop works end to end and the moment after import is genuinely strong: Home transforms into "Ask about your DNA" with good suggested questions, the Drive sync prompt appears at exactly the right time, and reports are fast (about 15s). The product risks are now concentrated in content quality and trust: report prose is dense and occasionally overreaching, Chat has high latency and opens with filler, risk numbers are shown without absolute-risk context anywhere, and premium gating did not engage in this build. The Batcher integration you mentioned is the right answer for unsequenced users; it will not fix the trust issues below, which apply to paying users with data imported.

## What works well (keep and amplify)

1. Import is fast and reassuring. 929,696 variants in ~15s, with an immediate summary "Imported 929,696 variants from 23andMe and found 86,859 research matches" and a persistent "Saved securely on this device / Lock data" header.
2. The post-import Drive sync prompt ("Keep your data on a new phone") is well timed and well worded. This is the moment users are most receptive.
3. Home transforms after import: suggested questions ("Which of my results have the strongest evidence?", "Is there anything I could discuss with my doctor?") are exactly the questions a real user has. Suggestion chips populate the input instead of auto-sending, which is the right behavior.
4. Personalization is real. The Healthspan report explicitly referenced "your history of hypertension". Profile data flows into reports visibly, which justifies step 2 of onboarding.
5. The matches list is strong: 86,859 matches, All/Increased/Decreased filters, per-card genotype, OR, direction arrow, and evidence labels like "Stronger GWAS evidence".
6. Match detail sheets show real study metadata: accession, genes, risk allele, OR with confidence interval, p-value, and full discovery sample breakdown by ancestry. The multi-ancestry sample display is a differentiator.
7. Device-authentication gating on the vault works and the copy explains why.

## Issues found in motion, ordered by impact

### 1. Risk numbers without context (trust-critical, product-wide)

Everywhere the app shows effect sizes (match cards OR 1.19, chat betas of 1.3x-1.56x, report effect intervals) there is no absolute risk framing. A 1.3x relative increase on a 1% baseline and on a 50% baseline are completely different situations, and users cannot tell which they are looking at. The Home disclaimer ("Odds ratios are relative, not absolute risk") states the limitation but does not help the user interpret any specific number. Recommendation: pick 2-3 high-interest traits and show baseline incidence next to relative effect, or add a per-match "what this means" line in plain language. This is the single biggest gap between "research browser" and "product users act on".

### 2. Health report content quality

Generated in about 15s. Structure is good (numbered plain-language section headers, a "What to investigate further" section, a solid intro disclaimer). Problems inside:

- Dense, graduate-level prose: "loci", "glucose homeostasis", "coagulation cascades and vascular integrity", "homozygous for the non-risk genotype". The friendly headers promise accessibility the body text does not deliver.
- Overreaching headers: "What your genome protects you from" frames APOE rs429358 TT (simply not carrying the e4 risk allele) as protection from Alzheimer's. That means roughly baseline risk, not immunity. This framing can produce false reassurance on the highest-stakes finding in the report.
- Mixed evidence quality with no grading: robust associations (APOE) appear alongside obscure ones (FRG2LP, a pseudogene with no established macrovascular role; F5 rs6032, not Factor V Leiden) with no visual distinction. Match cards have evidence labels; reports should inherit them per finding.
- One logical error: "very large effect sizes in specific cohorts, which often indicates involvement in the immune-mediated pathways" is a non sequitur. Effect size does not indicate pathway.
- No actionable guidance: findings like coagulation variants and dementia risk appear with no "discuss with your doctor" pointers, despite the Chat tab having a suggested question for exactly that.

Recommendation: add an evidence-strength badge per finding, a plain-language summary sentence per section, tone down deterministic headers ("protects you from" to "associated with lower odds"), and end health reports with a short "questions for your doctor" list.

### 3. Chat latency and filler

The heart-health question took about 90 seconds: a "Finding your most relevant results" phase, an "Asking nilAI" phase, then a visible "The AI provider is busy; retrying" state, then the answer. The retry messaging is honest and good, but 90s is a long wait for the app's flagship interaction. The answer then opened with a generic paragraph ("Personalized Overview... a detailed, multi-layered view of your cardiovascular landscape") that says nothing user-specific before the real, well-cited content begins. Users will judge the answer by its first two sentences.

Recommendations: stream the answer so latency is perceived as progress; cut or move the generic preamble; keep the retry messaging, it builds trust.

### 4. Chat answer quality and citations

Once past the preamble, the answer was specific: four rsIDs with genotypes and beta values, biological mechanisms, and a synthesis. Two gaps:

- No links back to the matched studies. The user is one tap away from the underlying match cards and study details, but Chat does not cite them. Tappable citations would connect Chat to the matches surface and make answers verifiable.
- No disclaimer in the chat thread itself. The checkbox consent is at the top of the screen, but an answer listing coronary artery disease risk with effect sizes should carry a one-line "educational research, not medical advice" inline, since threads will be screenshotted and shared.

Also: the "Research" button (10-angle deep answer) is never explained in place. Its function is described only in small helper text.

### 5. OR inconsistency between card and detail

The Atopic dermatitis card shows "rs6010620: GG - OR 1.19" while the detail sheet shows "Odds ratio: 1.09". 1.19 is approximately 1.09 squared, so the card appears to show a genotype-adjusted OR (two risk alleles) while the detail shows the study's per-allele OR. If that is intentional, both need labels ("your genotype OR" vs "per-allele study OR"). If not, it is a bug. As shown, it looks like a data error to anyone who checks.

### 6. Premium gating did not engage

The Account screen read "Premium is active" on a fresh install before any purchase, and the Healthspan report (not marked Free) generated in about 15s with no paywall or purchase prompt. This may be correct for a debug build, but it needs verification in a release build: if the paywall is broken in production, the entire report-pass and subscription revenue path is open. Related, from the first pass: "Unable to load Google Play products" on the Account screen, and no prices shown anywhere.

### 7. Smaller items

- Device authentication triggers on tapping "Choose DNA file", before the user has even seen the file picker. If the user cancels or has no file, they authenticated for nothing. Trigger auth after file selection, at the moment the encrypted vault is actually opened.
- Checkbox tap targets remain too small: I missed the Chat consent checkbox twice tapping near its visual center. Make the label row toggle the checkbox.
- "Catalog order" filter chip is clipped at the right screen edge; the lowest match card is clipped by the bottom nav (content padding vs nav bar height).
- Catalog version shows a git hash to users ("2026-10-23-b2e8138d"). Show the date only.
- Chat header exposes "gemma-4-26B-A4B-it". Consumers should see "nilAI (private AI)" with the model ID in settings.
- The Health report disclaimer block is excellent but appears only at the report's head; consider pinning a slim version at the top when scrolling long reports.

## Note on Batcher

Adding Batcher as the CTA for unsequenced visitors fits the gap identified in the first pass: Home step 1 currently dead-ends anyone without a raw file. One suggestion from this session: the Drive sync prompt after import shows the app knows how to surface a contextual offer at the right moment. Use the same pattern for Batcher, place it as a proper card in step 1 ("No DNA file yet? Get sequenced with Batcher") rather than a footnote link, and keep "Browse research without your DNA" as the free path.

## Priority list

1. Add absolute-risk context and plain-language interpretation to effect sizes (match cards, reports, chat).
2. Fix report content quality: evidence badges per finding, plainer prose, non-deterministic headers, doctor-questions ending.
3. Verify premium gating and Play Billing in a release build; explain "Premium is active" state.
4. Reduce chat latency (streaming) and remove the generic preamble.
5. Label or fix the card-vs-detail OR discrepancy (1.19 vs 1.09).
6. Add tappable study citations in chat answers and an inline disclaimer per answer.
7. Move vault auth to after file selection; enlarge checkbox targets.
8. Fix clipped "Catalog order" chip and bottom card padding; hide git hash; friendly AI provider naming.
