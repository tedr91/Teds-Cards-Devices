import { LitElement, css, html, nothing, svg } from "lit";

import { CUSTOM_BRAND_ID, DEFAULT_LOGO_VARIANT, getBrandArt } from "./brands";
import { VERSION } from "../../shared/const";
import { registerCustomCard } from "../../shared/register-card";
import { brushedOverlay, tedStyleTheme } from "../../shared/theme";
import type { HassEntity, HomeAssistant, ThemeMode } from "./ha-types";
import {
  NOVASTAR_CARD_DESCRIPTION,
  NOVASTAR_CARD_NAME,
  NOVASTAR_CARD_TYPE
} from "./const";
import {
  orderSections,
  type DisplayMode,
  type LayerSourceChooser,
  type LayerSourceRow,
  type LayoutLayer,
  type LayoutPayload,
  type LogoVariant,
  type NovastarCardConfig,
  type ResolvedEntityMap,
  type SectionId,
  type ViewLayer
} from "./types";

export class TedNovastarCard extends LitElement {
  private static readonly LAYOUT_BUILD_MARKER = VERSION;

  private _hass?: HomeAssistant;

  private config?: NovastarCardConfig;
  private optimisticPowerState?: "on" | "off";
  private resolvedEntities: ResolvedEntityMap = {};
  private resolvedLayerSourceEntities: string[] = [];
  private resolvedDeviceId?: string;
  private resolvingDeviceId?: string;
  private resolvedForHass?: HomeAssistant;
  private lastRelevantStateSignature = "";
  private activeLayerSourceChooser?: LayerSourceChooser;
  private presetChooserOpen = false;
  private presetAnchorRect?: DOMRect;
  private layerAnchorRect?: DOMRect;
  private failedLogoSrcs = new Set<string>();

  static properties = {
    hass: { attribute: false, noAccessor: true },
    config: { attribute: false }
  };

  public get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  public set hass(value: HomeAssistant | undefined) {
    const oldValue = this._hass;
    this._hass = value;

    const nextSignature = this.buildRelevantStateSignature(value);
    const hasRelevantChanges = nextSignature !== this.lastRelevantStateSignature;
    this.lastRelevantStateSignature = nextSignature;

    if (oldValue !== value || hasRelevantChanges) {
      this.requestUpdate("hass", oldValue);
    }
  }

  public setConfig(config: NovastarCardConfig): void {
    const nextConfig: NovastarCardConfig = { ...config };
    nextConfig.type ||= "custom:ted-novastar-card";
    this.config = nextConfig;
  }

  public getCardSize(): number {
    return 3;
  }

  public static async getConfigElement(): Promise<HTMLElement> {
    return document.createElement("ted-novastar-card-editor");
  }

  public static getStubConfig(): NovastarCardConfig {
    return {
      type: "custom:ted-novastar-card",
      header: "Novastar H Series"
    };
  }

  protected updated(): void {
    void this.ensureResolvedEntities();
    this.syncOptimisticPowerState();
    this.syncChooserPopovers();
  }

  private syncChooserPopovers(): void {
    const root = this.renderRoot as ShadowRoot;

    const presetPopover = root.getElementById("ted-preset-popover") as (HTMLElement & { showPopover?: () => void }) | null;
    if (presetPopover && this.presetChooserOpen && !presetPopover.matches(":popover-open")) {
      presetPopover.showPopover?.();
      this.positionChooserPopover(presetPopover, this.presetAnchorRect);
    }

    const layerPopover = root.getElementById("ted-layer-popover") as (HTMLElement & { showPopover?: () => void }) | null;
    if (layerPopover && this.activeLayerSourceChooser && !layerPopover.matches(":popover-open")) {
      layerPopover.showPopover?.();
      this.positionChooserPopover(layerPopover, this.layerAnchorRect);
    }
  }

  private positionChooserPopover(popover: HTMLElement, anchor?: DOMRect): void {
    const margin = 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const rect = popover.getBoundingClientRect();

    popover.style.position = "fixed";
    popover.style.margin = "0";

    if (!anchor) {
      popover.style.left = `${Math.round((viewportWidth - rect.width) / 2)}px`;
      popover.style.top = `${Math.round((viewportHeight - rect.height) / 2)}px`;
      return;
    }

    let left = anchor.right - rect.width;
    left = Math.max(margin, Math.min(left, viewportWidth - rect.width - margin));

    let top = anchor.bottom + margin;
    if (top + rect.height > viewportHeight - margin && anchor.top - margin - rect.height >= margin) {
      top = anchor.top - margin - rect.height;
    }
    top = Math.max(margin, Math.min(top, viewportHeight - rect.height - margin));

    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  }

  protected render() {
    if (!this.config) {
      return html`<ha-card><div class="content">Invalid card configuration.</div></ha-card>`;
    }

    if (!this.hass) {
      return html`<ha-card><div class="content">Home Assistant context is unavailable.</div></ha-card>`;
    }

    const controllerEntityId = this.getEntityId("controller_entity");
    if (!controllerEntityId) {
      const loadingMessage = this.config.device_id && this.resolvingDeviceId === this.config.device_id
        ? "Resolving entities for selected device..."
        : "Set a device_id or controller_entity in card configuration.";
      return html`<ha-card><div class="content">${loadingMessage}</div></ha-card>`;
    }

    const controller = this.hass.states[controllerEntityId];
    if (!controller) {
      return html`<ha-card><div class="content">Entity not found: ${controllerEntityId}</div></ha-card>`;
    }

    const powerEntityId = this.getEntityId("power_entity") ?? "switch.novastar_h2_power_screen_output";
    const presetEntityId = this.getEntityId("preset_entity");
    const screensEntityId = this.getEntityId("screens_entity");
    const layersEntityId = this.getEntityId("layers_entity");
    const statusEntityId = this.getEntityId("status_entity");
    const brightnessEntityId = this.getEntityId("brightness_entity");
    const temperatureEntityId = this.getEntityId("temperature_entity");

    const powerEntity = this.hass.states[powerEntityId];
    const powerState = this.optimisticPowerState ?? powerEntity?.state;
    const powerIsOn = powerState === "on";
    const powerFadeToBlack = Boolean(powerEntity) && !powerIsOn;

    const statusEntity = statusEntityId
      ? this.hass.states[statusEntityId]
      : undefined;
    const presetEntity = presetEntityId
      ? this.hass.states[presetEntityId]
      : undefined;
    const screensEntity = screensEntityId
      ? this.hass.states[screensEntityId]
      : undefined;
    const layersEntity = layersEntityId
      ? this.hass.states[layersEntityId]
      : undefined;
    const brightnessEntity = brightnessEntityId
      ? this.hass.states[brightnessEntityId]
      : undefined;
    const temperatureEntity = temperatureEntityId
      ? this.hass.states[temperatureEntityId]
      : undefined;
    const brightnessValue = brightnessEntity ? Number.parseFloat(brightnessEntity.state) : Number.NaN;
    const brightnessMin = brightnessEntity ? this.readNumberAttribute(brightnessEntity, "min", 0) : 0;
    const brightnessMax = brightnessEntity ? this.readNumberAttribute(brightnessEntity, "max", 100) : 100;
    const brightnessStep = brightnessEntity ? this.readNumberAttribute(brightnessEntity, "step", 1) : 1;
    const showBrightnessSlider = Boolean(brightnessEntity) && Number.isFinite(brightnessValue);
    const brightnessUnit = brightnessEntity
      ? this.readStringAttribute(brightnessEntity, "unit_of_measurement") ?? ""
      : "";
    const presetOptions = this.readStringListAttribute(presetEntity, "options");
    const visiblePresets = this.arrangePresets(presetOptions);
    const selectedPresetOption = presetEntity
      ? this.resolveSelectedOption(presetEntity, presetOptions)
      : "";
    const layoutPayload = this.readLayoutPayload(screensEntity, layersEntity);
    const controllerValue = statusEntity
      ? `${controller.state} (${statusEntity.state})`
      : controller.state;

    const displayMode = this.getDisplayMode();
    const themeMode = this.getThemeMode();
    const isCompact = displayMode === "compact";
    const showHeaderInCompact = this.config.show_header_in_compact === true;
    const showHeader = !isCompact || showHeaderInCompact;
    const bareLayoutMode = isCompact && !showHeaderInCompact;
    const headerText = this.config.header ?? "Novastar H Series";
    const contentClasses = ["content", `content--${displayMode}`, bareLayoutMode ? "content--bare" : ""]
      .filter(Boolean)
      .join(" ");

    const showStatusDot = Boolean(powerEntity);
    const showTempDot = Boolean(temperatureEntity);
    const showBrightnessButton = showBrightnessSlider;
    const showStatusSection = showStatusDot || showTempDot || showBrightnessButton;
    const temperatureSeverity = this.getTemperatureSeverity(temperatureEntity?.state);
    const layoutColorStyle = this.getLayoutColorStyle();

    const showPresets = this.config.show_presets !== false;
    const showLayout = this.config.show_layout !== false;
    const sectionOrder = orderSections(this.config.section_order);
    const hidePresetsWhenOff = this.config.hide_presets_when_off !== false;
    const presetsVisibleForPower = !hidePresetsWhenOff || !powerEntity || powerIsOn;
    const renderSection = (id: SectionId) => {
      if (id === "presets") {
        return !isCompact && presetEntity && showPresets && presetsVisibleForPower
          ? this.renderPresetArea(visiblePresets, selectedPresetOption, powerFadeToBlack, presetEntity)
          : nothing;
      }

      if (!showLayout) {
        return nothing;
      }
      return layoutPayload
        ? this.renderLayoutPreview(layoutPayload, bareLayoutMode)
        : isCompact
          ? html`<div class="row"><span class="label">Layout</span><span class="value">Unavailable</span></div>`
          : nothing;
    };

    return html`
      <ha-card
        class="ted-card ted-card--${displayMode} ted-card--theme-${themeMode} ${powerIsOn ? "is-on" : "is-off"}"
        style=${layoutColorStyle}
      >
        ${this.config.brushed !== false ? brushedOverlay : nothing}
        ${showHeader
          ? html`
              <div class="header-row">
                <div class="header-lead">
                  ${this.renderBrandLogo()}
                  ${this.config.show_name !== false
                    ? html`<div class="header">${headerText}</div>`
                    : nothing}
                </div>
                <div class="header-actions">
                  ${showStatusSection
                    ? html`
                        <div class="header-status">
                          ${showStatusDot
                            ? html`<span
                                class="status-dot ${powerIsOn ? "status-dot--on" : "status-dot--off"}"
                                title=${controllerValue}
                              ></span>`
                            : nothing}
                          ${showTempDot
                            ? html`<span
                                class="status-dot ${powerIsOn ? `status-dot--temp-${temperatureSeverity}` : "status-dot--off"}"
                                title=${`Temperature: ${temperatureEntity?.state ?? ""}`}
                              ></span>`
                            : nothing}
                          ${showBrightnessButton
                            ? this.renderHeaderBrightnessToggle(
                                brightnessMin,
                                brightnessMax,
                                brightnessStep,
                                brightnessValue,
                                powerFadeToBlack,
                                brightnessUnit
                              )
                            : nothing}
                        </div>
                      `
                    : nothing}
                  ${powerEntity ? this.renderPowerButton(powerIsOn) : nothing}
                </div>
              </div>
            `
          : nothing}
        <div class=${contentClasses}>
          ${sectionOrder.map((id) => renderSection(id))}
          ${!isCompact && this.config.show_card_version === true ? this.renderVersionFooter() : nothing}
        </div>
        ${this.presetChooserOpen && presetEntity && visiblePresets.length > 0
          ? this.renderPresetChooser(visiblePresets, selectedPresetOption, powerFadeToBlack)
          : nothing}
      </ha-card>
    `;
  }

  private getDisplayMode(): DisplayMode {
    return this.config?.display_mode === "compact" ? "compact" : "standard";
  }

  private getThemeMode(): ThemeMode {
    return this.config?.theme === "ha" ? "ha" : "ted-style";
  }

  // Render the built-in brand logo to the left of the header name as inline
  // monochrome SVG (see brands.ts / brands.art.ts). It recolors itself to the
  // header text color via `currentColor`, so it adapts to light/dark themes
  // with no extra files. Brands without generated art simply render nothing.
  // The "Custom" brand instead renders a user-uploaded image via <img>.
  private renderBrandLogo() {
    const brandId = this.config?.brand?.trim();
    if (!brandId) {
      return nothing;
    }

    const scaleStyle = `--ted-logo-scale: ${this.getLogoScale()}`;

    if (brandId === CUSTOM_BRAND_ID) {
      const url = this.config?.custom_logo?.trim();
      if (!url || this.failedLogoSrcs.has(url)) {
        return nothing;
      }
      return html`<img
        class="brand-logo brand-logo--custom"
        src=${url}
        alt=""
        style=${scaleStyle}
        @error=${() => this.handleBrandLogoError(url)}
      />`;
    }

    const variant: LogoVariant = this.config?.logo_variant ?? DEFAULT_LOGO_VARIANT;
    const art = getBrandArt(brandId, variant);
    if (!art) {
      return nothing;
    }

    return html`<svg
      class="brand-logo brand-logo--${variant}"
      viewBox="0 0 ${art.w} ${art.h}"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-hidden="true"
      style=${scaleStyle}
    ><path d=${art.path} fill="currentColor"></path></svg>`;
  }

  // Logo size multiplier from the configured percentage (default 100%),
  // clamped to a sane range.
  private getLogoScale(): number {
    const pct = Number(this.config?.logo_scale);
    if (!Number.isFinite(pct) || pct <= 0) {
      return 1;
    }
    return Math.min(3, Math.max(0.25, pct / 100));
  }

  private handleBrandLogoError(src: string): void {
    if (this.failedLogoSrcs.has(src)) {
      return;
    }
    this.failedLogoSrcs.add(src);
    this.requestUpdate();
  }

  private getTemperatureSeverity(state: string | undefined): "normal" | "warning" | "critical" | "unknown" {
    const value = (state ?? "").trim().toLowerCase();
    if (value === "normal") {
      return "normal";
    }
    if (value === "warning") {
      return "warning";
    }
    if (value === "critical") {
      return "critical";
    }
    return "unknown";
  }

  private resolveConfigColor(value: string | undefined): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const raw = value.trim();
    if (!raw) {
      return undefined;
    }

    if (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw)) {
      return raw;
    }
    if (/^(rgb|rgba|hsl|hsla)\(/i.test(raw)) {
      return raw;
    }
    if (/^[a-z]+(-[a-z]+)*$/i.test(raw)) {
      return `var(--${raw}-color)`;
    }

    return undefined;
  }

  private getLayoutColorStyle(): string {
    const declarations: string[] = [];
    const layerColor = this.resolveConfigColor(this.config?.screen_color);
    if (layerColor) {
      declarations.push(`--ted-style-layer: ${layerColor};`);
    }
    const backgroundColor = this.resolveConfigColor(this.config?.screen_background_color);
    if (backgroundColor) {
      declarations.push(`--ted-style-screen: ${backgroundColor};`);
    }
    return declarations.join(" ");
  }

  private renderPowerButton(powerIsOn: boolean) {
    return html`
      <button
        type="button"
        class="power-button ${powerIsOn ? "power-button--on" : "power-button--off"}"
        role="switch"
        aria-checked=${powerIsOn ? "true" : "false"}
        aria-label="Toggle screen output"
        title="Toggle screen output"
        @click=${this.handlePowerToggle}
      >
        <svg class="power-button-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 3a1 1 0 0 1 1 1v8a1 1 0 0 1-2 0V4a1 1 0 0 1 1-1zm5.66 2.93a1 1 0 0 1 1.41 0 9 9 0 1 1-12.73 0 1 1 0 1 1 1.41 1.42 7 7 0 1 0 9.9 0 1 1 0 0 1 0-1.42z"
          ></path>
        </svg>
      </button>
    `;
  }

  private renderHeaderBrightnessToggle(
    min: number,
    max: number,
    step: number,
    value: number,
    disabled: boolean,
    unit: string
  ) {
    const span = max - min || 1;
    const percent = Math.max(0, Math.min(100, Math.round(((value - min) / span) * 100)));
    const readout = unit ? `${Math.round(value)}${unit}` : `${percent}%`;
    return html`
      <button
        type="button"
        class="icon-button"
        id="ted-brightness-anchor"
        popovertarget="ted-brightness-popover"
        aria-label="Adjust brightness"
        title="Adjust brightness"
        ?disabled=${disabled}
      >
        <svg class="icon-button-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0-6a1 1 0 0 1 1 1v1.5a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1zm0 16.5a1 1 0 0 1 1 1V21a1 1 0 1 1-2 0v-1.5a1 1 0 0 1 1-1zM4.93 4.93a1 1 0 0 1 1.41 0l1.06 1.06A1 1 0 0 1 5.99 7.4L4.93 6.34a1 1 0 0 1 0-1.41zm11.67 11.67a1 1 0 0 1 1.41 0l1.06 1.06a1 1 0 0 1-1.41 1.41l-1.06-1.06a1 1 0 0 1 0-1.41zM2 12a1 1 0 0 1 1-1h1.5a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1zm17.5 0a1 1 0 0 1 1-1H22a1 1 0 1 1 0 2h-1.5a1 1 0 0 1-1-1zM4.93 19.07a1 1 0 0 1 0-1.41l1.06-1.06a1 1 0 1 1 1.41 1.41l-1.06 1.06a1 1 0 0 1-1.41 0zM16.6 7.4a1 1 0 0 1 0-1.41l1.06-1.06a1 1 0 1 1 1.41 1.41L18.01 7.4a1 1 0 0 1-1.41 0z"
          ></path>
        </svg>
      </button>
      <div
        id="ted-brightness-popover"
        class="brightness-popover"
        popover
        @beforetoggle=${this.handleBrightnessPopoverToggle}
      >
        <span class="brightness-popover-value">${readout}</span>
        <input
          class="brightness-slider-vertical"
          type="range"
          orient="vertical"
          min=${min}
          max=${max}
          step=${step}
          data-unit=${unit}
          style=${`--ted-style-brightness-fill:${percent}%`}
          .value=${String(value)}
          .disabled=${disabled}
          ?disabled=${disabled}
          aria-label="Brightness"
          @input=${this.handleBrightnessInput}
          @change=${this.handleBrightnessChanged}
        />
        <svg class="brightness-popover-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0-6a1 1 0 0 1 1 1v1.5a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1zm0 16.5a1 1 0 0 1 1 1V21a1 1 0 1 1-2 0v-1.5a1 1 0 0 1 1-1zM4.93 4.93a1 1 0 0 1 1.41 0l1.06 1.06A1 1 0 0 1 5.99 7.4L4.93 6.34a1 1 0 0 1 0-1.41zm11.67 11.67a1 1 0 0 1 1.41 0l1.06 1.06a1 1 0 0 1-1.41 1.41l-1.06-1.06a1 1 0 0 1 0-1.41zM2 12a1 1 0 0 1 1-1h1.5a1 1 0 1 1 0 2H3a1 1 0 0 1-1-1zm17.5 0a1 1 0 0 1 1-1H22a1 1 0 1 1 0 2h-1.5a1 1 0 0 1-1-1zM4.93 19.07a1 1 0 0 1 0-1.41l1.06-1.06a1 1 0 1 1 1.41 1.41l-1.06 1.06a1 1 0 0 1-1.41 0zM16.6 7.4a1 1 0 0 1 0-1.41l1.06-1.06a1 1 0 1 1 1.41 1.41L18.01 7.4a1 1 0 0 1-1.41 0z"
          ></path>
        </svg>
      </div>
    `;
  }

  private handleBrightnessPopoverToggle = (event: Event): void => {
    const toggleEvent = event as Event & { newState?: string };
    if (toggleEvent.newState !== "open") {
      return;
    }

    const root = this.renderRoot as ShadowRoot;
    const anchor = root.getElementById("ted-brightness-anchor");
    const popover = root.getElementById("ted-brightness-popover");
    if (!anchor || !popover) {
      return;
    }

    const rect = anchor.getBoundingClientRect();
    popover.style.top = `${Math.round(rect.bottom + 8)}px`;
    popover.style.left = "auto";
    popover.style.right = `${Math.round(window.innerWidth - rect.right)}px`;
  };

  private handleBrightnessInput = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    const min = Number.parseFloat(input.min);
    const max = Number.parseFloat(input.max);
    const value = Number.parseFloat(input.value);
    if (!Number.isFinite(value)) {
      return;
    }

    const lo = Number.isFinite(min) ? min : 0;
    const hi = Number.isFinite(max) ? max : 100;
    const span = (hi - lo) || 1;
    const percent = Math.max(0, Math.min(100, Math.round(((value - lo) / span) * 100)));
    input.style.setProperty("--ted-style-brightness-fill", `${percent}%`);

    const popover = input.closest(".brightness-popover");
    const readout = popover?.querySelector(".brightness-popover-value");
    if (readout) {
      const unit = input.dataset.unit ?? "";
      readout.textContent = unit ? `${Math.round(value)}${unit}` : `${percent}%`;
    }
  };

  private renderPresetArea(
    options: string[],
    selected: string,
    disabled: boolean,
    presetEntity: HassEntity
  ) {
    if (options.length === 0) {
      return html`
        <div class="preset-area">
          <div class="row"><span class="value">${presetEntity.state}</span></div>
        </div>
      `;
    }

    const showMore = options.length > 5;
    const visibleOptions = !showMore ? options : options.slice(0, 4);

    return html`
      <div class="preset-area">
        <div class="preset-grid" role="group" aria-label="Presets">
          ${visibleOptions.map((option) => {
            const isActive = this.optionEquals(option, selected);
            return html`
              <button
                type="button"
                class="preset-button ${isActive ? "preset-button--active" : ""}"
                ?disabled=${disabled}
                aria-pressed=${isActive ? "true" : "false"}
                title=${option}
                @click=${() => this.handlePresetButtonClick(option)}
              ><span class="preset-button-label">${option}</span></button>
            `;
          })}
          ${showMore
            ? html`
                <button
                  type="button"
                  class="preset-button preset-button--more"
                  ?disabled=${disabled}
                  aria-haspopup="true"
                  aria-expanded=${this.presetChooserOpen ? "true" : "false"}
                  aria-label="Show all presets"
                  title="Show all presets"
                  @click=${this.openPresetChooser}
                >
                  <svg class="preset-more-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M16 12a2 2 0 1 1 4 0 2 2 0 0 1-4 0zm-6 0a2 2 0 1 1 4 0 2 2 0 0 1-4 0zm-6 0a2 2 0 1 1 4 0 2 2 0 0 1-4 0z"></path>
                  </svg>
                </button>
              `
            : nothing}
        </div>
      </div>
    `;
  }

  private renderPresetChooser(options: string[], selected: string, disabled: boolean) {
    return html`
      <div
        id="ted-preset-popover"
        class="ted-popover"
        popover
        @toggle=${this.handlePresetPopoverToggle}
      >
        <div class="ted-popover-title">Select Preset</div>
        <div class="ted-popover-options">
          ${options.map((option) => html`
            <button
              type="button"
              class="ted-popover-option ${this.optionEquals(option, selected) ? "selected" : ""}"
              ?disabled=${disabled}
              @click=${() => this.handlePresetChooserOptionClick(option)}
            >${option}</button>
          `)}
        </div>
      </div>
    `;
  }

  private handlePresetPopoverToggle = (event: Event): void => {
    const toggleEvent = event as Event & { newState?: string };
    if (toggleEvent.newState === "closed" && this.presetChooserOpen) {
      this.presetChooserOpen = false;
      this.requestUpdate();
    }
  };

  private openPresetChooser = (event: Event): void => {
    const target = event.currentTarget as HTMLElement | null;
    this.presetAnchorRect = target?.getBoundingClientRect();
    this.presetChooserOpen = true;
    this.requestUpdate();
  };

  private async handlePresetChooserOptionClick(option: string): Promise<void> {
    this.presetChooserOpen = false;
    this.requestUpdate();
    await this.handlePresetButtonClick(option);
  }

  private renderVersionFooter() {
    return html`<div class="version-footer">${TedNovastarCard.LAYOUT_BUILD_MARKER}</div>`;
  }

  static styles = [
    tedStyleTheme,
    css`
    ha-card {
      overflow: hidden;
      position: relative;
      /* Establish a stacking context so the brushed sheen (z-index: -3) sits
         above the card background but below the card content. */
      isolation: isolate;
    }

    .header-row {
      align-items: center;
      display: flex;
      gap: var(--ted-style-gap);
      justify-content: space-between;
      padding: 16px 16px 4px;
      /* Sit above the brushed sheen (z-index: -3) so it never blends onto the header. */
      position: relative;
      z-index: 1;
    }

    .header-lead {
      align-items: center;
      display: inline-flex;
      gap: 10px;
      min-width: 0;
    }

    .brand-logo {
      color: var(--ted-style-text);
      display: block;
      flex: none;
      height: calc(var(--ted-logo-base, 26px) * var(--ted-logo-scale, 1));
      width: auto;
    }

    img.brand-logo {
      object-fit: contain;
    }

    .brand-logo--mark {
      --ted-logo-base: 26px;
    }

    .brand-logo--stacked {
      --ted-logo-base: 40px;
    }

    .brand-logo--horizontal {
      --ted-logo-base: 26px;
    }

    .brand-logo--custom {
      --ted-logo-base: 28px;
    }

    .header-status {
      align-items: center;
      display: inline-flex;
      flex: none;
      gap: 8px;
    }

    .header {
      font-size: 1.15rem;
      font-weight: 600;
      letter-spacing: 0.01em;
      line-height: 1.2;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .status-dot {
      border-radius: 50%;
      flex: none;
      height: 10px;
      transition: background-color 0.25s ease, box-shadow 0.25s ease;
      width: 10px;
    }

    .status-dot--on {
      background: var(--ted-style-success);
      box-shadow: 0 0 4px color-mix(in srgb, var(--ted-style-success) 22%, transparent);
    }

    .status-dot--off {
      background: color-mix(in srgb, var(--ted-style-muted) 55%, transparent);
    }

    .status-dot--temp-normal {
      background: var(--ted-style-info);
      box-shadow: 0 0 8px color-mix(in srgb, var(--ted-style-info) 70%, transparent);
    }

    .status-dot--temp-warning {
      background: var(--ted-style-warning);
      box-shadow: 0 0 8px color-mix(in srgb, var(--ted-style-warning) 70%, transparent);
    }

    .status-dot--temp-critical {
      background: var(--ted-style-danger);
      box-shadow: 0 0 8px color-mix(in srgb, var(--ted-style-danger) 70%, transparent);
    }

    .status-dot--temp-unknown {
      background: color-mix(in srgb, var(--ted-style-muted) 55%, transparent);
    }

    .power-button {
      align-items: center;
      background: var(--ted-style-surface-2);
      border: 1px solid var(--ted-style-divider);
      border-radius: 50%;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
      box-sizing: border-box;
      color: color-mix(in srgb, var(--ted-style-text) 60%, transparent);
      cursor: pointer;
      display: inline-flex;
      flex: none;
      height: 30px;
      justify-content: center;
      padding: 0;
      transition: background 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease, color 0.2s ease, transform 0.08s ease;
      width: 30px;
      -webkit-tap-highlight-color: transparent;
    }

    .power-button:hover {
      border-color: color-mix(in srgb, var(--ted-style-accent) 45%, var(--ted-style-divider));
    }

    .power-button:active {
      transform: scale(0.94);
    }

    .power-button:focus-visible {
      outline: 2px solid var(--ted-style-accent);
      outline-offset: 2px;
    }

    .power-button-icon {
      fill: currentColor;
      height: 16px;
      width: 16px;
    }

    /* ON: a glowing ring only — background and icon color stay constant. */
    .power-button--on {
      background: var(--ted-style-surface-2);
      border-color: var(--ted-style-success);
      box-shadow:
        0 0 0 1px var(--ted-style-success),
        0 0 4px color-mix(in srgb, var(--ted-style-success) 22%, transparent);
    }

    ha-card.ted-card--theme-ha .power-button--on {
      border-color: var(--ted-style-accent);
      box-shadow:
        0 0 0 1px var(--ted-style-accent),
        0 0 4px color-mix(in srgb, var(--ted-style-accent) 22%, transparent);
    }

    .header-actions {
      align-items: center;
      display: inline-flex;
      flex: none;
      gap: 14px;
    }

    .icon-button {
      align-items: center;
      background: transparent;
      border: none;
      border-radius: 50%;
      box-sizing: border-box;
      color: var(--ted-style-muted);
      cursor: pointer;
      display: inline-flex;
      flex: none;
      height: 30px;
      justify-content: center;
      margin-left: 6px;
      padding: 0;
      transition: color 0.2s ease, transform 0.08s ease;
      width: 30px;
      -webkit-tap-highlight-color: transparent;
    }

    .icon-button:hover {
      color: var(--ted-style-text);
    }

    .icon-button:active {
      transform: scale(0.9);
    }

    .icon-button:focus-visible {
      outline: 2px solid var(--ted-style-accent);
      outline-offset: 2px;
    }

    .icon-button:disabled {
      opacity: 0.4;
      pointer-events: none;
    }

    .icon-button-icon {
      fill: currentColor;
      height: 18px;
      width: 18px;
    }

    .brightness-popover {
      background: var(--ted-style-surface);
      border: 1px solid var(--ted-style-divider);
      border-radius: var(--ted-style-radius-sm);
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
      box-sizing: border-box;
      inset: auto;
      margin: 0;
      padding: 14px 12px;
      position: fixed;
    }

    .brightness-popover:popover-open {
      align-items: center;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .brightness-popover::backdrop {
      background: transparent;
    }

    .brightness-popover-value {
      color: var(--ted-style-text);
      font-size: 0.85rem;
      font-weight: 600;
    }

    .brightness-popover-icon {
      color: var(--ted-style-muted);
      fill: currentColor;
      height: 18px;
      width: 18px;
    }

    .brightness-slider-vertical {
      -webkit-appearance: none;
      appearance: none;
      background: transparent;
      direction: rtl;
      height: 150px;
      margin: 0;
      width: 28px;
      writing-mode: vertical-lr;
    }

    .brightness-slider-vertical::-webkit-slider-runnable-track {
      background: linear-gradient(
        to top,
        var(--ted-style-accent) 0%,
        var(--ted-style-accent) var(--ted-style-brightness-fill, 50%),
        color-mix(in srgb, var(--ted-style-text) 18%, transparent) var(--ted-style-brightness-fill, 50%),
        color-mix(in srgb, var(--ted-style-text) 18%, transparent) 100%
      );
      border-radius: var(--ted-style-pill);
      width: 6px;
    }

    .brightness-slider-vertical::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      background: var(--ted-style-surface);
      border: 1px solid color-mix(in srgb, var(--ted-style-text) 20%, transparent);
      border-radius: 50%;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
      height: 22px;
      margin-left: -8px;
      width: 22px;
    }

    .brightness-slider-vertical::-moz-range-track {
      background: color-mix(in srgb, var(--ted-style-text) 18%, transparent);
      border-radius: var(--ted-style-pill);
      width: 6px;
    }

    .brightness-slider-vertical::-moz-range-progress {
      background: var(--ted-style-accent);
      border-radius: var(--ted-style-pill);
      width: 6px;
    }

    .brightness-slider-vertical::-moz-range-thumb {
      background: var(--ted-style-surface);
      border: 1px solid color-mix(in srgb, var(--ted-style-text) 20%, transparent);
      border-radius: 50%;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
      height: 22px;
      width: 22px;
    }

    .brightness-slider-vertical:disabled {
      opacity: 0.4;
      pointer-events: none;
    }

    .content {
      display: flex;
      flex-direction: column;
      gap: var(--ted-style-gap);
      padding: 16px;
      /* Sit above the brushed sheen (z-index: -3) so it never blends onto the controls. */
      position: relative;
      z-index: 1;
    }

    .content--standard {
      gap: 16px;
    }

    .content--bare {
      gap: 0;
      padding: 0;
    }

    .row {
      align-items: center;
      display: flex;
      gap: 12px;
      justify-content: space-between;
      min-height: 28px;
    }

    .label {
      color: var(--ted-style-muted);
      font-size: 0.95rem;
      font-weight: 500;
    }

    .value {
      color: var(--ted-style-text);
      font-weight: 600;
      text-align: right;
      text-transform: capitalize;
    }

    .status-value {
      align-items: center;
      border-radius: var(--ted-style-radius-sm);
      display: inline-flex;
      font-size: 0.85rem;
      gap: 6px;
      padding: 4px 12px;
      text-transform: none;
    }

    .status-value--on {
      background: color-mix(in srgb, var(--ted-style-success) 16%, transparent);
      color: color-mix(in srgb, var(--ted-style-success) 78%, var(--ted-style-text));
    }

    .status-value--off {
      background: color-mix(in srgb, var(--ted-style-muted) 16%, transparent);
      color: var(--ted-style-muted);
    }

    .input-row {
      align-items: center;
    }

    .preset-area,
    .layout-area {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .preset-heading {
      color: var(--ted-style-muted);
      font-size: 0.95rem;
      font-weight: 500;
    }

    .preset-grid {
      display: grid;
      gap: 8px;
      grid-template-columns: repeat(5, 1fr);
    }

    .preset-button {
      align-items: flex-start;
      aspect-ratio: 1 / 1;
      /* Opaque base + themed tint so the brushed sheen can never show through the button. */
      background-color: var(--ted-style-surface);
      background-image: linear-gradient(var(--ted-style-surface-2), var(--ted-style-surface-2));
      border: 1px solid var(--ted-style-divider);
      border-radius: var(--ted-style-radius-sm);
      color: var(--ted-style-text);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      font: inherit;
      font-size: 0.82rem;
      font-weight: 600;
      justify-content: flex-end;
      line-height: 1.15;
      overflow: hidden;
      padding: 8px;
      text-align: left;
      transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease, transform 0.08s ease;
      word-break: break-word;
      -webkit-tap-highlight-color: transparent;
    }

    .preset-button:hover {
      border-color: color-mix(in srgb, var(--ted-style-accent) 50%, var(--ted-style-divider));
    }

    .preset-button:active {
      transform: scale(0.96);
    }

    .preset-button:focus-visible {
      outline: 2px solid var(--ted-style-accent);
      outline-offset: 2px;
    }

    .preset-button--active {
      background: var(--ted-style-accent);
      border-color: color-mix(in srgb, var(--ted-style-accent) 60%, #ffffff);
      box-shadow: 0 2px 10px color-mix(in srgb, var(--ted-style-accent) 35%, transparent);
      color: var(--ted-style-on-accent);
    }

    .preset-button:disabled {
      opacity: 0.45;
      pointer-events: none;
    }

    .preset-button--more {
      align-items: center;
      color: var(--ted-style-muted);
      justify-content: center;
    }

    .preset-button--more:hover {
      color: var(--ted-style-text);
    }

    .preset-more-icon {
      fill: currentColor;
      height: 26px;
      width: 26px;
    }

    .brightness-control {
      align-items: center;
      background: var(--ted-style-surface-2);
      border: 1px solid var(--ted-style-divider);
      border-radius: var(--ted-style-radius-sm);
      box-sizing: border-box;
      display: flex;
      flex: 1 1 auto;
      gap: 12px;
      min-height: var(--ted-style-touch);
      padding: 0 16px;
      width: 100%;
    }

    .brightness-icon {
      color: var(--ted-style-muted);
      fill: currentColor;
      flex: none;
      height: 20px;
      width: 20px;
    }

    .brightness-value {
      color: var(--ted-style-text);
      flex: none;
      font-size: 0.9rem;
      font-weight: 600;
      min-width: 42px;
      text-align: right;
    }

    .brightness-slider {
      -webkit-appearance: none;
      appearance: none;
      background: transparent;
      box-sizing: border-box;
      flex: 1 1 auto;
      height: var(--ted-style-touch);
      margin: 0;
      width: 100%;
    }

    .brightness-slider::-webkit-slider-runnable-track {
      background: linear-gradient(
        to right,
        var(--ted-style-accent) 0%,
        var(--ted-style-accent) var(--ted-style-brightness-fill, 50%),
        color-mix(in srgb, var(--ted-style-text) 18%, transparent) var(--ted-style-brightness-fill, 50%),
        color-mix(in srgb, var(--ted-style-text) 18%, transparent) 100%
      );
      border-radius: var(--ted-style-pill);
      height: 6px;
    }

    .brightness-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      background: var(--ted-style-surface);
      border: 1px solid color-mix(in srgb, var(--ted-style-text) 20%, transparent);
      border-radius: 50%;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
      height: 22px;
      margin-top: -8px;
      width: 22px;
    }

    .brightness-slider::-moz-range-track {
      background: color-mix(in srgb, var(--ted-style-text) 18%, transparent);
      border-radius: var(--ted-style-pill);
      height: 6px;
    }

    .brightness-slider::-moz-range-progress {
      background: var(--ted-style-accent);
      border-radius: var(--ted-style-pill);
      height: 6px;
    }

    .brightness-slider::-moz-range-thumb {
      background: var(--ted-style-surface);
      border: 1px solid color-mix(in srgb, var(--ted-style-text) 20%, transparent);
      border-radius: 50%;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
      height: 22px;
      width: 22px;
    }

    .brightness-slider:disabled {
      opacity: 0.4;
      pointer-events: none;
    }

    .preset-button:disabled {
      opacity: 0.45;
      pointer-events: none;
    }

    .layout-preview {
      border-radius: var(--ted-style-radius-sm);
      position: relative;
    }

    .layout-title {
      color: var(--ted-style-muted);
      font-size: 0.9rem;
      margin-bottom: 8px;
    }

    .layout-canvas {
      background: var(--ted-style-screen);
      border: 1px solid var(--ted-style-divider);
      border-radius: var(--ted-style-radius-sm);
      display: block;
      width: 100%;
    }

    .layout-preview--compact .layout-canvas {
      border-radius: 0;
    }

    .layout-screen {
      fill: var(--ted-style-screen);
      stroke: color-mix(in srgb, var(--ted-style-text) 22%, #3a3a3a);
    }

    .layout-layer {
      fill: var(--ted-style-layer);
      fill-opacity: 1;
      stroke: color-mix(in srgb, var(--ted-style-accent) 55%, #8893a0);
    }

    .layout-layer-hitbox {
      cursor: pointer;
    }

    .layout-label {
      fill: var(--ted-style-text);
      font-family: inherit;
      font-size: 9px;
      pointer-events: none;
    }

    .layout-empty {
      fill: color-mix(in srgb, #ffffff 65%, transparent);
      font-family: inherit;
      font-size: 14px;
    }

    .layout-layers--off {
      opacity: 0.15;
    }

    .layout-off-label {
      fill: color-mix(in srgb, #ffffff 80%, transparent);
      font-family: inherit;
      font-weight: 700;
      letter-spacing: 0.04em;
    }

    .version-footer {
      color: var(--ted-style-muted);
      font-size: 0.72rem;
      letter-spacing: 0.02em;
      opacity: 0.7;
      text-align: right;
    }

    .ted-popover {
      background: var(--ted-style-surface);
      border: 1px solid var(--ted-style-divider);
      border-radius: var(--ted-style-radius-sm);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
      box-sizing: border-box;
      inset: auto;
      margin: 0;
      max-width: min(300px, 92vw);
      min-width: 200px;
      padding: 8px;
      position: fixed;
    }

    .ted-popover::backdrop {
      background: transparent;
    }

    .ted-popover-title {
      color: var(--ted-style-muted);
      font-size: 0.8rem;
      font-weight: 600;
      padding: 4px 8px 8px;
    }

    .ted-popover-options {
      display: grid;
      gap: 6px;
      max-height: min(50vh, 320px);
      overflow: auto;
    }

    .ted-popover-option {
      align-items: center;
      background: var(--ted-style-surface-2);
      border: 1px solid var(--ted-style-divider);
      border-radius: var(--ted-style-radius-sm);
      color: var(--ted-style-text);
      cursor: pointer;
      display: flex;
      font: inherit;
      font-size: 0.95rem;
      font-weight: 500;
      min-height: 40px;
      padding: 8px 14px;
      text-align: left;
      transition: background 0.18s ease, border-color 0.18s ease;
      width: 100%;
    }

    .ted-popover-option:hover {
      border-color: color-mix(in srgb, var(--ted-style-accent) 45%, var(--ted-style-divider));
    }

    .ted-popover-option.selected {
      background: color-mix(in srgb, var(--ted-style-accent) 14%, transparent);
      border-color: var(--ted-style-accent);
      box-shadow: inset 0 0 0 1px var(--ted-style-accent);
    }

    .ted-popover-option:disabled {
      opacity: 0.5;
      pointer-events: none;
    }
  `
  ];

  private labelMeasureContext?: CanvasRenderingContext2D | null;

  private renderLayoutPreview(payload: LayoutPayload, compactMode = false) {
    const viewBoxWidth = payload.screenWidth;
    const viewBoxHeight = payload.screenHeight;
    const sortedLayers = this.fitLayersToViewport(payload.layers, viewBoxWidth, viewBoxHeight)
      .sort((a, b) => a.z - b.z);
    const screenFill = "#000000";
    const screenStroke = "#4a4a4a";
    const layerFill = "#d9d9d9";
    const layerStroke = "#808080";
    const labelFill = "#ffffff";
    const layerSourceRows = this.getLayerSourceRows();
    const layerSourceLabels = this.getLayerSourceLabelMap();
    const powerEntityId = this.getEntityId("power_entity") ?? "switch.novastar_h2_power_screen_output";
    const powerEntity = this.hass?.states[powerEntityId];
    const powerState = this.optimisticPowerState ?? powerEntity?.state;
    const powerFadeToBlack = Boolean(powerEntity) && powerState !== "on";
    const offFontSize = Math.max(40, Math.min(viewBoxHeight * 0.14, viewBoxWidth * 0.1));

    return html`
      <div class=${compactMode ? "layout-preview layout-preview--compact" : "layout-preview"}>
        <svg
          class="layout-canvas"
          viewBox=${`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
          role="img"
          aria-label="Current screen layout preview"
          preserveAspectRatio="xMidYMid meet"
        >
          <rect
            class="layout-screen"
            x="0"
            y="0"
            width=${viewBoxWidth}
            height=${viewBoxHeight}
            fill=${screenFill}
            stroke=${screenStroke}
            stroke-width="1"
          ></rect>
          ${!powerFadeToBlack && sortedLayers.length === 0
            ? svg`<text class="layout-empty" x=${viewBoxWidth / 2} y=${viewBoxHeight / 2} text-anchor="middle" dominant-baseline="middle">No layers detected</text>`
            : nothing}
          <g class=${powerFadeToBlack ? "layout-layers layout-layers--off" : "layout-layers"}>
            ${sortedLayers.map((layer, index) => {
              const layerSourceRow = this.resolveLayerSourceRow(layerSourceRows, layer.id, index);
              const label = this.resolveLayerSourceLabel(layerSourceLabels, layer.id, index)
                ?? layer.source?.trim()
                ?? layer.id;
              const labelX = layer.x + (layer.width / 2);
              const labelY = layer.y + (layer.height / 2);
              const minLayerDimension = Math.min(layer.width, layer.height);
              const viewportMinFont = Math.max(54, viewBoxWidth * 0.017);
              const preferredFont = Math.max(minLayerDimension * 0.14, viewportMinFont);
              const maxFontByHeight = Math.max(24, layer.height * 0.38);
              const labelFontSize = Math.min(preferredFont, maxFontByHeight);
              const horizontalPadding = Math.max(18, labelFontSize * 0.35);
              const maxLabelWidth = Math.max(32, layer.width * 0.9);

              const sourceIconScaleX = (labelFontSize * 0.832) / 480;
              const sourceIconScaleY = (labelFontSize * 0.72) / 320;
              const sourceIconWidth = 480 * sourceIconScaleX;
              const sourceIconGap = labelFontSize * 0.36;
              const sourceIconSlot = sourceIconWidth + sourceIconGap;
              const textBudget = maxLabelWidth - (horizontalPadding * 2);
              const showSourceIcon = (textBudget - sourceIconSlot) >= (labelFontSize * 0.62 * 2);
              const charBudget = showSourceIcon ? textBudget - sourceIconSlot : textBudget;
              const maxChars = Math.max(1, Math.floor(charBudget / Math.max(1, labelFontSize * 0.62)));
              const visibleLabel = label.length <= maxChars
                ? label
                : `${label.slice(0, Math.max(1, maxChars - 1))}…`;
              const estimatedTextWidth = this.measureLabelWidth(visibleLabel, labelFontSize) + 2;
              const contentWidth = (showSourceIcon ? sourceIconSlot : 0) + estimatedTextWidth;
              const badgeWidth = Math.min(maxLabelWidth, contentWidth + (horizontalPadding * 2));
              const badgeHeight = Math.max(28, labelFontSize * 1.35);
              const badgeX = labelX - (badgeWidth / 2);
              const badgeY = labelY - (badgeHeight / 2);
              const badgeRadius = Math.max(6, badgeHeight * 0.25);
              const contentStartX = badgeX + horizontalPadding;
              const sourceIconTranslateX = contentStartX - (16 * sourceIconScaleX);
              const sourceIconTranslateY = labelY - (256 * sourceIconScaleY);
              const textX = showSourceIcon ? contentStartX + sourceIconSlot : labelX;
              const textAnchor = showSourceIcon ? "start" : "middle";
              const labelTextY = labelY + (labelFontSize * 0.1);

              const audioIconSize = Math.max(51, Math.min(138, minLayerDimension * 0.27));
              const audioIconPadding = Math.max(10, audioIconSize * 0.22);
              const audioIconX = Math.max(layer.x + 4, layer.x + layer.width - audioIconSize - audioIconPadding);
              const audioIconY = Math.min(layer.y + audioIconPadding, layer.y + layer.height - audioIconSize - 4);
              const speakerBodyX = audioIconX + (audioIconSize * 0.22);
              const speakerBodyY = audioIconY + (audioIconSize * 0.34);
              const speakerBodyWidth = audioIconSize * 0.18;
              const speakerBodyHeight = audioIconSize * 0.32;
              const speakerConePoints = [
                `${speakerBodyX + speakerBodyWidth},${audioIconY + (audioIconSize * 0.26)}`,
                `${audioIconX + (audioIconSize * 0.68)},${audioIconY + (audioIconSize * 0.16)}`,
                `${audioIconX + (audioIconSize * 0.68)},${audioIconY + (audioIconSize * 0.84)}`,
                `${speakerBodyX + speakerBodyWidth},${audioIconY + (audioIconSize * 0.74)}`
              ].join(" ");
              const waveBaseX = audioIconX + (audioIconSize * 0.7);
              const waveCenterY = audioIconY + (audioIconSize * 0.5);
              const isAudioOpen = layer.audioOpen === true;
              const isAudioMuted = layer.audioOpen === false;
              const audioColor = isAudioOpen
                ? "var(--success-color, #43a047)"
                : isAudioMuted
                  ? "var(--secondary-text-color, #8a8a8a)"
                  : "color-mix(in srgb, var(--secondary-text-color, #8a8a8a) 55%, transparent)";
              const layerClickable = Boolean(layerSourceRow) && !powerFadeToBlack;

              return svg`
                <g>
                  <rect
                    class="layout-layer"
                    x=${layer.x}
                    y=${layer.y}
                    width=${layer.width}
                    height=${layer.height}
                    fill=${layerFill}
                    stroke=${layerStroke}
                    stroke-width="3"
                  ></rect>
                  ${powerFadeToBlack
                    ? nothing
                    : svg`
                      <g>
                        <rect
                          x=${audioIconX}
                          y=${audioIconY}
                          width=${audioIconSize}
                          height=${audioIconSize}
                          rx=${audioIconSize * 0.22}
                          ry=${audioIconSize * 0.22}
                          fill="#111111"
                          fill-opacity="0.8"
                        ></rect>
                        <rect
                          x=${speakerBodyX}
                          y=${speakerBodyY}
                          width=${speakerBodyWidth}
                          height=${speakerBodyHeight}
                          fill=${audioColor}
                        ></rect>
                        <polygon points=${speakerConePoints} fill=${audioColor}></polygon>
                        ${isAudioOpen
                          ? svg`
                            <path
                              d=${`M ${waveBaseX} ${waveCenterY - (audioIconSize * 0.13)} Q ${waveBaseX + (audioIconSize * 0.12)} ${waveCenterY} ${waveBaseX} ${waveCenterY + (audioIconSize * 0.13)}`}
                              fill="none"
                              stroke=${audioColor}
                              stroke-width=${audioIconSize * 0.06}
                              stroke-linecap="round"
                            ></path>
                            <path
                              d=${`M ${waveBaseX + (audioIconSize * 0.1)} ${waveCenterY - (audioIconSize * 0.22)} Q ${waveBaseX + (audioIconSize * 0.28)} ${waveCenterY} ${waveBaseX + (audioIconSize * 0.1)} ${waveCenterY + (audioIconSize * 0.22)}`}
                              fill="none"
                              stroke=${audioColor}
                              stroke-width=${audioIconSize * 0.06}
                              stroke-linecap="round"
                            ></path>
                          `
                          : nothing}
                        ${isAudioMuted
                          ? svg`
                            <line
                              x1=${audioIconX + (audioIconSize * 0.7)}
                              y1=${audioIconY + (audioIconSize * 0.24)}
                              x2=${audioIconX + (audioIconSize * 0.92)}
                              y2=${audioIconY + (audioIconSize * 0.76)}
                              stroke=${audioColor}
                              stroke-width=${audioIconSize * 0.08}
                              stroke-linecap="round"
                            ></line>
                          `
                          : nothing}
                      </g>
                      <rect
                        class=${layerClickable ? "layout-layer-hitbox" : ""}
                        x=${badgeX}
                        y=${badgeY}
                        width=${badgeWidth}
                        height=${badgeHeight}
                        rx=${badgeRadius}
                        ry=${badgeRadius}
                        fill="#111111"
                        fill-opacity="0.82"
                        @click=${layerClickable ? (event: Event) => this.openLayerSourceChooser(layerSourceRow, event) : nothing}
                      ></rect>
                      ${showSourceIcon
                        ? svg`
                          <g
                            class=${layerClickable ? "layout-layer-hitbox" : ""}
                            transform=${`translate(${sourceIconTranslateX} ${sourceIconTranslateY}) scale(${sourceIconScaleX} ${sourceIconScaleY})`}
                            @click=${layerClickable ? (event: Event) => this.openLayerSourceChooser(layerSourceRow, event) : nothing}
                          >
                            <path d="M472 96H40a24.03 24.03 0 0 0-24 24v80h32v-72h416v256H48v-72H16v80a24.03 24.03 0 0 0 24 24h432a24.03 24.03 0 0 0 24-24V120a24.03 24.03 0 0 0-24-24" fill=${labelFill}></path>
                            <path d="m212.687 323.078l22.626 22.627l90.511-90.509l-90.511-90.51l-22.626 22.628l51.881 51.882H16v31.999h248.569z" fill=${labelFill}></path>
                          </g>
                        `
                        : nothing}
                      <text
                        class=${layerClickable ? "layout-layer-hitbox" : ""}
                        x=${textX}
                        y=${labelTextY}
                        font-weight="700"
                        style=${`fill:${labelFill};font-size:${labelFontSize}px;font-family:inherit;`}
                        text-anchor=${textAnchor}
                        dominant-baseline="middle"
                        @click=${layerClickable ? (event: Event) => this.openLayerSourceChooser(layerSourceRow, event) : nothing}
                      >${visibleLabel}</text>
                    `}
                </g>
              `;
            })}
          </g>
          ${powerFadeToBlack
            ? svg`<text
                class="layout-off-label"
                x=${viewBoxWidth / 2}
                y=${viewBoxHeight / 2}
                text-anchor="middle"
                dominant-baseline="middle"
                style=${`font-size:${offFontSize}px;`}
              >Screen Off</text>`
            : nothing}
        </svg>
        ${this.activeLayerSourceChooser
          ? this.renderLayerSourceChooser(powerFadeToBlack)
          : nothing}
      </div>
    `;
  }

  private measureLabelWidth(text: string, fontSize: number): number {
    if (this.labelMeasureContext === undefined) {
      this.labelMeasureContext = document.createElement("canvas").getContext("2d");
    }

    const context = this.labelMeasureContext;
    if (!context) {
      // Canvas unavailable — fall back to a rough average glyph-advance estimate.
      return text.length * fontSize * 0.55;
    }

    let fontFamily = "Roboto, Noto, sans-serif";
    try {
      const resolved = getComputedStyle(this).fontFamily;
      if (resolved) {
        fontFamily = resolved;
      }
    } catch {
    }

    context.font = `700 ${fontSize}px ${fontFamily}`;
    return context.measureText(text).width;
  }

  private getLayerSourceLabelMap(): Map<number, string> {
    const labelMap = new Map<number, string>();

    for (const row of this.getLayerSourceRows()) {
      const selected = this.resolveSelectedOption(row.entity, row.options).trim();
      if (!selected) {
        continue;
      }

      labelMap.set(row.layerNumber, selected);
    }

    return labelMap;
  }

  private resolveLayerSourceLabel(labelMap: Map<number, string>, layerId: string, index: number): string | undefined {
    const candidateLayers: number[] = [];
    const parsedLayerId = Number.parseInt(layerId, 10);

    if (Number.isFinite(parsedLayerId)) {
      candidateLayers.push(parsedLayerId);
      candidateLayers.push(parsedLayerId + 1);
    }

    candidateLayers.push(index);
    candidateLayers.push(index + 1);

    for (const candidate of candidateLayers) {
      const value = labelMap.get(candidate)?.trim();
      if (value) {
        return value;
      }
    }

    return undefined;
  }

  private resolveLayerSourceRow(rows: LayerSourceRow[], layerId: string, index: number): LayerSourceRow | undefined {
    const candidateLayers: number[] = [];
    const parsedLayerId = Number.parseInt(layerId, 10);

    if (Number.isFinite(parsedLayerId)) {
      candidateLayers.push(parsedLayerId);
      candidateLayers.push(parsedLayerId + 1);
    }

    candidateLayers.push(index);
    candidateLayers.push(index + 1);

    for (const candidate of candidateLayers) {
      const match = rows.find((row) => row.layerNumber === candidate);
      if (match) {
        return match;
      }
    }

    return rows[index];
  }

  private renderLayerSourceChooser(powerFadeToBlack: boolean) {
    const chooser = this.activeLayerSourceChooser;
    if (!chooser) {
      return nothing;
    }

    return html`
      <div
        id="ted-layer-popover"
        class="ted-popover"
        popover
        @toggle=${this.handleLayerPopoverToggle}
      >
        <div class="ted-popover-title">Layer ${chooser.layerNumber} Source</div>
        <div class="ted-popover-options">
          ${chooser.options.map((option) => html`
            <button
              type="button"
              class="ted-popover-option ${this.optionEquals(option, chooser.selectedOption) ? "selected" : ""}"
              ?disabled=${powerFadeToBlack}
              @click=${() => this.handleLayerSourceModalOptionClick(option)}
            >${option}</button>
          `)}
        </div>
      </div>
    `;
  }

  private handleLayerPopoverToggle = (event: Event): void => {
    const toggleEvent = event as Event & { newState?: string };
    if (toggleEvent.newState === "closed" && this.activeLayerSourceChooser) {
      this.closeLayerSourceChooser();
    }
  };

  private openLayerSourceChooser(row: LayerSourceRow | undefined, event?: Event): void {
    if (!row) {
      return;
    }

    const target = event?.currentTarget as Element | null;
    this.layerAnchorRect = target?.getBoundingClientRect();
    this.activeLayerSourceChooser = {
      entityId: row.entityId,
      layerNumber: row.layerNumber,
      options: row.options,
      selectedOption: this.resolveSelectedOption(row.entity, row.options)
    };
    this.requestUpdate();
  }

  private closeLayerSourceChooser = (): void => {
    this.activeLayerSourceChooser = undefined;
    this.requestUpdate();
  };

  private async handleLayerSourceModalOptionClick(option: string): Promise<void> {
    const chooser = this.activeLayerSourceChooser;
    const nextOption = option.trim();
    if (!chooser || !nextOption) {
      return;
    }

    await this.selectLayerSourceOption(chooser.entityId, nextOption);
    this.closeLayerSourceChooser();
  }

  private fitLayersToViewport(layers: LayoutLayer[], screenWidth: number, screenHeight: number): ViewLayer[] {
    if (layers.length === 0) {
      return [];
    }

    return layers
      .map((layer) => {
        if (!Number.isFinite(layer.x)
          || !Number.isFinite(layer.y)
          || !Number.isFinite(layer.width)
          || !Number.isFinite(layer.height)
          || layer.width <= 0
          || layer.height <= 0) {
          return undefined;
        }

        const x1 = Math.max(0, layer.x);
        const y1 = Math.max(0, layer.y);
        const x2 = Math.min(screenWidth, layer.x + layer.width);
        const y2 = Math.min(screenHeight, layer.y + layer.height);
        const clippedWidth = x2 - x1;
        const clippedHeight = y2 - y1;

        if (clippedWidth <= 0 || clippedHeight <= 0) {
          return undefined;
        }

        return {
          ...layer,
          x: x1,
          y: y1,
          width: clippedWidth,
          height: clippedHeight
        };
      })
      .filter((layer): layer is ViewLayer => Boolean(layer));
  }

  private readNumberAttribute(entity: HassEntity, key: string, fallbackValue: number): number {
    const rawValue = entity.attributes[key];
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      return rawValue;
    }

    if (typeof rawValue === "string") {
      const parsedValue = Number.parseFloat(rawValue);
      if (Number.isFinite(parsedValue)) {
        return parsedValue;
      }
    }

    return fallbackValue;
  }

  private readStringListAttribute(entity: HassEntity | undefined, key: string): string[] {
    if (!entity) {
      return [];
    }

    const value = entity.attributes[key];
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is string => typeof item === "string");
  }

  private resolveSelectedOption(entity: HassEntity, options: string[]): string {
    const stateValue = entity.state?.trim();
    const candidates = [
      stateValue,
      this.readStringAttribute(entity, "current_option"),
      this.readStringAttribute(entity, "selected_option"),
      this.readStringAttribute(entity, "source"),
      this.readStringAttribute(entity, "current_source")
    ].filter((candidate): candidate is string => Boolean(candidate));

    for (const candidate of candidates) {
      const exactMatch = options.find((option) => option === candidate);
      if (exactMatch) {
        return exactMatch;
      }

      const normalizedCandidate = candidate.toLowerCase();
      const caseInsensitiveMatch = options.find((option) => option.toLowerCase() === normalizedCandidate);
      if (caseInsensitiveMatch) {
        return caseInsensitiveMatch;
      }
    }

    return stateValue ?? "";
  }

  private readStringAttribute(entity: HassEntity, key: string): string | undefined {
    const value = entity.attributes[key];
    if (typeof value !== "string") {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed || undefined;
  }

  private optionEquals(left: string, right: string): boolean {
    if (left === right) {
      return true;
    }

    const normalizedLeft = left.trim().toLowerCase();
    const normalizedRight = right.trim().toLowerCase();
    return normalizedLeft === normalizedRight;
  }

  private sortedEqual(left: string[], right: string[]): boolean {
    if (left.length !== right.length) {
      return false;
    }

    const normalize = (list: string[]): string[] =>
      list.map((item) => item.trim().toLowerCase()).sort();
    const normalizedLeft = normalize(left);
    const normalizedRight = normalize(right);
    return normalizedLeft.every((value, index) => value === normalizedRight[index]);
  }

  private arrangePresets(options: string[]): string[] {
    const order = this.config?.preset_order;
    if (!Array.isArray(order) || order.length === 0) {
      return options;
    }

    const baseline = this.config?.preset_baseline;
    if (Array.isArray(baseline) && baseline.length > 0 && !this.sortedEqual(baseline, options)) {
      // The device's set of presets changed since this order was saved — fall back to defaults.
      return options;
    }

    const arranged: string[] = [];
    const used = new Set<string>();
    for (const name of order) {
      const match = options.find((option) => !used.has(option) && this.optionEquals(option, name));
      if (match) {
        arranged.push(match);
        used.add(match);
      }
    }

    return arranged.length > 0 ? arranged : options;
  }

  private readLayoutPayload(
    screensEntity: HassEntity | undefined,
    layersEntity: HassEntity | undefined
  ): LayoutPayload | undefined {
    if (!screensEntity || !layersEntity) {
      this.logLayoutDebug("readLayoutPayload: missing screensEntity or layersEntity", {
        hasScreensEntity: Boolean(screensEntity),
        hasLayersEntity: Boolean(layersEntity)
      });
      return undefined;
    }

    const firstScreen = this.readFirstScreen(screensEntity);
    if (!firstScreen) {
      this.logLayoutDebug("readLayoutPayload: no screen found in screens entity");
      return undefined;
    }

    const screenWidth = this.readFiniteNumber(firstScreen.width ?? firstScreen.w);
    const screenHeight = this.readFiniteNumber(firstScreen.height ?? firstScreen.h);
    if (!screenWidth || !screenHeight || screenWidth <= 0 || screenHeight <= 0) {
      this.logLayoutDebug("readLayoutPayload: invalid screen dimensions", {
        screenWidth,
        screenHeight,
        firstScreen
      });
      return undefined;
    }

    const rawLayers = this.readLayersCollection(layersEntity);
    const layers: LayoutLayer[] = rawLayers
      .map((item, index) => this.normalizeLayoutLayer(item, index))
      .filter((item): item is LayoutLayer => Boolean(item));

    this.logLayoutDebug("readLayoutPayload: parsed layers summary", {
      rawLayerCount: rawLayers.length,
      renderedLayerCount: layers.length,
      screenWidth,
      screenHeight
    });

    return {
      screenWidth,
      screenHeight,
      layers
    };
  }

  private readFirstScreen(entity: HassEntity): Record<string, unknown> | undefined {
    const candidates: unknown[] = [
      entity.state,
      entity.attributes.screens,
      entity.attributes.screen_list,
      entity.attributes.screen,
      entity.attributes.value,
      entity.attributes.data,
      entity.attributes.layout_json,
      entity.attributes.layout,
      entity.attributes.screen_layout
    ];

    for (const candidate of candidates) {
      const parsed = this.parseStructuredValue(candidate);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const firstEntry = this.asRecord(parsed[0]);
        if (firstEntry) {
          return firstEntry;
        }
      }

      const record = this.asRecord(parsed);
      if (!record) {
        continue;
      }

      const nestedScreens = record.screens;
      if (Array.isArray(nestedScreens) && nestedScreens.length > 0) {
        const firstNested = this.asRecord(nestedScreens[0]);
        if (firstNested) {
          return firstNested;
        }
      }

      if (this.readFiniteNumber(record.width ?? record.w) && this.readFiniteNumber(record.height ?? record.h)) {
        return record;
      }
    }

    if (this.readFiniteNumber(entity.attributes.width ?? entity.attributes.w)
      && this.readFiniteNumber(entity.attributes.height ?? entity.attributes.h)) {
      return entity.attributes;
    }

    return undefined;
  }

  private readLayersCollection(entity: HassEntity): unknown[] {
    const candidates: unknown[] = [
      entity.state,
      entity.attributes.layers,
      entity.attributes.layer_list,
      entity.attributes.value,
      entity.attributes.data,
      entity.attributes.layout_json,
      entity.attributes.layout,
      entity.attributes.screen_layout
    ];

    for (const candidate of candidates) {
      const parsed = this.parseStructuredValue(candidate);
      if (Array.isArray(parsed)) {
        return parsed;
      }

      const record = this.asRecord(parsed);
      if (!record) {
        continue;
      }

      if (Array.isArray(record.layers)) {
        return record.layers;
      }

      if (Array.isArray(record.layer_list)) {
        return record.layer_list;
      }

      const resultRecord = this.asRecord(record.result);
      if (resultRecord && Array.isArray(resultRecord.layers)) {
        return resultRecord.layers;
      }

      const dataRecord = this.asRecord(record.data);
      if (dataRecord && Array.isArray(dataRecord.layers)) {
        return dataRecord.layers;
      }

      const objectMapLayers = Object.values(record)
        .map((item) => this.asRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .filter((item) => Boolean(this.asRecord(item.general)) && Boolean(this.asRecord(item.window)));
      if (objectMapLayers.length > 0) {
        return objectMapLayers;
      }

      if (this.asRecord(record.general) && this.asRecord(record.window)) {
        return [record];
      }
    }

    return [];
  }

  private parseStructuredValue(value: unknown): unknown {
    if (typeof value !== "string") {
      return value;
    }

    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }

    return value as Record<string, unknown>;
  }

  private readFiniteNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return undefined;
  }

  private normalizeLayoutLayer(value: unknown, index: number): LayoutLayer | undefined {
    const layer = this.asRecord(value);
    if (!layer) {
      this.logLayoutDebug("normalizeLayoutLayer: skipped - layer is not an object", { index, value });
      return undefined;
    }

    const general = this.asRecord(layer.general);
    const windowData = this.asRecord(layer.window);
    const audioStatus = this.asRecord(layer.audioStatus);

    if (!general || !windowData) {
      this.logLayoutDebug("normalizeLayoutLayer: skipped - missing general or window", {
        index,
        hasGeneral: Boolean(general),
        hasWindow: Boolean(windowData),
        layer
      });
      return undefined;
    }

    const width = this.readFiniteNumber(windowData.width);
    const height = this.readFiniteNumber(windowData.height);
    const x = this.readFiniteNumber(windowData.x) ?? 0;
    const y = this.readFiniteNumber(windowData.y) ?? 0;

    if (!width || !height || width <= 0 || height <= 0) {
      this.logLayoutDebug("normalizeLayoutLayer: skipped - invalid dimensions", {
        index,
        width,
        height,
        windowData
      });
      return undefined;
    }

    const layerId = general.layerId;
    if (typeof layerId !== "string" && typeof layerId !== "number") {
      this.logLayoutDebug("normalizeLayoutLayer: skipped - invalid layerId", {
        index,
        layerId,
        general
      });
      return undefined;
    }

    const zValue = this.readFiniteNumber(general.zorder);
    if (zValue === undefined) {
      this.logLayoutDebug("normalizeLayoutLayer: skipped - invalid zorder", {
        index,
        zorder: general.zorder,
        general
      });
      return undefined;
    }

    const source = typeof general.name === "string"
      ? general.name
      : undefined;
    const audioOpen = audioStatus?.isOpen === undefined
      ? undefined
      : Boolean(audioStatus.isOpen);

    this.logLayoutDebug("normalizeLayoutLayer: accepted", {
      index,
      layerId,
      x,
      y,
      width,
      height,
      zValue,
      source,
      audioOpen
    });

    return {
      id: String(layerId),
      x,
      y,
      width,
      height,
      z: zValue,
      source,
      audioOpen
    };
  }

  private isLayoutDebugEnabled(): boolean {
    return this.config?.debug_layout === true;
  }

  private logLayoutDebug(message: string, data?: unknown): void {
    if (!this.isLayoutDebugEnabled()) {
      return;
    }

    if (data === undefined) {
      console.debug("[NovastarCard][layout]", message);
      return;
    }

    console.debug("[NovastarCard][layout]", message, data);
  }

  private buildRelevantStateSignature(hass: HomeAssistant | undefined): string {
    if (!hass) {
      return "";
    }

    const ids = new Set<string>();
    const trackedKeys: Array<keyof ResolvedEntityMap> = [
      "power_entity",
      "preset_entity",
      "screens_entity",
      "layers_entity",
      "controller_entity",
      "status_entity",
      "brightness_entity",
      "temperature_entity"
    ];

    for (const key of trackedKeys) {
      const configuredId = this.config?.[key];
      if (configuredId) {
        ids.add(configuredId);
      }

      const resolvedId = this.resolvedEntities[key];
      if (resolvedId) {
        ids.add(resolvedId);
      }
    }

    ids.add("switch.novastar_h2_power_screen_output");

    const layerPattern = /^select\..*_layer_\d+_source$/;
    for (const entityId of Object.keys(hass.states)) {
      if (layerPattern.test(entityId)) {
        ids.add(entityId);
      }
    }

    const signatureParts = Array.from(ids)
      .sort()
      .map((entityId) => {
        const entity = hass.states[entityId];
        if (!entity) {
          return `${entityId}:missing`;
        }

        const options = this.readStringListAttribute(entity, "options").join("|");
        const currentOption = this.readStringAttribute(entity, "current_option") ?? "";
        const selectedOption = this.readStringAttribute(entity, "selected_option") ?? "";
        const source = this.readStringAttribute(entity, "source") ?? "";
        const currentSource = this.readStringAttribute(entity, "current_source") ?? "";
        return `${entityId}:${entity.state}:${options}:${currentOption}:${selectedOption}:${source}:${currentSource}`;
      });

    return signatureParts.join("||");
  }

  private reloadLayerSources(): void {
    this.resolvedLayerSourceEntities = [];
    this.resolvedDeviceId = undefined;
    this.resolvingDeviceId = undefined;
    this.requestUpdate();
  }

  private async waitFor(milliseconds: number): Promise<void> {
    await new Promise<void>((resolve) => {
      window.setTimeout(() => resolve(), milliseconds);
    });
  }

  private getLayerSourceRows(): LayerSourceRow[] {
    if (!this.hass) {
      return [];
    }

    return this.getLayerSourceEntityIds()
      .map((entityId) => ({ entityId, entity: this.hass?.states[entityId] }))
      .filter((row): row is { entityId: string; entity: HassEntity } => Boolean(row.entity))
      .map((row) => {
        const options = this.readStringListAttribute(row.entity, "options");
        return {
          ...row,
          options,
          layerNumber: this.getLayerNumber(row.entityId)
        };
      })
      .filter((row) => row.options.length > 0 && row.entity.state !== "unavailable" && row.entity.state !== "unknown")
      .sort((a, b) => a.layerNumber - b.layerNumber);
  }

  private getLayerSourceEntityIds(): string[] {
    const pattern = /^select\..*_layer_\d+_source$/;
    const resolvedIds = this.resolvedLayerSourceEntities;
    const liveIds = this.hass
      ? Object.keys(this.hass.states).filter((entityId) => pattern.test(entityId))
      : [];

    if (resolvedIds.length === 0) {
      return liveIds;
    }

    if (liveIds.length === 0) {
      return resolvedIds;
    }

    return Array.from(new Set([...resolvedIds, ...liveIds]));
  }

  private getLayerNumber(entityId: string): number {
    const match = entityId.match(/_layer_(\d+)_source$/);
    if (!match) {
      return Number.MAX_SAFE_INTEGER;
    }

    const layerNumber = Number.parseInt(match[1], 10);
    return Number.isFinite(layerNumber) ? layerNumber : Number.MAX_SAFE_INTEGER;
  }

  private async handleBrightnessChanged(event: Event): Promise<void> {
    if (!this.hass) {
      return;
    }

    const powerEntityId = this.getEntityId("power_entity") ?? "switch.novastar_h2_power_screen_output";
    const powerEntity = this.hass.states[powerEntityId];
    if (powerEntity && powerEntity.state !== "on") {
      return;
    }

    const brightnessEntityId = this.getEntityId("brightness_entity");
    if (!brightnessEntityId) {
      return;
    }

    const target = event.target as HTMLInputElement;
    const nextValue = Number.parseFloat(target.value);
    if (!Number.isFinite(nextValue)) {
      return;
    }

    await this.hass.callService?.("number", "set_value", {
      entity_id: brightnessEntityId,
      value: nextValue
    });
  }

  private async handlePowerToggle(): Promise<void> {
    if (!this.hass) {
      return;
    }

    const powerEntityId = this.getEntityId("power_entity") ?? "switch.novastar_h2_power_screen_output";
    const powerEntity = this.hass.states[powerEntityId];
    if (!powerEntity) {
      return;
    }

    const currentState = this.optimisticPowerState ?? powerEntity.state;
    const isOn = currentState !== "on";
    this.optimisticPowerState = isOn ? "on" : "off";
    this.requestUpdate();

    const service = isOn ? "turn_on" : "turn_off";
    try {
      await this.hass.callService?.("switch", service, {
        entity_id: powerEntityId
      });
    } catch {
      this.optimisticPowerState = undefined;
      this.requestUpdate();
    }
  }

  private async handlePresetButtonClick(option: string): Promise<void> {
    if (!this.hass) {
      return;
    }

    const presetEntityId = this.getEntityId("preset_entity");
    const nextOption = option.trim();
    if (!presetEntityId || !nextOption) {
      return;
    }

    await this.hass.callService?.("select", "select_option", {
      entity_id: presetEntityId,
      option: nextOption
    });

    this.reloadLayerSources();
    await this.waitFor(350);
    this.reloadLayerSources();
  }

  private async selectLayerSourceOption(entityId: string, option: string): Promise<void> {
    if (!this.hass) {
      return;
    }

    await this.hass.callService?.("select", "select_option", {
      entity_id: entityId,
      option
    });
  }

  private syncOptimisticPowerState(): void {
    if (!this.hass || !this.optimisticPowerState) {
      return;
    }

    const powerEntityId = this.getEntityId("power_entity") ?? "switch.novastar_h2_power_screen_output";
    const powerEntity = this.hass.states[powerEntityId];
    if (!powerEntity) {
      this.optimisticPowerState = undefined;
      return;
    }

    if (powerEntity.state === this.optimisticPowerState) {
      this.optimisticPowerState = undefined;
    }
  }

  private getEntityId(key: keyof ResolvedEntityMap): string | undefined {
    const configuredValue = this.config?.[key];
    if (configuredValue && configuredValue.trim()) {
      return configuredValue;
    }

    const resolvedValue = this.resolvedEntities[key];
    if (resolvedValue && resolvedValue.trim()) {
      return resolvedValue;
    }

    return undefined;
  }

  private async ensureResolvedEntities(): Promise<void> {
    if (!this.hass || !this.config) {
      return;
    }

    const deviceId = this.config.device_id?.trim();
    if (!deviceId) {
      if (this.resolvedDeviceId || Object.keys(this.resolvedEntities).length > 0) {
        this.resolvedEntities = {};
        this.resolvedLayerSourceEntities = [];
        this.resolvedDeviceId = undefined;
        this.resolvedForHass = undefined;
        this.requestUpdate();
      }
      return;
    }

    if (!this.hass.callWS) {
      return;
    }

    if (this.resolvingDeviceId === deviceId) {
      return;
    }

    if (this.resolvedDeviceId === deviceId && this.resolvedForHass === this.hass) {
      return;
    }

    this.resolvingDeviceId = deviceId;
    try {
      const registry = await this.hass.callWS({ type: "config/entity_registry/list" });
      if (!Array.isArray(registry)) {
        return;
      }

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

      const layerPattern = /^select\..*_layer_\d+_source$/;
      const layerSourceEntities = entityIds
        .filter((entityId) => layerPattern.test(entityId))
        .sort((a, b) => this.getLayerNumber(a) - this.getLayerNumber(b));

      const nextResolved: ResolvedEntityMap = {
        power_entity: this.pickEntity(entityIds, [/_power_screen_output$/, /_screen_output$/], ["switch"]),
        preset_entity: this.pickEntity(entityIds, [/_preset$/, /_layer_\d+_source$/], ["select"]),
        screens_entity: this.pickEntity(entityIds, [/_screens$/], ["sensor"]),
        layers_entity: this.pickEntity(entityIds, [/_layers$/], ["sensor"]),
        controller_entity: this.pickEntity(entityIds, [/_device_status$/], ["sensor"]),
        status_entity: this.pickEntity(entityIds, [/_signal_status$/], ["sensor"]),
        brightness_entity: this.pickEntity(entityIds, [/_brightness$/], ["number", "sensor"]),
        temperature_entity: this.pickEntity(entityIds, [/_temperature_status$/, /_temp_status$/], ["sensor"])
      };

      nextResolved.controller_entity ||= this.pickEntity(entityIds, [/^media_player\./], ["media_player"]);
      nextResolved.controller_entity ||= this.pickEntity(entityIds, [/_status$/], ["sensor"]);

      this.resolvedEntities = nextResolved;
      this.resolvedLayerSourceEntities = layerSourceEntities;
      this.resolvedDeviceId = deviceId;
      this.resolvedForHass = this.hass;
      this.requestUpdate();
    } catch {
    } finally {
      if (this.resolvingDeviceId === deviceId) {
        this.resolvingDeviceId = undefined;
      }
    }
  }

  private pickEntity(entityIds: string[], patterns: RegExp[], domains: string[]): string | undefined {
    for (const pattern of patterns) {
      const patternMatch = entityIds.find((entityId) => pattern.test(entityId));
      if (patternMatch) {
        return patternMatch;
      }
    }

    for (const domain of domains) {
      const domainPrefix = `${domain}.`;
      const domainMatch = entityIds.find((entityId) => entityId.startsWith(domainPrefix));
      if (domainMatch) {
        return domainMatch;
      }
    }

    return undefined;
  }
}


try {
  customElements.define(NOVASTAR_CARD_TYPE, TedNovastarCard);
} catch {
}

registerCustomCard({
  type: NOVASTAR_CARD_TYPE,
  name: NOVASTAR_CARD_NAME,
  description: NOVASTAR_CARD_DESCRIPTION,
  preview: true,
  documentationURL: "https://github.com/tedr91/Teds-Cards-Devices#ted-novastar-h-card",
  getEntitySuggestion: (_hass, entityId) =>
    entityId.startsWith("sensor.") && entityId.includes("novastar")
      ? { config: { type: "custom:ted-novastar-card", controller_entity: entityId } }
      : null
});
