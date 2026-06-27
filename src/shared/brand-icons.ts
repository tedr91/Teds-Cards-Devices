// Source-button icon lookup.
//
// Icons are resolved with a bundled-first strategy so the card can show a
// high-quality, theme-aware glyph for every source it knows about:
//   1. The card's own bundled SVG artwork (see brand-icon-svgs.ts) — a colour
//      version for `color` mode and a monochrome version for `monochrome` mode.
//   2. Custom Brand Icons (https://github.com/elax46/custom-brand-icons) via the
//      `phu:` iconset, when the user has that optional HACS frontend module.
//   3. Built-in Material Design Icons (`mdi:`) that ship with Home Assistant.
// Anything that matches no keyword falls back to a generic input glyph.

import {
  COLOR_SVGS,
  DEFAULT_VIEW_BOX,
  isRawSvg,
  MONO_SVGS,
  type MonoSvg,
  type SourceIconFacet
} from "./brand-icon-svgs";

export type { SourceIconFacet } from "./brand-icon-svgs";

export type SourceIconMode = "color" | "monochrome" | "off";

export type SourceIcon = {
  id: string;
  /** Lower-cased substrings or regexes matched against the source label. */
  match: Array<string | RegExp>;
  /** Custom Brand Icons name (without the `phu:` prefix). */
  cbi?: string;
  /** Full Material Design Icons name, e.g. `mdi:netflix`. */
  mdi?: string;
  /** Official brand colour, applied as a tint in `color` mode for icon-set glyphs. */
  color?: string;
  /**
   * How to derive a monochrome glyph from the bundled colour SVG when no
   * dedicated monochrome SVG exists. `dither` halftones the colours by luminance
   * (good for multi-colour mosaics); `flatten` paints every facet in currentColor.
   */
  monoFromColor?: "flatten" | "dither";
};

export type ResolvedIconRef =
  | { kind: "name"; name: string; tint?: string }
  | {
      kind: "svg";
      facets: SourceIconFacet[];
      viewBox: string;
      render: "color" | "flat" | "dither";
      tint?: string;
    }
  | { kind: "rawsvg"; raw: string; viewBox: string; tint?: string };

export const FALLBACK_SOURCE_ICON: SourceIcon = {
  id: "fallback",
  match: [],
  mdi: "mdi:video-input-hdmi"
};

const PLACEHOLDER_ICON = FALLBACK_SOURCE_ICON.mdi ?? "mdi:video-input-hdmi";

// Ordered most-specific first: the first entry whose keyword matches wins, so
// brand entries must precede the generic category entries they could overlap.
export const SOURCE_ICONS: SourceIcon[] = [
  { id: "airplay", match: ["airplay", "air play"], mdi: "mdi:apple-airplay" },
  { id: "apple-tv", match: ["apple tv", "appletv"], cbi: "apple-tv", mdi: "mdi:apple" },
  { id: "apple", match: [/\bapple\b/, "macintosh", "macos", /\bmac\b/], mdi: "mdi:apple" },
  { id: "kaleidescape", match: ["kaleidescape", "kscape", "k-scape"], monoFromColor: "dither" },
  { id: "roku", match: ["roku"], cbi: "roku-ultra", color: "#7B2FB5" },
  { id: "heos", match: ["heos"], cbi: "heos" },
  { id: "denon", match: ["denon"], cbi: "denon", mdi: "mdi:audio-video" },
  { id: "marantz", match: ["marantz"], mdi: "mdi:audio-video" },
  { id: "firetv", match: ["fire tv", "firetv", "fire stick", "firestick", "fire"], cbi: "firetv", mdi: "mdi:amazon" },
  { id: "amazon", match: ["prime video", "prime", "amazon"], cbi: "prime-video", mdi: "mdi:amazon", color: "#FF9900" },
  { id: "nvidia", match: ["nvidia", "shield"], cbi: "nvidia-shield", color: "#76B900" },
  { id: "plex", match: ["plex"], cbi: "plex", mdi: "mdi:plex", color: "#E5A00D" },
  { id: "netflix", match: ["netflix"], cbi: "netflix", mdi: "mdi:netflix", color: "#E50914" },
  { id: "spotify", match: ["spotify"], cbi: "spotify", mdi: "mdi:spotify", color: "#1DB954" },
  { id: "youtube", match: ["youtube"], cbi: "youtube", mdi: "mdi:youtube", color: "#FF0000" },
  { id: "pandora", match: ["pandora"], mdi: "mdi:pandora", color: "#224099" },
  { id: "tidal", match: ["tidal"], cbi: "tidal-logo" },
  { id: "sonos", match: ["sonos"], cbi: "sonos", mdi: "mdi:speaker" },
  { id: "cast", match: ["chromecast", "google cast", "cast"], cbi: "chromecast", mdi: "mdi:cast" },
  { id: "xbox", match: ["xbox"], cbi: "xbox", mdi: "mdi:microsoft-xbox", color: "#107C10" },
  { id: "nintendo", match: ["nintendo", "switch", "nintendo switch"], cbi: "nintendo-switch-logo", mdi: "mdi:nintendo-switch", color: "#E60012" },
  { id: "steam", match: ["steam", "steamdeck", "steam deck"], cbi: "steam", mdi: "mdi:steam" },
  { id: "microsoft", match: ["microsoft", "windows", /\bwin\b/, /\bms\b/], mdi: "mdi:microsoft" },
  { id: "playstation", match: ["playstation", "ps5", "ps4", "ps3", /\bps\b/], cbi: "playstation", mdi: "mdi:sony-playstation", color: "#0070D1" },
  { id: "game", match: ["game", "gaming"], mdi: "mdi:gamepad-variant" },
  { id: "bluray", match: ["blu-ray", "bluray", "blu ray"], cbi: "bluray", mdi: "mdi:disc-player" },
  { id: "dvd", match: ["dvd"], cbi: "dvd", mdi: "mdi:disc-player" },
  { id: "disc", match: ["sacd", "disc", "cd"], mdi: "mdi:disc-player" },
  { id: "satellite", match: ["satellite", "cable", "cbl"], mdi: "mdi:satellite-variant" },
  { id: "bluetooth", match: ["bluetooth"], mdi: "mdi:bluetooth" },
  { id: "tuner", match: ["tuner", "radio", "siriusxm", "sirius", "dab"], mdi: "mdi:radio" },
  { id: "phono", match: ["phono", "turntable", "vinyl"], mdi: "mdi:record-player" },
  { id: "usb", match: ["usb"], mdi: "mdi:usb" },
  { id: "aux", match: ["aux", "analog", "analogue"], mdi: "mdi:audio-input-rca" },
  { id: "media", match: ["media player", "media server", "dlna", "upnp"], mdi: "mdi:cast" },
  { id: "tv", match: ["tv audio", "television", "tv"], mdi: "mdi:television" }
];

/** True when the optional Custom Brand Icons (`phu:`) iconset is registered. */
export function isCbiAvailable(): boolean {
  try {
    const iconsets = (window as unknown as {
      customIconsets?: Record<string, unknown>;
    }).customIconsets;
    return typeof iconsets?.phu === "function";
  } catch {
    return false;
  }
}

/** Find the icon definition for a source label, or the generic fallback. */
export function resolveSourceIcon(label: string): SourceIcon {
  const normalized = (label ?? "").trim().toLowerCase();
  if (normalized) {
    for (const icon of SOURCE_ICONS) {
      for (const matcher of icon.match) {
        const matched = typeof matcher === "string"
          ? normalized.includes(matcher)
          : matcher.test(normalized);
        if (matched) {
          return icon;
        }
      }
    }
  }
  return FALLBACK_SOURCE_ICON;
}

function monoToFacets(mono: MonoSvg): SourceIconFacet[] {
  return mono.paths.map((d) => ({ d, fill: "currentColor" }));
}

/**
 * Resolve a matched icon to a concrete render reference for the given mode.
 * Bundled card artwork wins; then Custom Brand Icons, Material Design Icons, and
 * finally the generic placeholder glyph.
 */
export function resolveIconRef(icon: SourceIcon, mode: SourceIconMode, cbiAvailable: boolean): ResolvedIconRef {
  const color = COLOR_SVGS[icon.id];
  const mono = MONO_SVGS[icon.id];

  if (mode === "monochrome") {
    if (mono) {
      if (isRawSvg(mono)) {
        return { kind: "rawsvg", raw: mono.raw, viewBox: mono.viewBox ?? DEFAULT_VIEW_BOX };
      }
      return { kind: "svg", facets: monoToFacets(mono), viewBox: mono.viewBox ?? DEFAULT_VIEW_BOX, render: "flat" };
    }
    if (color) {
      if (isRawSvg(color)) {
        return { kind: "rawsvg", raw: color.raw, viewBox: color.viewBox ?? DEFAULT_VIEW_BOX };
      }
      const render = icon.monoFromColor === "flatten" ? "flat" : "dither";
      return { kind: "svg", facets: color.facets, viewBox: color.viewBox ?? DEFAULT_VIEW_BOX, render };
    }
    if (cbiAvailable && icon.cbi) {
      return { kind: "name", name: `phu:${icon.cbi}` };
    }
    if (icon.mdi) {
      return { kind: "name", name: icon.mdi };
    }
    return { kind: "name", name: PLACEHOLDER_ICON };
  }

  // Colour mode.
  if (color) {
    if (isRawSvg(color)) {
      return { kind: "rawsvg", raw: color.raw, viewBox: color.viewBox ?? DEFAULT_VIEW_BOX, tint: color.tint };
    }
    return { kind: "svg", facets: color.facets, viewBox: color.viewBox ?? DEFAULT_VIEW_BOX, render: "color" };
  }
  if (mono) {
    if (isRawSvg(mono)) {
      return { kind: "rawsvg", raw: mono.raw, viewBox: mono.viewBox ?? DEFAULT_VIEW_BOX, tint: icon.color };
    }
    return { kind: "svg", facets: monoToFacets(mono), viewBox: mono.viewBox ?? DEFAULT_VIEW_BOX, render: "flat", tint: icon.color };
  }
  if (cbiAvailable && icon.cbi) {
    return { kind: "name", name: `phu:${icon.cbi}`, tint: icon.color };
  }
  if (icon.mdi) {
    return { kind: "name", name: icon.mdi, tint: icon.color };
  }
  return { kind: "name", name: PLACEHOLDER_ICON };
}
