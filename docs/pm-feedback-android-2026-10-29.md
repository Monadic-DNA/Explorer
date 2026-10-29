# Explorer Android: PM feedback from emulator walkthrough

Date: 2026-10-29
Scope: Full walkthrough of the app on an Android emulator (fresh install state, no DNA imported). All five tabs, all five More sub-screens, and the research search flow were exercised end to end.

## Executive summary

The core promise (private, on-device DNA analysis against a 1M-study catalog) is clearly communicated and the privacy messaging is genuinely strong. The main risks to success are: (1) the activation funnel stalls at the very first step because the only meaningful action requires a DNA file most users do not have in hand, (2) semantic search quality undermines the "1 million studies" claim on the one feature available without a file, and (3) monetization surfaces are confusing and partially broken. Details below, ordered by impact.

## 1. Activation and onboarding

The funnel is: add DNA file, tell us about you, ask and read. In practice a new user lands on Home and almost everything is gated.

- The first step requires a raw DNA file. The only alternative offered is a small text link, "Browse research without your DNA". Users who are curious but have not yet exported their 23andMe file (a multi-day wait at 23andMe) have almost nothing to do. Recommend a first-class "explore without DNA" path: a prominent secondary card, a demo mode with a sample genome, or at minimum surfacing the free research browse on the Home screen as a real feature, not a footnote link.
- A sample/demo genome would be the single highest-leverage addition. It lets a new user experience Chat, Reports, and Matches in minute one, which is what converts curiosity into retrieving their real file.
- The disclaimer checkbox is required twice in different places (Home step 1 and again in the Vault import flow). Acknowledge it once and remember it.
- Checkbox tap targets are small relative to their labels (noted on Vault). Make the whole row tappable.
- The Chat and Reports tabs are dead ends before import: they show instructions but no preview of what the user will get. A sample chat thread or a blurred example report would sell the value before the user does the work.

## 2. Research search (the one feature available to everyone)

Tested with "lactose intolerance", semantic search on.

- The top result is "Urine lactose levels in chronic kidney disease" (rs4988235). The variant is the right one (the classic lactase persistence SNP), but the surfaced study is about kidney disease metabolomics. For a flagship consumer query, the first result should be a lactase persistence / lactose intolerance study. If the catalog's embeddings rank a CKD metabolomics paper first for this query, ranking needs trait-level boosting or curated canonical-trait mappings.
- Duplicate results appear: the same "Human milk oligosaccharide concentration" study shows up twice in a row.
- Result cards have a left-edge text truncation bug: titles and descriptions are clipped on the first characters ("man milk" for "Human milk", "etic" for "Genetic"). This looks broken on the very first screen a non-uploading user touches.
- The study detail sheet is technically accurate but confusing to a layperson: "Beta 0.244" positive while the effect interval says "unit decrease", and "reported risk allele" framing for a trait that is not a disease risk. Consider a plain-language summary line per study (this is a natural use of the on-device/LLM layer) and consistent sign conventions.
- Pressing Enter on the keyboard in the search field inserts a newline instead of submitting. Users will hit this constantly; wire IME search action to the Search button.
- "Previous / Next" pagination is visible and disabled before any search runs. Hide it until there are results.
- "Research catalog 2026-10-23-b2e8138d" (on Your matches) exposes a git hash to end users. Show a friendly date only.

## 3. Monetization and account

From More > Account and premium:

- "Unable to load Google Play products" is shown in the live UI. Either the emulator lacks Play services, but as presented a paying user sees a broken store. Handle this state with a retry and a human message, not a raw error.
- Pricing is never visible anywhere before purchase. The copy mentions a monthly subscription and per-report passes, but no prices are shown. Users should see what Premium costs and what each report pass costs before being asked to buy.
- "Stablecoin payments are available only on Web" is fine to note, but consider whether mentioning it in-app helps anyone; it mostly raises questions.
- The Reports tab marks Health report as "Free" but gives no indication of which reports are premium or what they cost. Label each card.
- The "Developer / Treat this device as Premium" toggle is visible in the settings UI. Confirm it is gated out of release builds; seeing it invites tampering attempts.

## 4. Navigation and information architecture

- Every sub-screen is titled "Explorer" at the top, identical to the app-level header, so the header never tells you where you are. Use the screen name (Vault, Your matches, Account) as the header.
- "Vault and backups" appears in two places (You tab and More). "Browse research" is also reachable from Home, More, and the Research button in Chat. Some duplication is fine, but the More menu is doing all the heavy lifting while the You tab is nearly empty. Consider promoting "Your matches" to a first-class destination, since matches are the product's core output.
- The Chat tab header shows "Provider: nilAI • gemma-4-26B-A4B-it" with a Change button. Exposing raw model IDs to consumers reads as engineering UI. Show "Private AI" or a friendly name, keep the model ID in settings.
- Branding inconsistency: the provider chip says "nilai", body copy says "nilAI".

## 5. Trust and copy (what is working)

Keep these:

- "It never leaves this device" on the import step, "Genetic data is processed on device" on More, and the Drive sync copy ("Monadic DNA never stores your data") are exactly the right reassurances at the right moments.
- The locked-vault metaphor with device authentication is well executed and the graphic helps.
- Educational-not-medical disclaimers are present without being alarmist.
- Google Drive hidden-folder sync with E2E encryption is a strong differentiator; it deserves a mention during onboarding, not only in the Vault screen.

## Suggested priority order

1. Demo/sample genome so the app is usable in minute one (activation).
2. Fix search result truncation and duplicate results (first impression).
3. Improve semantic ranking for common trait queries (core value claim).
4. Fix keyboard Enter submitting search (usability bug).
5. Show prices and per-report premium labels; fix the Play products error state (revenue).
6. Single disclaimer acknowledgment; larger checkbox targets.
7. Per-screen headers; consumer-friendly AI provider naming; hide dev toggle in release.
