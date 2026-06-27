import { LitElement, css, html, nothing } from "lit";

import type { HomeAssistant } from "./ha-types";
import { BRANDS, CUSTOM_BRAND_ID, DEFAULT_LOGO_VARIANT, LOGO_VARIANT_OPTIONS } from "./brands";
import { NOVASTAR_CARD_EDITOR_TYPE } from "./const";
import {
  DEFAULT_SECTION_ORDER,
  DEFAULT_STATUS_ORDER,
  SECTION_DEFS,
  STATUS_ITEM_DEFS,
  orderSections,
  orderStatusItems,
  type NovastarCardConfig,
  type SectionId,
  type StatusItemId
} from "./types";

const NOVASTAR_EDITOR_FIELD_LABELS: Record<string, string> = {
  header: "Name",
  show_name: "Show name",
  brand: "Brand",
  logo_variant: "Logo style",
  logo_scale: "Logo scale",
  display_mode: "Display mode",
  theme: "Theme styling",
  show_header_in_compact: "Show header in Compact mode",
  show_card_version: "Show card version",
  show_presets: "Show presets",
  hide_presets_when_off: "Hide when device is off",
  max_rows: "Max rows (0 = unlimited)",
  show_layout: "Show layout preview",
  preset_order: "Preset order",
  brushed: "Brushed effect",
  screen_color: "Screen color",
  screen_background_color: "Screen background color",
  device_id: "Device",
  power_entity: "Power entity",
  preset_entity: "Preset selection entity",
  screens_entity: "Screens entity",
  layers_entity: "Layers entity",
  controller_entity: "Controller entity",
  status_entity: "Status entity",
  brightness_entity: "Brightness entity",
  temperature_entity: "Temperature entity"
};

class TedNovastarCardEditor extends LitElement {
  public hass?: HomeAssistant;

  private config: NovastarCardConfig = {
    type: "custom:ted-novastar-card"
  };
  private attemptedAutoDeviceDefault = false;
  private presetOptions: string[] = [];
  private presetOptionsKey?: string;
  private resolvedPresetEntityId?: string;
  private resolvingPresetKey?: string;
  private presetsResetNotice = false;
  private customLogoUploading = false;
  private customLogoError?: string;
  private expandedPanels: Record<string, boolean> = {};

  static properties = {
    hass: { attribute: false },
    config: { attribute: false }
  };

  public setConfig(config: NovastarCardConfig): void {
    const nextConfig: NovastarCardConfig = { ...config };
    nextConfig.type ||= "custom:ted-novastar-card";
    if ((nextConfig.display_mode as string) === "detailed") {
      delete nextConfig.display_mode;
    }
    this.config = nextConfig;
    this.attemptedAutoDeviceDefault = false;
  }

  protected updated(): void {
    void this.ensureDefaultDeviceId();
    void this.ensurePresetOptions();
    this.maybeResetStalePresetOrder();
  }

  protected render() {
    if (!this.hass) {
      return nothing;
    }

    const data: NovastarCardConfig = {
      display_mode: "standard",
      theme: "ted-style",
      brushed: true,
      show_presets: true,
      hide_presets_when_off: true,
      show_layout: true,
      ...this.config
    };
    const sectionOrder = orderSections(this.config.section_order);

    return html`
      <div class="editor">
        <ha-form
          .hass=${this.hass}
          .data=${data}
          .schema=${this.baseSchema()}
          .computeLabel=${this.computeLabel}
          @value-changed=${this.handleFormChanged}
        ></ha-form>

        ${this.renderGroup("appearance", "Appearance", "mdi:palette", false, html`
          ${this.renderInlinePair(
            { name: "header", selector: { text: {} }, value: this.config.header ?? "", placeholder: "Novastar H Series" },
            { name: "show_name", selector: { boolean: {} }, value: this.config.show_name !== false }
          )}
          <ha-form
            .hass=${this.hass}
            .data=${data}
            .schema=${this.brandSchema()}
            .computeLabel=${this.computeLabel}
            @value-changed=${this.handleFormChanged}
          ></ha-form>
          ${this.renderLogoControls(data)}
          <ha-form
            .hass=${this.hass}
            .data=${data}
            .schema=${this.appearanceRestSchema()}
            .computeLabel=${this.computeLabel}
            @value-changed=${this.handleFormChanged}
          ></ha-form>
        `)}

        ${this.renderGroup("status", "Status items", "mdi:gauge", false, this.statusItemsContent())}

        ${this.renderGroup("sections", "Card sections", "mdi:view-dashboard-outline", true, html`
          <ha-sortable handle-selector=".drag-handle" @item-moved=${this._sectionMoved}>
            <div class="section-list">
              ${sectionOrder.map((id) => this.renderSectionRow(id, data))}
            </div>
          </ha-sortable>
        `)}

        ${this.renderGroup("advanced", "Advanced", "mdi:cog", false, html`
          <ha-form
            .hass=${this.hass}
            .data=${data}
            .schema=${this.advancedSchema()}
            .computeLabel=${this.computeLabel}
            @value-changed=${this.handleFormChanged}
          ></ha-form>
        `)}
      </div>
    `;
  }

  // A collapsible top-level group (Appearance / Card sections / Advanced).
  private renderGroup(key: string, title: string, icon: string, defaultExpanded: boolean, content: unknown) {
    return html`
      <ha-expansion-panel
        outlined
        .expanded=${this.isPanelExpanded(key, defaultExpanded)}
        @expanded-changed=${(event: Event) => this.handlePanelToggle(key, event)}
      >
        <div slot="header" class="panel-header">
          <ha-icon icon=${icon}></ha-icon>
          <span>${title}</span>
        </div>
        <div class="panel-content">${content}</div>
      </ha-expansion-panel>
    `;
  }

  // One reorderable section row inside "Card sections".
  private renderSectionRow(id: SectionId, data: NovastarCardConfig) {
    const def = SECTION_DEFS.find((section) => section.id === id);
    const key = `section-${id}`;
    const settings = id === "presets"
      ? this.presetsSectionContent(data)
      : this.layoutSectionContent(data);

    return html`
      <ha-expansion-panel
        outlined
        .expanded=${this.isPanelExpanded(key, false)}
        @expanded-changed=${(event: Event) => this.handlePanelToggle(key, event)}
      >
        <div slot="header" class="section-row-header">
          <div class="drag-handle" @click=${this.stopPropagation} title="Drag to reorder">
            <ha-icon icon="mdi:drag"></ha-icon>
          </div>
          <ha-icon icon=${def?.icon ?? "mdi:tune"}></ha-icon>
          <span class="section-row-title">${def?.label ?? id}</span>
          <ha-switch
            .checked=${this.isSectionShown(id)}
            @click=${this.stopPropagation}
            @change=${(event: Event) => this.handleSectionShowToggle(id, event)}
          ></ha-switch>
        </div>
        <div class="panel-content">${settings}</div>
      </ha-expansion-panel>
    `;
  }

  private statusItemsContent() {
    const statusOrder = orderStatusItems(this.config.status_order);
    return html`
      <ha-sortable handle-selector=".drag-handle" @item-moved=${this._statusMoved}>
        <div class="status-list">
          ${statusOrder.map((id) => this.renderStatusItemRow(id))}
        </div>
      </ha-sortable>
    `;
  }

  // One draggable status-item row: drag handle + label + a show toggle in the header.
  private renderStatusItemRow(id: StatusItemId) {
    const def = STATUS_ITEM_DEFS.find((item) => item.id === id);
    return html`
      <div class="status-item-row">
        <div class="drag-handle" title="Drag to reorder">
          <ha-icon icon="mdi:drag"></ha-icon>
        </div>
        <ha-icon icon=${def?.icon ?? "mdi:tune"}></ha-icon>
        <span class="section-row-title">${def?.label ?? id}</span>
        <ha-switch
          .checked=${this.isStatusShown(id)}
          @change=${(event: Event) => this.handleStatusShowToggle(id, event)}
        ></ha-switch>
      </div>
    `;
  }

  private _statusMoved = (event: CustomEvent): void => {
    event.stopPropagation();
    const { oldIndex, newIndex } = event.detail as { oldIndex: number; newIndex: number };
    const order = orderStatusItems(this.config.status_order);
    if (oldIndex < 0 || oldIndex >= order.length || newIndex < 0 || newIndex >= order.length) {
      return;
    }
    const next = [...order];
    next.splice(newIndex, 0, next.splice(oldIndex, 1)[0]);
    this.commitConfig({ ...this.config, status_order: next });
  };

  // Per-status-item visibility, shown as a switch in the status row header.
  private statusShowKey(id: StatusItemId): "show_status" | "show_temperature" | "show_brightness" {
    if (id === "status") {
      return "show_status";
    }
    if (id === "temperature") {
      return "show_temperature";
    }
    return "show_brightness";
  }

  private isStatusShown(id: StatusItemId): boolean {
    return this.config[this.statusShowKey(id)] !== false;
  }

  private handleStatusShowToggle(id: StatusItemId, event: Event): void {
    const checked = (event.target as { checked?: boolean } | null)?.checked === true;
    this.commitConfig({ ...this.config, [this.statusShowKey(id)]: checked });
  }

  private presetsSectionContent(data: NovastarCardConfig) {
    const schema: Array<Record<string, unknown>> = [];
    if (this.config.show_presets !== false) {
      schema.push({ name: "hide_presets_when_off", selector: { boolean: {} } });
      schema.push({ name: "max_rows", selector: { number: { min: 0, max: 20, step: 1, mode: "box" } } });
    }
    if (this.config.show_presets !== false && this.presetOptions.length > 0) {
      schema.push({
        name: "preset_order",
        selector: {
          select: {
            multiple: true,
            reorder: true,
            options: this.presetOptions.map((preset) => ({ value: preset, label: preset }))
          }
        }
      });
    }
    return html`
      <ha-form
        .hass=${this.hass}
        .data=${data}
        .schema=${schema}
        .computeLabel=${this.computeLabel}
        .computeHelper=${this.computeHelper}
        @value-changed=${this.handleFormChanged}
      ></ha-form>
    `;
  }

  private layoutSectionContent(data: NovastarCardConfig) {
    const schema: Array<Record<string, unknown>> = [];
    if (this.config.show_layout !== false) {
      schema.push({
        name: "",
        type: "grid",
        schema: [
          { name: "screen_color", selector: { ui_color: {} } },
          { name: "screen_background_color", selector: { ui_color: {} } }
        ]
      });
    }
    return html`
      <ha-form
        .hass=${this.hass}
        .data=${data}
        .schema=${schema}
        .computeLabel=${this.computeLabel}
        @value-changed=${this.handleFormChanged}
      ></ha-form>
    `;
  }

  private baseSchema(): Array<Record<string, unknown>> {
    return [
      {
        name: "device_id",
        selector: { device: { filter: { integration: "novastar_h" } } }
      }
    ];
  }

  private brandSchema(): Array<Record<string, unknown>> {
    return [
      {
        name: "brand",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "", label: "None" },
              ...BRANDS.map((brand) => ({ value: brand.id, label: brand.label })),
              { value: CUSTOM_BRAND_ID, label: "Custom (upload…)" }
            ]
          }
        }
      }
    ];
  }

  // A wide field with a compact second control on the same line (ha-form's grid
  // only does equal columns, so this is hand-rendered with the same ha-selector
  // component ha-form uses internally).
  private renderInlinePair(
    left: { name: keyof NovastarCardConfig; selector: Record<string, unknown>; value: unknown; placeholder?: string },
    right: { name: keyof NovastarCardConfig; selector: Record<string, unknown>; value: unknown; className?: string }
  ) {
    return html`
      <div class="field-row">
        <ha-selector
          class="field-grow"
          .hass=${this.hass}
          .selector=${left.selector}
          .label=${this.computeLabel({ name: left.name })}
          .placeholder=${left.placeholder ?? ""}
          .value=${left.value}
          @value-changed=${(event: CustomEvent) => this.handleFieldChanged(left.name, event)}
        ></ha-selector>
        <ha-selector
          class=${right.className ?? "field-toggle"}
          .hass=${this.hass}
          .selector=${right.selector}
          .label=${this.computeLabel({ name: right.name })}
          .value=${right.value}
          @value-changed=${(event: CustomEvent) => this.handleFieldChanged(right.name, event)}
        ></ha-selector>
      </div>
    `;
  }

  // The logo style + scale controls below the brand selector. Built-in brands
  // get the style dropdown with a compact scale box on the same line; the custom
  // brand gets the uploader plus a standalone scale box.
  private renderLogoControls(_data: NovastarCardConfig) {
    const brandId = this.config.brand?.trim() ?? "";
    if (!brandId) {
      return nothing;
    }

    const scaleSelector = {
      number: { min: 25, max: 300, step: 5, mode: "box", unit_of_measurement: "%" }
    };
    const scaleValue = this.config.logo_scale ?? 100;

    if (brandId === CUSTOM_BRAND_ID) {
      return html`
        ${this.renderCustomLogoUploader()}
        <ha-selector
          class="field-scale-full"
          .hass=${this.hass}
          .selector=${scaleSelector}
          .label=${this.computeLabel({ name: "logo_scale" })}
          .value=${scaleValue}
          @value-changed=${(event: CustomEvent) => this.handleFieldChanged("logo_scale", event)}
        ></ha-selector>
      `;
    }

    return this.renderInlinePair(
      {
        name: "logo_variant",
        selector: {
          select: {
            mode: "dropdown",
            options: LOGO_VARIANT_OPTIONS.map((option) => ({ value: option.value, label: option.label }))
          }
        },
        value: this.config.logo_variant ?? DEFAULT_LOGO_VARIANT
      },
      { name: "logo_scale", selector: scaleSelector, value: scaleValue, className: "field-scale" }
    );
  }

  private handleFieldChanged(name: keyof NovastarCardConfig, event: CustomEvent): void {
    event.stopPropagation();
    const value = (event.detail as { value?: unknown }).value;
    this.commitConfig({ ...this.config, [name]: value } as NovastarCardConfig);
  }

  private appearanceRestSchema(): Array<Record<string, unknown>> {
    return [
      {
        name: "display_mode",
        required: true,
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "standard", label: "Standard" },
              { value: "compact", label: "Compact" }
            ]
          }
        }
      },
      {
        name: "theme",
        required: true,
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "ted-style", label: "Ted's Home Theater (default)" },
              { value: "ha", label: "Home Assistant theme" }
            ]
          }
        }
      },
      { name: "brushed", selector: { boolean: {} } }
    ];
  }

  // Hand-rendered uploader (ha-form has no "upload -> URL string" selector).
  // Uploads to Home Assistant's image store and saves the served URL.
  private renderCustomLogoUploader() {
    const url = this.config.custom_logo;
    return html`
      <div class="custom-logo">
        ${url ? html`<img class="custom-logo-preview" src=${url} alt="Custom logo preview" />` : nothing}
        <input
          id="custom-logo-input"
          class="custom-logo-input"
          type="file"
          accept="image/*"
          @change=${this.handleCustomLogoUpload}
        />
        <div class="custom-logo-actions">
          <button
            type="button"
            class="custom-logo-button"
            ?disabled=${this.customLogoUploading}
            @click=${this.openCustomLogoPicker}
          >
            <ha-icon icon="mdi:upload"></ha-icon>
            <span>${this.customLogoUploading ? "Uploading…" : url ? "Replace image" : "Upload image"}</span>
          </button>
          ${url
            ? html`<button type="button" class="custom-logo-button custom-logo-button--text" @click=${this.clearCustomLogo}>
                Remove
              </button>`
            : nothing}
        </div>
        ${this.customLogoError ? html`<div class="custom-logo-error">${this.customLogoError}</div>` : nothing}
        <div class="custom-logo-hint">Uploaded to Home Assistant — shows on all devices.</div>
      </div>
    `;
  }

  private openCustomLogoPicker = (): void => {
    const input = this.shadowRoot?.getElementById("custom-logo-input") as HTMLInputElement | null;
    input?.click();
  };

  private handleCustomLogoUpload = async (event: Event): Promise<void> => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.hass?.fetchWithAuth) {
      return;
    }

    this.customLogoUploading = true;
    this.customLogoError = undefined;
    this.requestUpdate();
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await this.hass.fetchWithAuth("/api/image/upload", { method: "POST", body: formData });
      if (!response.ok) {
        throw new Error(`Upload failed (${response.status})`);
      }
      const data = (await response.json()) as { id?: string };
      if (!data.id) {
        throw new Error("Upload returned no image id");
      }
      this.commitConfig({ ...this.config, brand: CUSTOM_BRAND_ID, custom_logo: `/api/image/serve/${data.id}/original` });
    } catch (err) {
      this.customLogoError = err instanceof Error ? err.message : "Upload failed";
    } finally {
      this.customLogoUploading = false;
      input.value = "";
      this.requestUpdate();
    }
  };

  private clearCustomLogo = (): void => {
    const next = { ...this.config };
    delete next.custom_logo;
    this.commitConfig(next);
  };


  private advancedSchema(): Array<Record<string, unknown>> {
    const displayMode = this.config.display_mode ?? "standard";
    const hasOverride = Boolean(
      this.config.power_entity
      || this.config.preset_entity
      || this.config.screens_entity
      || this.config.layers_entity
      || this.config.controller_entity
      || this.config.status_entity
      || this.config.brightness_entity
      || this.config.temperature_entity
    );

    const schema: Array<Record<string, unknown>> = [];

    if (displayMode === "compact") {
      schema.push({ name: "show_header_in_compact", selector: { boolean: {} } });
    } else {
      schema.push({ name: "show_card_version", selector: { boolean: {} } });
    }

    schema.push({
      name: "",
      type: "expandable",
      title: "Override entities",
      flatten: true,
      expanded: hasOverride,
      schema: [
        { name: "power_entity", selector: { entity: {} } },
        { name: "preset_entity", selector: { entity: {} } },
        { name: "screens_entity", selector: { entity: {} } },
        { name: "layers_entity", selector: { entity: {} } },
        { name: "controller_entity", selector: { entity: {} } },
        { name: "status_entity", selector: { entity: {} } },
        { name: "brightness_entity", selector: { entity: {} } },
        { name: "temperature_entity", selector: { entity: {} } }
      ]
    });

    return schema;
  }

  private computeLabel = (schema: { name: string }): string => {
    return NOVASTAR_EDITOR_FIELD_LABELS[schema.name] ?? schema.name;
  };

  private computeHelper = (schema: { name: string }): string => {
    if (schema.name !== "preset_order") {
      return "";
    }

    if (this.presetOptions.length === 0) {
      return "Select a device to load its presets.";
    }

    const base = "Drag to reorder. Remove a preset to hide it. Clear the field to show every preset again.";
    return this.presetsResetNotice
      ? `Presets changed on the device, so your custom order was reset. ${base}`
      : base;
  };

  private handleFormChanged = (event: CustomEvent<{ value: NovastarCardConfig }>): void => {
    event.stopPropagation();
    this.commitConfig({ ...event.detail.value });
  };

  private stopPropagation = (event: Event): void => {
    event.stopPropagation();
  };

  private isPanelExpanded(key: string, defaultExpanded: boolean): boolean {
    return key in this.expandedPanels ? this.expandedPanels[key] : defaultExpanded;
  }

  private handlePanelToggle(key: string, event: Event): void {
    // Ignore expanded-changed events bubbling up from a nested panel (e.g. a
    // section row inside "Card sections"); only react to this panel's own toggle.
    if (event.target !== event.currentTarget) {
      return;
    }
    const expanded = (event.target as { expanded?: boolean } | null)?.expanded;
    if (typeof expanded === "boolean") {
      this.expandedPanels = { ...this.expandedPanels, [key]: expanded };
    }
  }

  // Per-section visibility (show_presets / show_layout), shown as a switch in the
  // section row header.
  private sectionShowKey(id: SectionId): "show_presets" | "show_layout" {
    return id === "presets" ? "show_presets" : "show_layout";
  }

  private isSectionShown(id: SectionId): boolean {
    return this.config[this.sectionShowKey(id)] !== false;
  }

  private handleSectionShowToggle(id: SectionId, event: Event): void {
    const checked = (event.target as { checked?: boolean } | null)?.checked === true;
    this.commitConfig({ ...this.config, [this.sectionShowKey(id)]: checked });
  }

  private _sectionMoved = (event: CustomEvent): void => {
    event.stopPropagation();
    const { oldIndex, newIndex } = event.detail as { oldIndex: number; newIndex: number };
    const order = orderSections(this.config.section_order);
    if (oldIndex < 0 || oldIndex >= order.length || newIndex < 0 || newIndex >= order.length) {
      return;
    }
    const next = [...order];
    next.splice(newIndex, 0, next.splice(oldIndex, 1)[0]);
    this.commitConfig({ ...this.config, section_order: next });
  };

  // Normalize a candidate config (strip defaults/empties), reconcile the preset
  // order, store it, and notify HA. Shared by every editor form and by the
  // section reorder menu.
  private commitConfig(rawConfig: NovastarCardConfig): void {
    const nextConfig: NovastarCardConfig = { ...rawConfig };
    nextConfig.type = "custom:ted-novastar-card";

    if (nextConfig.display_mode !== "compact") {
      delete nextConfig.display_mode;
    }
    if (nextConfig.theme === "ted-style") {
      delete nextConfig.theme;
    }
    if (nextConfig.show_header_in_compact !== true) {
      delete nextConfig.show_header_in_compact;
    }
    if (nextConfig.show_card_version !== true) {
      delete nextConfig.show_card_version;
    }
    if (nextConfig.show_presets !== false) {
      delete nextConfig.show_presets;
    }
    if (nextConfig.hide_presets_when_off !== false) {
      delete nextConfig.hide_presets_when_off;
    }
    if (nextConfig.show_layout !== false) {
      delete nextConfig.show_layout;
    }
    if (nextConfig.show_status !== false) {
      delete nextConfig.show_status;
    }
    if (nextConfig.show_temperature !== false) {
      delete nextConfig.show_temperature;
    }
    if (nextConfig.show_brightness !== false) {
      delete nextConfig.show_brightness;
    }
    if (typeof nextConfig.max_rows !== "number" || nextConfig.max_rows <= 0) {
      delete nextConfig.max_rows;
    }
    if (nextConfig.brushed !== false) {
      delete nextConfig.brushed;
    }
    if (nextConfig.show_name !== false) {
      delete nextConfig.show_name;
    }

    const brandId = typeof nextConfig.brand === "string" ? nextConfig.brand.trim() : "";
    if (!brandId) {
      // No brand selected: drop the brand and its dependent options.
      delete nextConfig.brand;
      delete nextConfig.logo_variant;
      delete nextConfig.logo_scale;
      delete nextConfig.show_brand_logo;
      delete nextConfig.custom_logo;
    } else if (brandId === CUSTOM_BRAND_ID) {
      // Custom uploaded image: a single image, so variants don't apply.
      nextConfig.brand = brandId;
      delete nextConfig.logo_variant;
      delete nextConfig.show_brand_logo;
      if (typeof nextConfig.custom_logo !== "string" || !nextConfig.custom_logo.trim()) {
        delete nextConfig.custom_logo;
      }
    } else {
      nextConfig.brand = brandId;
      delete nextConfig.custom_logo; // only used by the custom brand
      delete nextConfig.show_brand_logo;
      if (nextConfig.logo_variant === DEFAULT_LOGO_VARIANT || !nextConfig.logo_variant) {
        delete nextConfig.logo_variant;
      }
    }

    // Logo scale: strip the default (100%) and any invalid value.
    const scale = Number(nextConfig.logo_scale);
    if (!brandId || !Number.isFinite(scale) || scale === 100) {
      delete nextConfig.logo_scale;
    } else {
      nextConfig.logo_scale = scale;
    }
    if (
      !Array.isArray(nextConfig.section_order)
      || this.listSequenceEqual(orderSections(nextConfig.section_order), DEFAULT_SECTION_ORDER)
    ) {
      delete nextConfig.section_order;
    }
    if (
      !Array.isArray(nextConfig.status_order)
      || this.listSequenceEqual(orderStatusItems(nextConfig.status_order), DEFAULT_STATUS_ORDER)
    ) {
      delete nextConfig.status_order;
    }

    this.reconcilePresetOrder(nextConfig);

    const optionalKeys: Array<keyof NovastarCardConfig> = [
      "header",
      "device_id",
      "power_entity",
      "preset_entity",
      "screens_entity",
      "layers_entity",
      "controller_entity",
      "status_entity",
      "brightness_entity",
      "temperature_entity"
    ];
    for (const key of optionalKeys) {
      const value = nextConfig[key];
      if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
        delete nextConfig[key];
      }
    }

    this.config = nextConfig;
    this.requestUpdate();
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: nextConfig },
        bubbles: true,
        composed: true
      })
    );
  }

  private reconcilePresetOrder(nextConfig: NovastarCardConfig): void {
    if (this.presetOptions.length === 0) {
      // Device presets aren't loaded yet — preserve any existing config untouched.
      if (Array.isArray(this.config.preset_order) && this.config.preset_order.length > 0) {
        nextConfig.preset_order = this.config.preset_order;
        if (Array.isArray(this.config.preset_baseline) && this.config.preset_baseline.length > 0) {
          nextConfig.preset_baseline = this.config.preset_baseline;
        } else {
          delete nextConfig.preset_baseline;
        }
      } else {
        delete nextConfig.preset_order;
        delete nextConfig.preset_baseline;
      }
      return;
    }

    const normalized = this.normalizePresetOrder(nextConfig.preset_order);
    if (normalized.length === 0 || this.listSequenceEqual(normalized, this.presetOptions)) {
      // Empty (show all) or identical to device order — store nothing.
      delete nextConfig.preset_order;
      delete nextConfig.preset_baseline;
    } else {
      nextConfig.preset_order = normalized;
      nextConfig.preset_baseline = [...this.presetOptions];
    }
    this.presetsResetNotice = false;
  }

  private normalizePresetOrder(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const result: string[] = [];
    const used = new Set<string>();
    for (const item of value) {
      if (typeof item !== "string") {
        continue;
      }

      const normalizedItem = item.trim().toLowerCase();
      const match = this.presetOptions.find((option) => option.trim().toLowerCase() === normalizedItem);
      if (!match) {
        continue;
      }

      const key = match.toLowerCase();
      if (used.has(key)) {
        continue;
      }

      used.add(key);
      result.push(match);
    }

    return result;
  }

  private async ensurePresetOptions(): Promise<void> {
    if (!this.hass) {
      return;
    }

    const override = this.config.preset_entity?.trim() ?? "";
    const deviceId = this.config.device_id?.trim() ?? "";
    const key = `${override}|${deviceId}`;

    if (key !== this.presetOptionsKey) {
      this.presetOptionsKey = key;
      this.resolvedPresetEntityId = override || undefined;

      if (!override && deviceId && this.hass.callWS && this.resolvingPresetKey !== key) {
        this.resolvingPresetKey = key;
        try {
          const registry = await this.hass.callWS({ type: "config/entity_registry/list" });
          if (this.presetOptionsKey === key && Array.isArray(registry)) {
            const entityIds = registry
              .filter((entry) => {
                if (!entry || typeof entry !== "object") {
                  return false;
                }

                const item = entry as Record<string, unknown>;
                return item.device_id === deviceId
                  && !item.disabled_by
                  && !item.hidden_by
                  && typeof item.entity_id === "string";
              })
              .map((entry) => (entry as Record<string, unknown>).entity_id as string);

            this.resolvedPresetEntityId = entityIds.find((id) => /_preset$/.test(id))
              ?? entityIds.find((id) => id.startsWith("select."));
          }
        } catch {
        } finally {
          if (this.resolvingPresetKey === key) {
            this.resolvingPresetKey = undefined;
          }
        }
      }
    }

    const entityId = this.resolvedPresetEntityId;
    const stateObj = entityId ? this.hass.states[entityId] : undefined;
    const rawOptions = stateObj?.attributes?.options;
    const options = Array.isArray(rawOptions)
      ? rawOptions.filter((item): item is string => typeof item === "string")
      : [];

    if (!this.listSequenceEqual(options, this.presetOptions)) {
      this.presetOptions = options;
      this.requestUpdate();
    }
  }

  private maybeResetStalePresetOrder(): void {
    if (this.presetOptions.length === 0) {
      return;
    }

    const order = this.config.preset_order;
    const baseline = this.config.preset_baseline;
    if (!Array.isArray(order) || order.length === 0) {
      return;
    }
    if (!Array.isArray(baseline) || baseline.length === 0) {
      return;
    }
    if (this.nameSetEqual(baseline, this.presetOptions)) {
      return;
    }

    const nextConfig: NovastarCardConfig = { ...this.config, type: "custom:ted-novastar-card" };
    delete nextConfig.preset_order;
    delete nextConfig.preset_baseline;
    this.config = nextConfig;
    this.presetsResetNotice = true;
    this.requestUpdate();
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: nextConfig },
        bubbles: true,
        composed: true
      })
    );
  }

  private listSequenceEqual(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }

  private nameSetEqual(left: string[], right: string[]): boolean {
    if (left.length !== right.length) {
      return false;
    }

    const normalize = (list: string[]): string[] =>
      list.map((item) => item.trim().toLowerCase()).sort();
    const normalizedLeft = normalize(left);
    const normalizedRight = normalize(right);
    return normalizedLeft.every((value, index) => value === normalizedRight[index]);
  }

  private async ensureDefaultDeviceId(): Promise<void> {
    if (this.attemptedAutoDeviceDefault || !this.hass?.callWS) {
      return;
    }

    if (this.config.device_id?.trim()) {
      this.attemptedAutoDeviceDefault = true;
      return;
    }

    this.attemptedAutoDeviceDefault = true;

    try {
      const registry = await this.hass.callWS({ type: "config/entity_registry/list" });
      if (!Array.isArray(registry)) {
        return;
      }

      const firstNovastarDeviceId = registry
        .filter((entry) => {
          if (!entry || typeof entry !== "object") {
            return false;
          }

          const item = entry as Record<string, unknown>;
          return item.platform === "novastar_h"
            && typeof item.device_id === "string"
            && !item.disabled_by
            && !item.hidden_by;
        })
        .map((entry) => (entry as Record<string, unknown>).device_id as string)[0];

      if (!firstNovastarDeviceId) {
        return;
      }

      const nextConfig: NovastarCardConfig = {
        ...this.config,
        type: "custom:ted-novastar-card",
        device_id: firstNovastarDeviceId
      };
      this.config = nextConfig;
      this.requestUpdate();
      this.dispatchEvent(
        new CustomEvent("config-changed", {
          detail: { config: nextConfig },
          bubbles: true,
          composed: true
        })
      );
    } catch {
    }
  }

  static styles = css`
    .editor {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    ha-form {
      display: block;
    }

    ha-expansion-panel {
      --expansion-panel-content-padding: 0;
      border-radius: 6px;
    }

    .panel-header {
      align-items: center;
      display: flex;
      font-weight: 500;
      gap: 10px;
    }

    .panel-header ha-icon {
      color: var(--secondary-text-color);
    }

    .panel-content {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 12px 16px 16px;
    }

    .section-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .section-row-header {
      align-items: center;
      display: flex;
      gap: 10px;
      width: 100%;
    }

    .section-row-header ha-icon {
      color: var(--secondary-text-color);
      flex: none;
    }

    .section-row-header ha-switch {
      flex: none;
    }

    .section-row-title {
      flex: 1 1 auto;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .section-row-header .drag-handle {
      align-items: center;
      color: var(--secondary-text-color);
      cursor: grab;
      display: flex;
      flex: none;
      margin: -6px 2px -6px -6px;
      padding: 6px 2px;
      touch-action: none;
    }

    .section-row-header .drag-handle ha-icon {
      pointer-events: none;
    }

    .status-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .status-item-row {
      align-items: center;
      border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.3));
      border-radius: 6px;
      display: flex;
      gap: 10px;
      padding: 8px 12px;
      width: 100%;
    }

    .status-item-row > ha-icon {
      color: var(--secondary-text-color);
      flex: none;
    }

    .status-item-row ha-switch {
      flex: none;
    }

    .status-item-row .drag-handle {
      align-items: center;
      color: var(--secondary-text-color);
      cursor: grab;
      display: flex;
      flex: none;
      margin: -4px 0;
      padding: 4px 2px;
      touch-action: none;
    }

    .status-item-row .drag-handle ha-icon {
      pointer-events: none;
    }

    .field-row {
      align-items: center;
      display: flex;
      gap: 16px;
    }

    .field-grow {
      flex: 1 1 auto;
      min-width: 0;
    }

    .field-toggle {
      flex: 0 0 auto;
    }

    .field-scale {
      flex: 0 0 auto;
      width: 110px;
    }

    .field-scale-full {
      display: block;
    }

    .custom-logo {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .custom-logo-input {
      display: none;
    }

    .custom-logo-preview {
      align-self: flex-start;
      background: var(--secondary-background-color);
      border-radius: 6px;
      max-height: 64px;
      padding: 4px;
      width: auto;
    }

    .custom-logo-actions {
      align-items: center;
      display: flex;
      gap: 8px;
    }

    .custom-logo-button {
      align-items: center;
      background: var(--primary-color);
      border: none;
      border-radius: 6px;
      color: var(--text-primary-color, #fff);
      cursor: pointer;
      display: inline-flex;
      font: inherit;
      gap: 6px;
      padding: 8px 12px;
    }

    .custom-logo-button[disabled] {
      cursor: default;
      opacity: 0.6;
    }

    .custom-logo-button--text {
      background: none;
      color: var(--primary-color);
      padding: 8px 4px;
    }

    .custom-logo-error {
      color: var(--error-color, #db4437);
      font-size: 0.85rem;
    }

    .custom-logo-hint {
      color: var(--secondary-text-color);
      font-size: 0.8rem;
    }
  `;
}


try {
  customElements.define(NOVASTAR_CARD_EDITOR_TYPE, TedNovastarCardEditor);
} catch {
}
