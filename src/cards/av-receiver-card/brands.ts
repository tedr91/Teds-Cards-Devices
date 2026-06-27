import { MONO_SVGS, type MonoSvg } from "../../shared/brand-icon-svgs";

// Built-in brand logos reuse the card's existing monochrome inline SVG art (see
// source-icon-svgs.ts). They render instantly with no Home Assistant file setup
// and recolor themselves to the card text color via `currentColor`.
//
// A user-uploaded "Custom" brand instead stores a single image in Home
// Assistant's image store (via the editor uploader) and renders it as an <img>.
export const CUSTOM_BRAND_ID = "custom";

export type BrandDef = {
  id: string;
  label: string;
};

// AVR brands handled by the Denon/Marantz integration. Each id maps to a
// monochrome entry in MONO_SVGS.
export const BRANDS: BrandDef[] = [
  { id: "denon", label: "Denon" },
  { id: "marantz", label: "Marantz" }
];

export function getBrand(id: string | undefined): BrandDef | undefined {
  if (!id) {
    return undefined;
  }
  return BRANDS.find((brand) => brand.id === id);
}

// Inline monochrome SVG art for a built-in brand, taken from the card's shared
// icon set. Returns undefined when the brand has no monochrome art.
export function getBrandArt(brandId: string): MonoSvg | undefined {
  const art = MONO_SVGS[brandId];
  if (art && "paths" in art) {
    return art;
  }
  return undefined;
}
