# Explorer Android: UI/UX audit

Date: 2026-10-29
Method: Systematic capture and review of every screen on a Medium Phone emulator (1080x2400, 420dpi) in the post-import state (929,696 variants, 86,859 matches, profile filled). Passes: light mode all screens, dark mode attempt, 1.3x system font scale accessibility pass, plus code review of VaultTheme/VaultColors. Earlier interaction findings (search Enter key, OR labeling) are in docs/pm-feedback-android-deep-dive-2026-10-29.md and not repeated here.

## Overall assessment

The design system is cohesive and above average for an indie Android app: Space Grotesk for UI, EB Garamond for trait names, a restrained purple palette, generous padding, and consistent card shapes (the 40dp rounded result cards look distinctive). The audit found no broken screens. The recurring weaknesses are wayfinding (every screen is titled "Explorer"), clipped content in a few list contexts, ghost controls shown before they are useful, and a few ambiguous interactive affordances.

## What is working (keep)

- Consistent card language: outlined cards for steps and reports, filled pastel cards for results, pill buttons. The result cards with the star mark and Garamond trait names are the strongest visual identity in the app.
- Restraint: one accent color, no gradients, no shadows. The calm look fits a privacy product.
- Tap targets: primary buttons and cards are comfortably above 48dp. CheckRow makes checkbox labels tappable, which is the right pattern.
- Empty states carry instructions ("Search the catalog to discover studies", "Add your DNA file on Home first") instead of blank screens.
- Status line ("929,696 variants - Saved securely on this device") plus Lock action persist across tabs, so the security state is always visible.
- Font scaling: at 1.3x system font the layouts wrap and grow vertically without observed truncation or overlap; scrollable columns absorb the growth.

## Issues by severity

### High

1. **Results screen clipping (both axes).** The "Catalog order" sort chip is cut off at the right screen edge, and the last visible match card is clipped by the bottom navigation bar. The filter row needs horizontal scroll padding or the chip row needs end padding; the list needs bottom content padding equal to the nav bar height. This is the app's core data surface, so the polish bar should be highest here.
2. **No wayfinding: every screen is titled "Explorer".** Home, Chat, Reports, Results, Vault, Settings, and Account all show "Explorer" in the top app bar. The bottom nav active pill is the only location signal, and More sub-screens (Results, Vault, Settings, Account) all highlight "More", so a user deep in Vault has no title telling them where they are. Put the screen name in the top bar.
3. **Ghost pagination on Browse.** Disabled "Previous" and "Next" buttons render before any search runs, nearly invisible against the background. Hide the row until there are results.
4. **Three different "Lock" entry points with three labels.** Top bar "Lock data", Vault screen "Lock" button, You tab "Lock" text button. One concept, three labels, two visual weights. Unify on "Lock data" everywhere and give it the same treatment.

### Medium

5. **Chat input state is muddled.** Before consent, the input field looks fully active while Send is disabled and the consent text says "To start, allow sharing above". The placeholder is vertically centered in a tall multi-line field, which reads as a title rather than a placeholder. Visually gate the input (disabled background) until consent is checked, and top-align the placeholder.
6. **Developer toggle looks both on and off.** On the Settings screen the "Treat this device as Premium" switch shows the thumb left (off position) with a purple track (on color). Verify the Switch uses themed track colors correctly; as rendered, its state is ambiguous.
7. **Settings text field labels clip the border.** "Explorer backend HTTPS origin" and "Model" sit on the outlined field border in a way that visually breaks the top line. Standard Material floating labels notch the border cleanly; check that these are OutlinedTextField with label, not placeholder text overlapping the outline.
8. **Long placeholder labels in the About you form.** "Ancestries (comma separated)", "Countries of ancestral origin (comma separated)" and similar put the instruction inside the label. Move "(comma separated)" into supporting text under the field; the form gets shorter and the labels get scannable.
9. **Engineering details visible in consumer UI.** Chat header shows "Provider: nilAI - gemma-4-26B-A4B-it"; Results shows catalog version "2026-10-23-b2e8138d". Show friendly names ("nilAI", catalog date) and keep raw identifiers in Settings.
10. **"Lock data" affordance.** It renders as plain text with no icon, underline, or button shape, aligned with the second line of the status text. Add a lock icon or make it a TextButton with clear padding so it reads as an action.
11. **Report card tier labels are too faint.** "Free" and "Premium" on report cards are small low-contrast text. Users deciding what to tap should see the tier at a glance; use filled label chips.

### Low

12. **No dark theme (deliberate, but record the tradeoff).** VaultTheme hardcodes lightColorScheme with the comment "Vault deliberately uses a light app canvas with dark brand panels", and the status bar is forced to light icons. Dark mode users get a bright app and no OLED savings. If this is final, note it in the store listing; if not, the palette structure in VaultColors maps cleanly onto a darkColorScheme later.
13. **Vault disclaimer checkbox appears pre-checked.** After accepting the disclaimer on Home, the Vault import section shows the same checkbox already checked (shared state). This is defensible (one acknowledgment), but a fresh viewer of the Vault screen sees a legal checkbox they never ticked. Consider hiding it there once accepted, with the import button simply enabled.
14. **Primary buttons use dark grey, not brand purple.** "Turn on", "Run all studies", and "Save securely" use VaultColors.darkMain. The brand purple only appears in selection highlights and nav. Using purple900 for primary buttons would tie the identity together; if dark is intentional for gravity, keep it, but apply it consistently (it is consistent today).
15. **Vault screen bottom text clips mid-sentence.** The Google Drive sync paragraph is cut by the viewport edge; it scrolls, but the first viewport ends mid-sentence. Tighten spacing above so the cut lands at a paragraph boundary.

## Accessibility notes

- 1.3x font pass: no truncation observed on Home or More; long suggestion chips wrap to multiple lines and push content down, which is acceptable for scrollable screens. Watch the fixed top row ("variants - Lock data") which gets crowded; give it wrap room.
- Decorative images correctly use contentDescription=null; the wordmark has a proper description. Result card star icons are decorative and silent, which is right.
- Risk direction is conveyed by both arrow glyph and text ("Increased"/"Decreased"), not color alone. Good.
- Contrast: main text passes easily. Watch items are the tier labels on report cards (item 11), secondary grey text ("Stronger GWAS evidence" caption), and the ghost pagination (item 3).
- TalkBack order was not deeply tested; the visible-label structure is simple enough that it should track reading order, but the More sub-screen navigation (Back returns to More, not the previous tab) should be verified with TalkBack focus.

## Quick wins (highest polish per effort)

1. Results list: fix chip row clipping and bottom nav content padding. (item 1)
2. Top app bar: show the current screen name instead of "Explorer". (item 2)
3. Browse: hide Previous/Next until results exist. (item 3)
4. Unify the three Lock labels and give the top-bar action a lock icon. (items 4, 10)
5. Replace the catalog git hash with its date and the chat model ID with a friendly provider name. (item 9)
6. Move "(comma separated)" out of form labels into supporting text. (item 8)
