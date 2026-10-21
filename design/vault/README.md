# Vault visual system for Explorer

Source: [Monadic-DNA/Vault](https://github.com/Monadic-DNA/Vault/tree/58c9f56f8be5b091dddd002d0e422d2a96f3a931/ios/monadicVault/monadicVault), revision `58c9f56f8be5b091dddd002d0e422d2a96f3a931`.

The native Explorer apps reuse Vault's original geometric brand mark, wordmark, vault, discovery cards and star SVGs, Space Grotesk and EB Garamond fonts, and color assets. `source.json` records each original asset path and checksum. Font licenses are included under `fonts/` (SIL Open Font License 1.1). The artwork remains Monadic DNA branding.

Both apps follow Vault's light canvas, charcoal brand panels and buttons, rounded capsules, 40-point result cards, Space Grotesk body/headings and Garamond trait titles. Raw color definitions preserve Vault's Display P3/sRGB color spaces and appearance variants. Like Vault, the app uses a light appearance with dark branded panels. Font sizes scale with the device's accessibility settings. Decorative art is hidden from screen readers; the wordmark has a spoken label.

Trait classification still comes from `explorer-core` (`preview_category`). Health-related results use Vault's green palette, sleep/energy yellow, body composition blue, and other findings purple. Colors indicate subject matter, never severity or medical advice. No artwork implies a result that the shared core has not calculated.

Run `python3 scripts/sync-vault-design.py` from any directory after updating the canonical files here (requires Inkscape). It regenerates Android colors, fonts and PNG resources and iOS asset catalogs and fonts. PNGs are rendered directly from the untouched SVG originals at 1,000 pixels wide to support both native asset pipelines without SVG runtime dependencies. Commit the generated resources so application builds require neither Inkscape nor the Vault checkout.
