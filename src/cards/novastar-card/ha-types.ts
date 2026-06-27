/**
 * Minimal Home Assistant shapes used by the Ted NovaStar H Card.
 *
 * Kept dependency-free and card-local so the NovaStar card stays self-contained
 * (matching how it was authored upstream), independent of the
 * `custom-card-helpers` types the rest of the collection uses.
 */

export type HassEntity = {
  state: string;
  attributes: Record<string, unknown>;
};

export type HomeAssistant = {
  states: Record<string, HassEntity>;
  callService?: (domain: string, service: string, serviceData?: Record<string, unknown>) => Promise<void>;
  callWS?: (message: Record<string, unknown>) => Promise<unknown>;
  fetchWithAuth?: (path: string, init?: RequestInit) => Promise<Response>;
};

/** Visual styling mode: `ted-style` = self-contained look; `ha` = follow HA theme. */
export type ThemeMode = "ted-style" | "ha";
