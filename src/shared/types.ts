import { ActionConfig, HomeAssistant, LovelaceCard, LovelaceCardConfig, LovelaceCardEditor } from "custom-card-helpers";

/** Visual styling mode shared by all cards: `ted-style` = self-contained look; `ha` = follow HA theme. */
export type TedStyleTheme = "ted-style" | "ha";

/** Alias for {@link TedStyleTheme}, used by the device cards ported into this collection. */
export type ThemeMode = TedStyleTheme;

/** Common shape every card in this collection extends. */
export interface BaseCardConfig extends LovelaceCardConfig {
  entity: string;
  name?: string;
  icon?: string;
  tap_action?: ActionConfig;
  hold_action?: ActionConfig;
  double_tap_action?: ActionConfig;
}

/** A card element that accepts a `hass` property (set by HA at runtime). */
export interface HassCardElement extends LovelaceCard {
  hass?: HomeAssistant;
}

export type { HomeAssistant, LovelaceCard, LovelaceCardEditor };
