import { CustomCardEntry } from "./const";

/**
 * Register a card with Home Assistant's UI card picker by appending it to the
 * global `window.customCards` array. Safe to call multiple times — duplicate
 * entries (matched by `type`) are skipped.
 */
export function registerCustomCard(entry: CustomCardEntry): void {
  window.customCards = window.customCards || [];
  if (window.customCards.some((c) => c.type === entry.type)) return;
  window.customCards.push(entry);
}
