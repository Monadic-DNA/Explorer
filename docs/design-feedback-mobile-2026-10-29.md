# Explorer mobile: graphic design feedback

Date: 2026-10-29
Scope: Android rendering of the shared Vault design system (tokens in design/vault/colors.json drive both platforms via scripts/sync-vault-design.py; iOS uses the same palette and type). Based on current builds: Home dashboard, study sheet with AI commentary, Results, Reports, Vault, locked/welcome screens. Type: Space Grotesk (Light/Regular/Bold) for UI, EB Garamond Medium for result card titles. Shapes: 10/16/24/32/40dp radius ramp.

## Overall assessment

This has a real design system, which puts it ahead of most utility apps. The radius ramp is consistent, the palette is disciplined, and the result card (40dp radius, pastel fill, star mark, Garamond title) is a genuinely recognizable signature element. The main weaknesses are a brand mark that disappears after onboarding, an underused accent color, one typeface that earns its place only on a single element, and a Light body weight that risks legibility.

## What is crafted (protect these)

1. **The result card is the brand.** 40dp corners, pastel category fill with deep tonal text, star mark, serif trait name, bold direction line. Distinctive, calm, memorable. Whatever changes elsewhere, keep this card's proportions.
2. **The warm canvas.** offTone is a barely-warm white (DisplayP3 1.0/1.0/0.984). It reads as paper, not clinic. Subtle and good.
3. **No panic colors.** "Increased" risk renders in the same tonal purple as everything else, with a triangle glyph for direction. For a consumer genetics product this restraint is a defensible editorial choice. Write it down as a principle ("color encodes category, never severity") so future contributors don't "fix" it.
4. **The radius ramp (10/16/24/32/40).** Chips, cards, sheets, and hero panels all sit on the same scale. It shows.
5. **The locked-state hero.** Dark brand panel (darkMain) with the white wordmark and star on the light canvas. The single highest-contrast moment in the app, reserved for the trust moment. Correct instinct.
6. **Markdown long-form.** Commentary and reports render with bolded data points (rsIDs, effect sizes), numbered section headers, generous leading. Scannable without being sparse.

## Issues, in priority order

### 1. Body text is set in Space Grotesk Light

VaultTheme maps bodyLarge to SpaceGrotesk Light. At mobile sizes (16sp and below), Light weight drops legibility, especially for older users, outdoors, and on pastel fills where contrast is already soft. Long-form content (reports, commentary, chat answers) is exactly where this hurts most. Change bodyLarge to Regular and keep Light for display sizes only.

### 2. The brand mark disappears after onboarding

The four-point star and wordmark carry the locked, welcome, and vault screens, then vanish. Post-unlock, the only brand signals are the pastel cards and the purple nav pill. Options: a small star in the top app bar next to the screen title, or keep the star on result cards but retire it everywhere else. Right now the opposite happens: the star is on every result card (where it is decorative noise, identical on all 86,859 cards) and absent from the chrome (where it would identify the app).

### 3. The accent purple is underused

purple900 appears in nav selection, links, and tonal text, but primary buttons ("Turn on", "Run all studies", "Save securely", "Get my free Health report") are all darkMain grey. Grey CTAs give gravity but no brand recognition; screens full of grey pills read as generic. Make purple900 (or a slightly brightened step for contrast) the primary button color and keep darkMain for text. If that feels too loud, at minimum give the single most important CTA per screen the accent.

### 4. EB Garamond earns its place on exactly one element

A second typeface is a strong commitment. Today it sets only trait names on result cards. That either makes it the most precious element in the system (good) or an accident (bad), and it is currently closer to accident because nothing else echoes it. Extend it deliberately: report titles, the "Strongest signal" heading, study sheet trait names, the Home "Your results at a glance" header. Or drop it and set card titles in Space Grotesk Bold. Both are defensible; the current single-use middle ground is not.

### 5. Category greens will be misread as "good"

Green pastel marks cardiometabolic, immune, and medication categories, including increased-risk findings inside them. Users will read green as healthy regardless of the stated principle. Either shift cardiometabolic to a neutral hue (the blue family) or add a one-line legend the first time the dashboard appears ("colors group traits by theme, not by good or bad"). The palette harmony itself is fine.

### 6. Outlined card borders are harsher than the system they live in

Border token is 0.09 near-black at 1dp. Against the warm canvas and pastel fills, step cards and report cards get a stark wireframe that fights the softness. Drop outline opacity to ~0.2 (or use monadicGrey) for resting-state cards and keep the dark 2dp outline only for the active step, where it already works as a focus signal.

### 7. Iconography is generic against a custom brand

Nav icons are stock Material outlines (house, bubble, doc, person, dots). Next to Space Grotesk and the custom star they read as placeholder. A consistent stroke-weight custom set, or at least a filled variant of the active icon that matches the star's geometry, would close the gap. Lower priority: Android renders risk direction as text glyphs (▲▼) while iOS uses SF Symbols; unify on icons so weight and alignment match.

### 8. Smaller items

- The status header ("929,696 variants - Saved securely on this device" + Lock data) wraps to two lines with the lock action floating right of the second line. Group them or shorten the string ("929,696 variants - on this device").
- The vault_vault line illustration on the Vault screen is pure black-and-white; a soft tint (purple900 at low opacity over offTone) would integrate it with the pastel system.
- The dashboard category carousel's partial-card bleed at the right edge is the correct scroll cue; keep it, but add 16dp end padding so the last card clears the screen edge when scrolled fully.
- Numbers in lists (ORs, betas, counts) would align better with tabular figures if Space Grotesk's are accessible; the current proportional figures jitter between rows.

## Note on the single-theme decision

VaultTheme hardcodes a light scheme ("light app canvas with dark brand panels") and iOS pins .preferredColorScheme(.light). As a design decision this is coherent and the palette would survive it. The cost is real though: users in system dark mode get a bright app at night for a product they may read in bed (health content). If a dark theme ever lands, the pastel-200/tonal-900 card system inverts badly and needs a designed dark ramp, not an inversion. Deferring is fine; record it as a known, accepted gap.

## Addendum: alignment with the monadicVault app (checked 2026-10-29)

Explorer's design sources (design/vault/) are already synced from Monadic-DNA/Vault at revision 58c9f56, which is current main, so the two apps share the brand by construction. Comparing against the sibling app changed several recommendations above:

- **Buttons stay charcoal.** Vault's "button" token and AccentColor are both darkMain; primary CTAs are dark grey there too. Recommendation 3 (purple buttons) is withdrawn as off-brand.
- **Garamond single-use matches Vault.** EBGaramondRoman-Medium appears only on result card labels there as well. Recommendation 4 is withdrawn; the serif is a deliberate signature, not an accident.
- **Space Grotesk Light body matches Vault**, which uses Light at 17-20pt body sizes. Recommendation 1 stands only as a legibility note, not an alignment issue.
- **Border harshness was a real Android-only bug, now fixed.** The source colors.json specifies border at alpha 0.5 and iOS rendered it correctly, but scripts/sync-vault-design.py dropped the alpha channel when generating VaultColors.kt, so Android drew opaque 0x17 outlines. The generator now emits alpha, and M3 FilterChips (which ignore the theme outline and rendered darkMain) get an explicit soft border via vaultChipBorder(). Verified by pixel sampling: no opaque border pixels remain on cards or chips.
- **Severity color principle already exists.** design/vault/README.md documents "colors indicate subject matter, never severity", which is recommendation 5's principle. The green-category misreading risk remains open as a UX copy question (optional legend), not a design-system gap.
- **Still open from the main list:** brand mark in the top chrome (2), stock nav icons (7), vault illustration tint, status header wrapping, tabular figures (8).

If deeper alignment with Vault's card artwork is ever wanted, its ResultCardView composes a shellContainer image, a category image, and corner decorator glyphs over the 40pt card, a richer treatment than Explorer's flat star. That would be an asset import, not a token change.

**Motion (added same day):** Vault's whimsy lives in its motion, and Explorer now has the two signature pieces. Indeterminate work (reports, chat, commentary, unlock) shows a VaultStarLoader: the four colored star variants (orange, blue, purple, yellow) spin and pulse around the dark star, ported from Vault's StarLoaderView, on both platforms. The locked/welcome hero's brand mark turns once on appear, matching Vault's SplashScreen. The colored star SVGs are imported into design/vault/art with source.json provenance, so both apps render them from the same pipeline. Determinate work (Run all) keeps its progress bar.
