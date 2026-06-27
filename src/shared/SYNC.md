# Vendored shared module

The look & feel of this collection is kept consistent with
[tedr91/HA-Teds-Cards](https://github.com/tedr91/HA-Teds-Cards) by **vendoring**
(copying) its shared module into this repo. There is no runtime dependency on
`ted-cards.js` — this bundle is fully self-contained.

## Files vendored verbatim from HA-Teds-Cards `src/shared/`

| File | Upstream path | Notes |
| --- | --- | --- |
| `brand-icons.ts` | `src/shared/brand-icons.ts` | Source/brand icon resolver. Verbatim. |
| `brand-icon-svgs.ts` | `src/shared/brand-icon-svgs.ts` | Bundled icon artwork. Verbatim. |
| `register-card.ts` | `src/shared/register-card.ts` | `registerCustomCard()`. Verbatim. |
| `theme.ts` | `src/shared/theme.ts` | `tedStyleTheme`, `brushedOverlay`, `tedCardThemeClass`. **Adapted:** adds the `--ted-style-info/-warning/-screen/-layer` tokens the device cards need. |
| `types.ts` | `src/shared/types.ts` | **Adapted:** adds a `ThemeMode` alias for `TedStyleTheme`. |
| `const.ts` | `src/shared/const.ts` | **Adapted:** version token renamed to `__TEDS_DEVICE_CARDS_VERSION__`. |
| `version-banner.ts` | `src/shared/version-banner.ts` | **Adapted:** banner label `TED-DEVICE-CARDS`. |
| `../svg-shim.d.ts` | `src/svg-shim.d.ts` | Verbatim. |

## Re-syncing

When the upstream shared module changes, re-copy the verbatim files and
re-apply the small adaptations listed above. Keep token names and the extra
theme tokens intact so both device cards keep building.
