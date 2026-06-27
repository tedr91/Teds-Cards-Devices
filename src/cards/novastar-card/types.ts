import type { HassEntity, ThemeMode } from "./ha-types";

export type DisplayMode = "standard" | "compact";

// Brand logo layout variants. Each maps to a file base name on the HA server
// (see brands.ts). `mark` = logo only, `stacked` = logo with the brand name
// below it, `horizontal` = logo with the brand name to its right.
export type LogoVariant = "mark" | "stacked" | "horizontal";

export type NovastarCardConfig = {
  type: string;
  header?: string;
  show_name?: boolean;
  brand?: string;
  logo_variant?: LogoVariant;
  logo_scale?: number;
  custom_logo?: string;
  show_brand_logo?: boolean;
  display_mode?: DisplayMode;
  theme?: ThemeMode;
  brushed?: boolean;
  show_header_in_compact?: boolean;
  show_card_version?: boolean;
  show_presets?: boolean;
  hide_presets_when_off?: boolean;
  show_layout?: boolean;
  section_order?: string[];
  status_order?: string[];
  show_status?: boolean;
  show_temperature?: boolean;
  show_brightness?: boolean;
  preset_order?: string[];
  preset_baseline?: string[];
  max_rows?: number;
  screen_color?: string;
  screen_background_color?: string;
  debug_layout?: boolean;
  device_id?: string;
  power_entity?: string;
  preset_entity?: string;
  screens_entity?: string;
  layers_entity?: string;
  controller_entity?: string;
  status_entity?: string;
  brightness_entity?: string;
  temperature_entity?: string;
};

export type ResolvedEntityMap = {
  power_entity?: string;
  preset_entity?: string;
  screens_entity?: string;
  layers_entity?: string;
  controller_entity?: string;
  status_entity?: string;
  brightness_entity?: string;
  temperature_entity?: string;
};

export type LayoutLayer = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  source?: string;
  audioOpen?: boolean;
};

export type LayoutPayload = {
  screenWidth: number;
  screenHeight: number;
  layers: LayoutLayer[];
};

export type ViewLayer = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  source?: string;
  audioOpen?: boolean;
};

export type LayerSourceRow = {
  entityId: string;
  entity: HassEntity;
  layerNumber: number;
  options: string[];
};

export type LayerSourceChooser = {
  entityId: string;
  layerNumber: number;
  options: string[];
  selectedOption: string;
};

// The card's reorderable content sections. The order shown here is the default;
// the user can rearrange them in the editor (persisted as `section_order`), and
// the card renders them in that order.
export type SectionId = "presets" | "layout";

export const SECTION_DEFS: Array<{ id: SectionId; label: string; icon: string }> = [
  { id: "presets", label: "Presets", icon: "mdi:view-grid" },
  { id: "layout", label: "Layout preview", icon: "mdi:monitor-dashboard" }
];

export const DEFAULT_SECTION_ORDER: SectionId[] = SECTION_DEFS.map((section) => section.id);

// Normalize a configured section order to always contain every known section
// exactly once: keep configured ids that are valid, then append any missing in
// their default order. Guarantees no section is ever dropped.
export function orderSections(configured: string[] | undefined): SectionId[] {
  const result: SectionId[] = [];
  const seen = new Set<string>();
  if (Array.isArray(configured)) {
    for (const id of configured) {
      if (DEFAULT_SECTION_ORDER.includes(id as SectionId) && !seen.has(id)) {
        result.push(id as SectionId);
        seen.add(id);
      }
    }
  }
  for (const id of DEFAULT_SECTION_ORDER) {
    if (!seen.has(id)) {
      result.push(id);
    }
  }
  return result;
}

// The header status items, in default order. Each is a small indicator the user
// can hide or reorder via the editor's "Status items" section.
export type StatusItemId = "status" | "temperature" | "brightness";

export const STATUS_ITEM_DEFS: Array<{ id: StatusItemId; label: string; icon: string }> = [
  { id: "status", label: "Status", icon: "mdi:lan-connect" },
  { id: "temperature", label: "Temperature", icon: "mdi:thermometer" },
  { id: "brightness", label: "Brightness", icon: "mdi:brightness-6" }
];

export const DEFAULT_STATUS_ORDER: StatusItemId[] = STATUS_ITEM_DEFS.map((item) => item.id);

// Same normalization as orderSections, for the header status items.
export function orderStatusItems(configured: string[] | undefined): StatusItemId[] {
  const result: StatusItemId[] = [];
  const seen = new Set<string>();
  if (Array.isArray(configured)) {
    for (const id of configured) {
      if (DEFAULT_STATUS_ORDER.includes(id as StatusItemId) && !seen.has(id)) {
        result.push(id as StatusItemId);
        seen.add(id);
      }
    }
  }
  for (const id of DEFAULT_STATUS_ORDER) {
    if (!seen.has(id)) {
      result.push(id);
    }
  }
  return result;
}
