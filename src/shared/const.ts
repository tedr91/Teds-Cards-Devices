/**
 * Global constants shared across all cards in this collection.
 *
 * NAMESPACE is the prefix for every custom element registered by this package
 * (e.g. NAMESPACE = "ted" produces `ted-light-card`, `ted-light-card-editor`).
 */
import type { HomeAssistant, LovelaceCardConfig } from "custom-card-helpers";

export const NAMESPACE = "ted";

// Replaced at build time by @rollup/plugin-replace from package.json#version.
declare const __TEDS_DEVICE_CARDS_VERSION__: string;
export const VERSION: string = __TEDS_DEVICE_CARDS_VERSION__;

/** A card config suggested for a specific entity in the picker's "By entity" tab. */
export interface CustomCardSuggestion {
  label?: string;
  config: LovelaceCardConfig;
}

/** Entry on `window.customCards` — surfaces a card in the UI card picker. */
export interface CustomCardEntry {
  type: string;
  name: string;
  description: string;
  preview?: boolean;
  documentationURL?: string;
  /**
   * Suggest this card (pre-filled config) for a given entity in the picker's
   * "By entity" tab. Return `null` to skip the card for that entity.
   */
  getEntitySuggestion?: (
    hass: HomeAssistant,
    entityId: string,
  ) => CustomCardSuggestion | CustomCardSuggestion[] | null;
}

declare global {
  interface Window {
    customCards?: CustomCardEntry[];
  }
}
