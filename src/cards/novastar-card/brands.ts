import { BRAND_ART, type BrandArt } from "./brands.art";
import type { LogoVariant } from "./types";

// Built-in brand logos ship as inline monochrome SVG (see brands.art.ts, traced
// from the PNGs in brands/). They render instantly with no Home Assistant file
// setup and recolor themselves to the card text color via `currentColor`.
//
// A user-uploaded "Custom" brand instead stores a single image in Home
// Assistant's image store (via the editor uploader) and renders it as an <img>.
export const CUSTOM_BRAND_ID = "custom";

// Editor dropdown options for the logo variant.
export const LOGO_VARIANT_OPTIONS: Array<{ value: LogoVariant; label: string }> = [
  { value: "mark", label: "Logo only" },
  { value: "stacked", label: "Logo with name below" },
  { value: "horizontal", label: "Logo with name to the right" }
];

export const DEFAULT_LOGO_VARIANT: LogoVariant = "mark";

export type BrandDef = {
  id: string;
  label: string;
};

// Known microLED video-wall brands compatible with the NovaStar H series.
// Add a brand here and drop matching PNGs into `brands/<id>/`, then re-run
// `node scripts/trace-logos.mjs` to generate its inline SVG art.
export const BRANDS: BrandDef[] = [
  { id: "awall", label: "AWALL" },
  { id: "justvideowalls", label: "Just Video Walls" },
  { id: "boe", label: "BOE" },
  { id: "absen", label: "Absen" },
  { id: "unilumin", label: "Unilumin" },
  { id: "roe-visual", label: "ROE Visual" },
  { id: "infiled", label: "INFiLED" },
  { id: "leyard", label: "Leyard" }
];

export function getBrand(id: string | undefined): BrandDef | undefined {
  if (!id) {
    return undefined;
  }
  return BRANDS.find((brand) => brand.id === id);
}

// Inline SVG art for a built-in brand/variant, falling back to the brand's
// default variant. Returns undefined when the brand has no generated art yet.
export function getBrandArt(brandId: string, variant: LogoVariant): BrandArt | undefined {
  const brand = BRAND_ART[brandId];
  if (!brand) {
    return undefined;
  }
  return brand[variant] ?? brand[DEFAULT_LOGO_VARIANT];
}
