import { LitElement, css, html, nothing, svg } from "lit";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";
import {
  isCbiAvailable,
  resolveIconRef,
  resolveSourceIcon,
  type SourceIconFacet,
  type SourceIconMode
} from "../../shared/brand-icons";
import { brushedOverlay, tedCardThemeClass, tedStyleTheme } from "../../shared/theme";
import { BRANDS, CUSTOM_BRAND_ID, getBrandArt } from "./brands";
import type { TedStyleTheme } from "../../shared/types";
import { registerCustomCard } from "../../shared/register-card";
import { VERSION } from "../../shared/const";

type HassEntity = {
  state: string;
  attributes: Record<string, unknown>;
};

type HomeAssistant = {
  states: Record<string, HassEntity>;
  callService?: (domain: string, service: string, serviceData?: Record<string, unknown>) => Promise<void>;
  callWS?: (message: Record<string, unknown>) => Promise<unknown>;
  fetchWithAuth?: (path: string, init?: RequestInit) => Promise<Response>;
};

type ThemeMode = TedStyleTheme;

type SourceLabelMode = "unknown" | "always" | "off";

type TedAvReceiverCardConfig = {
  type: string;
  header?: string;
  show_name?: boolean;
  brand?: string;
  logo_scale?: number;
  custom_logo?: string;
  theme?: ThemeMode;
  brushed?: boolean;
  rocker?: boolean;
  device_id?: string;
  media_player_entity?: string;
  source_entity?: string;
  sound_mode_entity?: string;
  active_speakers_entity?: string;
  source_icons?: SourceIconMode;
  source_labels?: SourceLabelMode;
  source_order?: string[];
  source_baseline?: string[];
  show_display?: boolean;
  show_volume_buttons?: boolean;
  show_sources?: boolean;
  show_status?: boolean;
  show_volume?: boolean;
  section_order?: string[];
  status_order?: string[];
  max_rows?: number;
  show_card_version?: boolean;
};

type ResolvedEntityMap = {
  media_player_entity?: string;
  source_entity?: string;
  sound_mode_entity?: string;
  active_speakers_entity?: string;
};

const DENON_DOMAIN = "denon_marantz";

const CARD_VERSION = VERSION;

// The card's reorderable content sections. The order shown here is the default;
// the user can rearrange them in the editor (persisted as `section_order`), and
// the card renders them in that order.
type SectionId = "display" | "sources";

const SECTION_DEFS: Array<{ id: SectionId; label: string; icon: string }> = [
  { id: "sources", label: "Input sources", icon: "mdi:import" },
  { id: "display", label: "Front panel display", icon: "mdi:monitor-dashboard" }
];

const DEFAULT_SECTION_ORDER: SectionId[] = SECTION_DEFS.map((section) => section.id);

// Normalize a configured section order to always contain every known section
// exactly once: keep configured ids that are valid, then append any missing in
// their default order. Guarantees no section is ever dropped.
function orderSections(configured: string[] | undefined): SectionId[] {
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
type StatusItemId = "status" | "volume";

const STATUS_ITEM_DEFS: Array<{ id: StatusItemId; label: string; icon: string }> = [
  { id: "status", label: "Status icon", icon: "mdi:lan-connect" },
  { id: "volume", label: "Volume", icon: "mdi:volume-high" }
];

const DEFAULT_STATUS_ORDER: StatusItemId[] = STATUS_ITEM_DEFS.map((item) => item.id);

function orderStatusItems(configured: string[] | undefined): StatusItemId[] {
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

// Canonical channel-code order used by the integration's active_speakers sensor
// (matches its CHANNEL_MAP). The sensor reports only the channels active for the
// current surround mode; the display shows those exact codes, sorted by this
// order so the readout stays stable.
const CHANNEL_ORDER = [
  "FL", "FR", "C", "SW", "SW2", "SW3", "SW4", "SL", "SR", "SBL", "SBR", "SB",
  "FHL", "FHR", "FWL", "FWR", "TFL", "TFR", "TML", "TMR", "TRL", "TRR",
  "RHL", "RHR", "FDL", "FDR", "SDL", "SDR", "BDL", "BDR", "SHL", "SHR", "TS", "CH"
];

// Press-and-hold timing for the volume +/- buttons: after holding past
// VOLUME_HOLD_MS the step repeats every VOLUME_REPEAT_MS until release.
const VOLUME_HOLD_MS = 500;
const VOLUME_REPEAT_MS = 250;

export class TedAvReceiverCard extends LitElement {
  private _hass?: HomeAssistant;

  private config?: TedAvReceiverCardConfig;
  private optimisticPowerState?: "on" | "off";
  private resolvedEntities: ResolvedEntityMap = {};
  private resolvedDeviceId?: string;
  private resolvingDeviceId?: string;
  private resolvedForHass?: HomeAssistant;
  private lastRelevantStateSignature = "";
  private headerVolumeClickTimer?: number;
  private headerVolumeClosedAt = 0;
  private headerVolumeDragPercent?: number;
  private volumeRockerPressed?: "up" | "down";
  private volumeHoldTimer?: number;
  private volumeHoldRepeat?: number;
  private suppressVolumeClick = false;
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
      // requestUpdate() with no arguments so our signature-based change detection
      // is authoritative (it also covers the case where Home Assistant reuses the
      // hass object reference).
      this.requestUpdate();
    }
  }

  public setConfig(config: TedAvReceiverCardConfig): void {
    const nextConfig: TedAvReceiverCardConfig = { ...config };
    nextConfig.type ||= "custom:ted-av-receiver-card";
    this.config = nextConfig;
  }

  public getCardSize(): number {
    return 3;
  }

  public static async getConfigElement(): Promise<HTMLElement> {
    return document.createElement("ted-av-receiver-card-editor");
  }

  // Device defaulting happens exactly once: here, when the card is first added
  // from the picker. Resolve the first Denon/Marantz device so the card works
  // out of the box. Any failure falls back to the bare stub (no device), and the
  // editor never re-defaults afterwards.
  public static async getStubConfig(hass?: HomeAssistant): Promise<TedAvReceiverCardConfig> {
    const stub: TedAvReceiverCardConfig = {
      type: "custom:ted-av-receiver-card",
      header: "Denon Marantz AVR"
    };

    if (!hass?.callWS) {
      return stub;
    }

    try {
      const registry = await hass.callWS({ type: "config/entity_registry/list" });
      if (!Array.isArray(registry)) {
        return stub;
      }

      const firstDenonDeviceId = registry
        .filter((entry) => {
          if (!entry || typeof entry !== "object") {
            return false;
          }

          const item = entry as Record<string, unknown>;
          return item.platform === DENON_DOMAIN
            && typeof item.device_id === "string"
            && !item.disabled_by
            && !item.hidden_by;
        })
        .map((entry) => (entry as Record<string, unknown>).device_id as string)[0];

      if (firstDenonDeviceId) {
        stub.device_id = firstDenonDeviceId;
      }
    } catch {
    }

    return stub;
  }

  private sourceChooserOpen = false;
  private sourceAnchorRect?: DOMRect;

  protected updated(): void {
    void this.ensureResolvedEntities();
    this.syncOptimisticPowerState();
    this.syncSourceChooser();
  }

  private syncSourceChooser(): void {
    const root = this.renderRoot as ShadowRoot;
    const popover = root.getElementById("ted-source-popover") as (HTMLElement & { showPopover?: () => void }) | null;
    if (popover && this.sourceChooserOpen && !popover.matches(":popover-open")) {
      popover.showPopover?.();
      this.positionChooserPopover(popover, this.sourceAnchorRect);
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

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.headerVolumeClickTimer !== undefined) {
      window.clearTimeout(this.headerVolumeClickTimer);
      this.headerVolumeClickTimer = undefined;
    }
    this.cancelVolumeHold();
  }

  private buildRelevantStateSignature(hass: HomeAssistant | undefined): string {
    if (!hass) {
      return "";
    }

    const ids = new Set<string>();
    const trackedKeys: Array<keyof ResolvedEntityMap> = [
      "media_player_entity",
      "source_entity",
      "sound_mode_entity",
      "active_speakers_entity"
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

    const signatureParts = Array.from(ids)
      .sort()
      .map((entityId) => {
        const entity = hass.states[entityId];
        if (!entity) {
          return `${entityId}:missing`;
        }

        const volume = this.readNumberAttribute(entity, "volume_level", Number.NaN);
        const muted = entity.attributes.is_volume_muted === true ? "1" : "0";
        const source = this.readStringAttribute(entity, "source") ?? "";
        const sourceList = this.readStringListAttribute(entity, "source_list").join("|");
        const options = this.readStringListAttribute(entity, "options").join("|");
        const layout = this.readStringAttribute(entity, "layout") ?? "";
        const channels = this.readStringListAttribute(entity, "channels").join("|");
        return `${entityId}:${entity.state}:${volume}:${muted}:${source}:${sourceList}:${options}:${layout}:${channels}`;
      });

    return signatureParts.join("||");
  }

  protected render() {
    if (!this.config) {
      return html`<ha-card><div class="content">Invalid card configuration.</div></ha-card>`;
    }

    if (!this.hass) {
      return html`<ha-card><div class="content">Home Assistant context is unavailable.</div></ha-card>`;
    }

    const mediaPlayerId = this.getEntityId("media_player_entity");
    if (!mediaPlayerId) {
      const loadingMessage = this.config.device_id && this.resolvingDeviceId === this.config.device_id
        ? "Resolving entities for selected device..."
        : "Set a device or media_player entity in the card configuration.";
      return html`<ha-card><div class="content">${loadingMessage}</div></ha-card>`;
    }

    const mediaPlayer = this.hass.states[mediaPlayerId];
    if (!mediaPlayer) {
      return html`<ha-card><div class="content">Entity not found: ${mediaPlayerId}</div></ha-card>`;
    }

    const themeMode = this.getThemeMode();
    const powerState = this.optimisticPowerState ?? mediaPlayer.state;
    const powerIsOn = !["off", "standby", "unavailable", "unknown", ""].includes(powerState);
    const controlsDisabled = !powerIsOn;

    const headerText = this.config.header
      ?? this.readStringAttribute(mediaPlayer, "friendly_name")
      ?? "Denon Marantz AVR";

    const volumeLevel = this.readNumberAttribute(mediaPlayer, "volume_level", Number.NaN);
    const hasVolume = Number.isFinite(volumeLevel);
    const muted = mediaPlayer.attributes.is_volume_muted === true;

    const sourceEntity = this.getResolvedEntity("source_entity");
    const sourceOptions = sourceEntity
      ? this.readStringListAttribute(sourceEntity, "options")
      : this.readStringListAttribute(mediaPlayer, "source_list");
    const arrangedSources = this.arrangeSources(sourceOptions);
    const sourceOverflow = this.splitByMaxRows(arrangedSources).overflow;
    const currentSource = (sourceEntity ? sourceEntity.state : this.readStringAttribute(mediaPlayer, "source")) ?? "";

    const showSources = powerIsOn && this.config.show_sources !== false && arrangedSources.length > 0;
    const showDisplay = this.config.show_display !== false;
    const showVolumeButtons = showDisplay && this.config.show_volume_buttons !== false;

    const sectionOrder = orderSections(this.config.section_order);
    const renderSection = (id: SectionId) => {
      if (id === "display") {
        return showDisplay || showVolumeButtons
          ? this.renderDisplayRow(mediaPlayer, powerIsOn, volumeLevel, muted, currentSource, showDisplay, showVolumeButtons)
          : nothing;
      }
      return showSources
        ? this.renderSourceArea(arrangedSources, currentSource, controlsDisabled, this.getSourceIconMode(), this.getSourceLabelMode())
        : nothing;
    };

    const statusOrder = orderStatusItems(this.config.status_order);
    const showStatusIcon = this.config.show_status !== false;
    const showVolume = hasVolume && this.config.show_volume !== false;
    const renderStatusItem = (id: StatusItemId) => {
      if (id === "status") {
        return showStatusIcon
          ? html`
              <div class="header-status">
                <span
                  class="status-dot ${powerIsOn ? "status-dot--on" : "status-dot--off"}"
                  title=${powerIsOn ? "On" : "Off"}
                ></span>
              </div>
            `
          : nothing;
      }
      return showVolume ? this.renderHeaderVolume(volumeLevel, muted, controlsDisabled) : nothing;
    };

    return html`
      <ha-card class="ted-card ${tedCardThemeClass(themeMode)} ${powerIsOn ? "is-on" : "is-off"}">
        ${this.config.brushed !== false ? brushedOverlay : nothing}
        <div class="header-row">
          <div class="header-lead">
            ${this.renderBrandLogo()}
            ${this.config.show_name !== false ? html`<div class="header">${headerText}</div>` : nothing}
          </div>
          <div class="header-actions">
            ${statusOrder.map((id) => renderStatusItem(id))}
            ${this.renderPowerButton(powerIsOn)}
          </div>
        </div>
        <div class="content">
          ${sectionOrder.map((id) => renderSection(id))}
          ${this.config.show_card_version === true ? this.renderVersionFooter() : nothing}
        </div>
        ${this.sourceChooserOpen && sourceOverflow.length > 0
          ? this.renderSourceChooser(sourceOverflow, currentSource, controlsDisabled)
          : nothing}
      </ha-card>
    `;
  }

  private getThemeMode(): ThemeMode {
    return this.config?.theme === "ha" ? "ha" : "ted-style";
  }

  // Render the brand logo to the left of the header name. Built-in brands
  // (Denon/Marantz) reuse the card's monochrome inline SVG art and recolor
  // themselves to the header text color via `currentColor`, so they adapt to
  // light/dark themes with no extra files. The "Custom" brand instead renders a
  // user-uploaded image via <img>.
  private renderBrandLogo() {
    const brandId = this.config?.brand?.trim();
    if (!brandId) {
      return nothing;
    }

    const logoStyle = `--brand-logo-scale:${this.getLogoScale()}`;

    if (brandId === CUSTOM_BRAND_ID) {
      const url = this.config?.custom_logo?.trim();
      if (!url || this.failedLogoSrcs.has(url)) {
        return nothing;
      }
      return html`<img
        class="brand-logo brand-logo--custom"
        style=${logoStyle}
        src=${url}
        alt=""
        @error=${() => this.handleBrandLogoError(url)}
      />`;
    }

    const art = getBrandArt(brandId);
    if (!art) {
      return nothing;
    }

    return html`<svg
      class="brand-logo"
      style=${logoStyle}
      viewBox=${art.viewBox ?? "0 0 24 24"}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-hidden="true"
    >${art.paths.map((d) => svg`<path d=${d} fill="currentColor"></path>`)}</svg>`;
  }

  // Brand logo size multiplier (1 = 100%). Clamped to a sane range.
  private getLogoScale(): number {
    const raw = Number(this.config?.logo_scale);
    if (!Number.isFinite(raw)) {
      return 1;
    }
    return Math.min(200, Math.max(50, raw)) / 100;
  }

  private handleBrandLogoError(src: string): void {
    if (this.failedLogoSrcs.has(src)) {
      return;
    }
    this.failedLogoSrcs.add(src);
    this.requestUpdate();
  }

  private renderDisplayRow(
    mediaPlayer: HassEntity,
    powerIsOn: boolean,
    volumeLevel: number,
    muted: boolean,
    currentSource: string,
    showDisplay: boolean,
    showVolumeButtons: boolean
  ) {
    return html`
      <div class="display-row">
        ${showDisplay ? this.renderDisplayPanel(mediaPlayer, powerIsOn, volumeLevel, muted, currentSource) : nothing}
        ${showVolumeButtons ? this.renderVolumeStepper(!powerIsOn) : nothing}
      </div>
    `;
  }

  private renderDisplayPanel(
    _mediaPlayer: HassEntity,
    powerIsOn: boolean,
    volumeLevel: number,
    muted: boolean,
    currentSource: string
  ) {
    const soundModeEntity = this.getResolvedEntity("sound_mode_entity");
    const soundModeState = soundModeEntity?.state ?? "";
    const soundMode = ["", "unknown", "unavailable"].includes(soundModeState) ? "" : soundModeState;

    const activeSpeakersEntity = this.getResolvedEntity("active_speakers_entity");
    const layout = activeSpeakersEntity ? this.readStringAttribute(activeSpeakersEntity, "layout") : undefined;
    const channels = this.readStringListAttribute(activeSpeakersEntity, "channels");

    const volume = this.formatVolumeReadout(volumeLevel);
    const source = currentSource || "\u2014";

    return html`
      <div class="display-panel ${powerIsOn ? "" : "display-panel--off"}">
        <div class="display-volume">
          ${muted
            ? html`<span class="display-volume-muted">MUTED</span>`
            : html`${volume.whole}<span class="display-volume-frac">${volume.frac}</span>`}
        </div>
        <div class="display-source" title=${source}>${powerIsOn ? source : "Standby"}</div>
        <div class="display-bottom">
          ${powerIsOn && (soundMode || layout)
            ? html`
                <div class="display-meta">
                  ${soundMode ? html`<span class="display-soundmode">${soundMode}</span>` : nothing}
                  ${layout ? html`<span class="display-layout">${layout}</span>` : nothing}
                </div>
              `
            : nothing}
          ${powerIsOn && channels.length > 0 ? this.renderSpeakerMatrix(channels) : nothing}
        </div>
      </div>
    `;
  }

  private formatVolumeReadout(volumeLevel: number): { whole: string; frac: string } {
    if (!Number.isFinite(volumeLevel)) {
      return { whole: "\u2013\u2013", frac: "" };
    }
    const raw = Math.max(0, Math.min(100, volumeLevel * 100));
    const half = Math.round(raw * 2) / 2;
    const whole = Math.floor(half);
    return { whole: String(whole), frac: half - whole >= 0.5 ? ".5" : ".0" };
  }

  // Render the channels the integration reports as active, using their real codes
  // (FL, C, SBL, SW, FHL, ...) sorted into the canonical order. The sensor only
  // returns active channels, so every chip shown is lit.
  private renderSpeakerMatrix(channels: string[]) {
    const codes = Array.from(
      new Set(channels.map((code) => code.trim().toUpperCase()).filter(Boolean))
    ).sort((a, b) => {
      const ia = CHANNEL_ORDER.indexOf(a);
      const ib = CHANNEL_ORDER.indexOf(b);
      return (ia < 0 ? CHANNEL_ORDER.length : ia) - (ib < 0 ? CHANNEL_ORDER.length : ib);
    });

    if (codes.length === 0) {
      return nothing;
    }

    return html`
      <div class="display-matrix" role="img" aria-label="Active speakers">
        ${codes.map((code) => html`<span class="spk-chip">${code}</span>`)}
      </div>
    `;
  }

  private renderVolumeStepper(disabled: boolean) {
    const rockerEnabled = this.config?.rocker === true;
    // Decora-style tilt-on-press: pressing the top button depresses the top
    // half (bottom appears raised → `is-bottom`); pressing the bottom raises
    // the top (default). No overlay while idle.
    const rocker = rockerEnabled && this.volumeRockerPressed
      ? html`<div
          class="ted-rocker${this.volumeRockerPressed === "up" ? " is-bottom" : ""}"
          aria-hidden="true"
        ></div>`
      : nothing;
    return html`
      <div class="volume-stepper">
        ${rocker}
        <button
          type="button"
          class="volume-stepper-button"
          aria-label="Volume up"
          title="Volume up"
          ?disabled=${disabled}
          @pointerdown=${(e: PointerEvent) => this.onVolumeButtonDown(e, "up")}
          @pointerup=${this.onVolumeButtonUp}
          @pointerleave=${this.onVolumeButtonUp}
          @pointercancel=${this.onVolumeButtonUp}
          @contextmenu=${(e: Event) => e.preventDefault()}
          @click=${() => this.handleVolumeClick("up")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"></path></svg>
        </button>
        <span class="volume-stepper-divider"></span>
        <button
          type="button"
          class="volume-stepper-button"
          aria-label="Volume down"
          title="Volume down"
          ?disabled=${disabled}
          @pointerdown=${(e: PointerEvent) => this.onVolumeButtonDown(e, "down")}
          @pointerup=${this.onVolumeButtonUp}
          @pointerleave=${this.onVolumeButtonUp}
          @pointercancel=${this.onVolumeButtonUp}
          @contextmenu=${(e: Event) => e.preventDefault()}
          @click=${() => this.handleVolumeClick("down")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 11h14v2H5z"></path></svg>
        </button>
      </div>
    `;
  }

  // Drive the volume rocker tilt through reactive state + requestUpdate() so lit
  // re-renders the overlay; never mutate the lit-owned DOM imperatively.
  private setVolumeRockerPressed(direction: "up" | "down"): void {
    if (this.config?.rocker !== true || this.volumeRockerPressed === direction) {
      return;
    }
    this.volumeRockerPressed = direction;
    this.requestUpdate();
  }

  private clearVolumeRockerPressed = (): void => {
    if (this.volumeRockerPressed === undefined) {
      return;
    }
    this.volumeRockerPressed = undefined;
    this.requestUpdate();
  };

  private handleVolumeStep(direction: "up" | "down"): void {
    if (!this.hass) {
      return;
    }
    const mediaPlayerId = this.getEntityId("media_player_entity");
    if (!mediaPlayerId) {
      return;
    }
    const service = direction === "up" ? "volume_up" : "volume_down";
    void this.hass.callService?.("media_player", service, { entity_id: mediaPlayerId });
  }

  // Press-and-hold: a quick tap fires once via @click; holding past
  // VOLUME_HOLD_MS steps once then repeats every VOLUME_REPEAT_MS until release.
  // The trailing click after a hold is suppressed so it doesn't add an extra step.
  private onVolumeButtonDown(event: PointerEvent, direction: "up" | "down"): void {
    if (event.button > 0) {
      return; // ignore non-primary (e.g. right-click)
    }
    this.setVolumeRockerPressed(direction);
    const target = event.currentTarget as HTMLElement | null;
    try {
      target?.setPointerCapture(event.pointerId);
    } catch {
      /* pointer capture is best-effort */
    }
    this.cancelVolumeHold();
    this.volumeHoldTimer = window.setTimeout(() => {
      this.volumeHoldTimer = undefined;
      this.suppressVolumeClick = true;
      this.handleVolumeStep(direction);
      this.volumeHoldRepeat = window.setInterval(
        () => this.handleVolumeStep(direction),
        VOLUME_REPEAT_MS,
      );
    }, VOLUME_HOLD_MS);
  }

  private onVolumeButtonUp = (): void => {
    this.cancelVolumeHold();
    this.clearVolumeRockerPressed();
  };

  private cancelVolumeHold(): void {
    if (this.volumeHoldTimer !== undefined) {
      window.clearTimeout(this.volumeHoldTimer);
      this.volumeHoldTimer = undefined;
    }
    if (this.volumeHoldRepeat !== undefined) {
      window.clearInterval(this.volumeHoldRepeat);
      this.volumeHoldRepeat = undefined;
    }
  }

  private handleVolumeClick(direction: "up" | "down"): void {
    if (this.suppressVolumeClick) {
      this.suppressVolumeClick = false;
      return;
    }
    this.handleVolumeStep(direction);
  }

  private renderPowerButton(powerIsOn: boolean) {
    return html`
      <button
        type="button"
        class="power-button ${powerIsOn ? "power-button--on" : "power-button--off"}"
        role="switch"
        aria-checked=${powerIsOn ? "true" : "false"}
        aria-label="Toggle power"
        title="Toggle power"
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

  private renderVolumeIcon() {
    return html`
      <svg class="icon-button-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 9v6h4l5 5V4L7 9H3z"></path>
        <path
          d="M16 8.5a4 4 0 0 1 0 7"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        ></path>
        <path
          d="M18.5 6a7 7 0 0 1 0 12"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        ></path>
      </svg>
    `;
  }

  private renderMutedIcon() {
    return html`
      <svg class="icon-button-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 9v6h4l5 5V4L7 9H3z"></path>
        <path
          d="M16 9l5 5m0-5l-5 5"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        ></path>
      </svg>
    `;
  }

  // Max number of 5-wide rows of source buttons to show before an overflow "…"
  // button. Defaults to 1; 0 = unlimited (show every source).
  private getMaxRows(): number {
    const value = this.config?.max_rows;
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 1;
  }

  // Split a button list into visible buttons and overflow (hidden) ones, based on
  // max_rows (5-wide grid). When limited, the last visible cell is the "…" button.
  private splitByMaxRows(options: string[]): { visible: string[]; overflow: string[]; showMore: boolean } {
    const maxRows = this.getMaxRows();
    const limit = maxRows > 0 ? maxRows * 5 : Number.POSITIVE_INFINITY;
    const showMore = options.length > limit;
    return {
      visible: showMore ? options.slice(0, limit - 1) : options,
      overflow: showMore ? options.slice(limit - 1) : [],
      showMore
    };
  }

  private renderSourceArea(options: string[], selected: string, disabled: boolean, iconMode: SourceIconMode, labelMode: SourceLabelMode) {
    const cbiAvailable = iconMode === "off" ? false : isCbiAvailable();
    const { visible: visibleOptions, showMore } = this.splitByMaxRows(options);
    return html`
      <div class="source-grid" role="group" aria-label="Input source">
        ${visibleOptions.map((option) => {
          const isActive = this.optionEquals(option, selected);
          const showIcon = iconMode !== "off";
          const showLabel = this.shouldShowSourceLabel(option, iconMode, labelMode);
          const centered = !(showIcon && showLabel);
          return html`
            <button
              type="button"
              class="source-button ${isActive ? "source-button--active" : ""} ${centered ? "source-button--centered" : ""}"
              ?disabled=${disabled}
              aria-pressed=${isActive ? "true" : "false"}
              aria-label=${option}
              title=${option}
              @click=${() => this.handleSourceSelect(option)}
            >${showIcon ? this.renderSourceIcon(option, iconMode, cbiAvailable) : nothing}${showLabel ? html`<span class="source-button-label">${option.slice(0, 13)}</span>` : nothing}</button>
          `;
        })}
        ${showMore
          ? html`
              <button
                type="button"
                class="source-button source-button--more"
                ?disabled=${disabled}
                aria-haspopup="true"
                aria-expanded=${this.sourceChooserOpen ? "true" : "false"}
                aria-label="Show all sources"
                title="Show all sources"
                @click=${this.openSourceChooser}
              >
                <svg class="source-more-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M16 12a2 2 0 1 1 4 0 2 2 0 0 1-4 0zm-6 0a2 2 0 1 1 4 0 2 2 0 0 1-4 0zm-6 0a2 2 0 1 1 4 0 2 2 0 0 1-4 0z"></path>
                </svg>
              </button>
            `
          : nothing}
      </div>
    `;
  }

  private renderSourceChooser(options: string[], selected: string, disabled: boolean) {
    return html`
      <div
        id="ted-source-popover"
        class="ted-popover"
        popover
        @toggle=${this.handleSourcePopoverToggle}
      >
        <div class="ted-popover-title">Select Source</div>
        <div class="ted-popover-options">
          ${options.map((option) => html`
            <button
              type="button"
              class="ted-popover-option ${this.optionEquals(option, selected) ? "selected" : ""}"
              ?disabled=${disabled}
              @click=${() => this.handleSourceChooserOptionClick(option)}
            >${option}</button>
          `)}
        </div>
      </div>
    `;
  }

  private handleSourcePopoverToggle = (event: Event): void => {
    const toggleEvent = event as Event & { newState?: string };
    if (toggleEvent.newState === "closed" && this.sourceChooserOpen) {
      this.sourceChooserOpen = false;
      this.requestUpdate();
    }
  };

  private openSourceChooser = (event: Event): void => {
    const target = event.currentTarget as HTMLElement | null;
    this.sourceAnchorRect = target?.getBoundingClientRect();
    this.sourceChooserOpen = true;
    this.requestUpdate();
  };

  private async handleSourceChooserOptionClick(option: string): Promise<void> {
    this.sourceChooserOpen = false;
    this.requestUpdate();
    await this.handleSourceSelect(option);
  }

  private renderSourceIcon(label: string, mode: SourceIconMode, cbiAvailable: boolean) {
    const icon = resolveSourceIcon(label);
    const ref = resolveIconRef(icon, mode, cbiAvailable);

    if (ref.kind === "name") {
      const style = ref.tint ? `--icon-primary-color:${ref.tint};color:${ref.tint};` : "";
      return html`<ha-icon class="source-button-icon" icon=${ref.name} style=${style} aria-hidden="true"></ha-icon>`;
    }

    if (ref.kind === "rawsvg") {
      const style = ref.tint ? `color:${ref.tint};` : nothing;
      return html`<svg class="source-button-icon" viewBox=${ref.viewBox} style=${style} aria-hidden="true">${unsafeSVG(ref.raw)}</svg>`;
    }

    if (ref.render === "dither") {
      return this.renderDitheredIcon(icon.id, label, ref);
    }

    if (ref.render === "flat") {
      const style = ref.tint ? `color:${ref.tint};` : nothing;
      return html`
        <svg class="source-button-icon" viewBox=${ref.viewBox} style=${style} fill-rule="evenodd" aria-hidden="true">
          ${ref.facets.map((facet) => svg`<path d=${facet.d} fill="currentColor"></path>`)}
        </svg>
      `;
    }

    return html`
      <svg class="source-button-icon" viewBox=${ref.viewBox} fill-rule="evenodd" aria-hidden="true">
        ${ref.facets.map((facet) => svg`<path d=${facet.d} fill=${facet.fill}></path>`)}
      </svg>
    `;
  }

  // Monochrome mode keeps the multi-colour marks legible by translating each brand
  // colour into a halftone dither density (darkest colour = solid, lighter colours =
  // progressively sparser dots) painted in currentColor, so the three tones stay
  // distinct instead of collapsing into one flat shape.
  private renderDitheredIcon(iconId: string, label: string, ref: { facets: SourceIconFacet[]; viewBox: string }) {
    const ordered = Array.from(new Set(ref.facets.map((facet) => facet.fill)))
      .map((fill) => ({ fill, lum: TedAvReceiverCard.colorLuminance(fill) }))
      .sort((a, b) => a.lum - b.lum)
      .map((entry) => entry.fill);
    const toneOf = new Map(ordered.map((fill, index) => [fill, index]));
    const slug = `ksd-${iconId}-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

    return html`
      <svg class="source-button-icon" viewBox=${ref.viewBox} fill-rule="evenodd" aria-hidden="true">
        <defs>
          ${ordered.map((_, index) => this.renderDitherPattern(`${slug}-${index}`, index))}
        </defs>
        ${ref.facets.map((facet) => svg`<path d=${facet.d} fill=${`url(#${slug}-${toneOf.get(facet.fill) ?? 0})`}></path>`)}
      </svg>
    `;
  }

  private renderDitherPattern(id: string, tone: number) {
    if (tone <= 0) {
      return svg`<pattern id=${id} width="2" height="2" patternUnits="userSpaceOnUse"><rect width="2" height="2" fill="currentColor"></rect></pattern>`;
    }
    const cells = tone === 1 ? [[0, 0], [1, 1]] : [[1, 0]];
    return svg`<pattern id=${id} width="2" height="2" patternUnits="userSpaceOnUse">${cells.map(([x, y]) => svg`<rect x=${x} y=${y} width="1" height="1" fill="currentColor"></rect>`)}</pattern>`;
  }

  private static colorLuminance(hex: string): number {
    if (typeof hex !== "string" || hex.charAt(0) !== "#") {
      return 0;
    }
    const raw = hex.slice(1);
    const full = raw.length === 3 ? raw.split("").map((channel) => channel + channel).join("") : raw;
    const r = parseInt(full.slice(0, 2), 16) / 255;
    const g = parseInt(full.slice(2, 4), 16) / 255;
    const b = parseInt(full.slice(4, 6), 16) / 255;
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
      return 0;
    }
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  private getSourceIconMode(): SourceIconMode {
    const mode = this.config?.source_icons;
    if (mode === "monochrome" || mode === "off") {
      return mode;
    }
    return "color";
  }

  private getSourceLabelMode(): SourceLabelMode {
    const mode = this.config?.source_labels;
    if (mode === "always" || mode === "off") {
      return mode;
    }
    return "unknown";
  }

  private shouldShowSourceLabel(option: string, iconMode: SourceIconMode, labelMode: SourceLabelMode): boolean {
    // With no icon there is nothing else on the button, so always show the label.
    if (iconMode === "off") {
      return true;
    }
    if (labelMode === "always") {
      return true;
    }
    if (labelMode === "off") {
      return false;
    }
    // "unknown": only show the label when the source has no recognised icon.
    return resolveSourceIcon(option).id === "fallback";
  }

  private renderVersionFooter() {
    return html`<div class="version-footer">${CARD_VERSION}</div>`;
  }

  private getResolvedEntity(key: keyof ResolvedEntityMap): HassEntity | undefined {
    const entityId = this.getEntityId(key);
    if (!entityId || !this.hass) {
      return undefined;
    }
    return this.hass.states[entityId];
  }

  private async handlePowerToggle(): Promise<void> {
    if (!this.hass) {
      return;
    }

    const mediaPlayerId = this.getEntityId("media_player_entity");
    if (!mediaPlayerId) {
      return;
    }

    const mediaPlayer = this.hass.states[mediaPlayerId];
    const currentState = this.optimisticPowerState
      ?? (mediaPlayer ? mediaPlayer.state : "off");
    const isOn = ["off", "standby", "unavailable", "unknown", ""].includes(currentState);
    this.optimisticPowerState = isOn ? "on" : "off";
    this.requestUpdate();

    const service = isOn ? "turn_on" : "turn_off";
    try {
      await this.hass.callService?.("media_player", service, {
        entity_id: mediaPlayerId
      });
    } catch {
      this.optimisticPowerState = undefined;
      this.requestUpdate();
    }
  }

  private handleVolumeChanged = async (event: Event): Promise<void> => {
    if (!this.hass) {
      return;
    }

    const mediaPlayerId = this.getEntityId("media_player_entity");
    if (!mediaPlayerId) {
      return;
    }

    const input = event.target as HTMLInputElement;
    const percent = Number.parseFloat(input.value);
    if (!Number.isFinite(percent)) {
      return;
    }

    const level = Math.max(0, Math.min(1, percent / 100));
    await this.hass.callService?.("media_player", "volume_set", {
      entity_id: mediaPlayerId,
      volume_level: level
    });
  };

  private async handleMuteToggle(): Promise<void> {
    if (!this.hass) {
      return;
    }

    const mediaPlayerId = this.getEntityId("media_player_entity");
    if (!mediaPlayerId) {
      return;
    }

    const mediaPlayer = this.hass.states[mediaPlayerId];
    const currentlyMuted = mediaPlayer?.attributes.is_volume_muted === true;

    await this.hass.callService?.("media_player", "volume_mute", {
      entity_id: mediaPlayerId,
      is_volume_muted: !currentlyMuted
    });
  }

  private renderHeaderVolume(volumeLevel: number, muted: boolean, disabled: boolean) {
    const percent = Math.max(0, Math.min(100, Math.round(volumeLevel * 100)));
    // While the slider is being dragged we reflect the live value through reactive
    // state and a normal re-render. Never imperatively write to the lit-managed
    // readout node — doing so detaches the text node lit-html tracks, and the next
    // render throws ("Cannot set properties of null"), freezing the whole card.
    const livePercent = this.headerVolumeDragPercent ?? percent;
    const readout = muted ? "Muted" : `${livePercent}%`;
    return html`
      <button
        type="button"
        class="icon-button header-icon-button ${muted ? "icon-button--active" : ""}"
        id="ted-volume-anchor"
        aria-label=${muted ? "Muted" : "Volume"}
        title="Volume \u2014 double-tap to mute"
        ?disabled=${disabled}
        @click=${this.handleHeaderVolumeClick}
      >
        ${muted ? this.renderMutedIcon() : this.renderVolumeIcon()}
      </button>
      <div
        id="ted-volume-popover"
        class="volume-popover"
        popover="auto"
        @toggle=${this.handleVolumePopoverToggle}
      >
        <span class="volume-popover-value">${readout}</span>
        <input
          class="volume-slider-vertical ${muted ? "volume-slider-vertical--muted" : ""}"
          type="range"
          orient="vertical"
          min="0"
          max="100"
          step="1"
          style=${`--ted-style-fill:${livePercent}%`}
          .value=${String(livePercent)}
          .disabled=${disabled}
          ?disabled=${disabled}
          aria-label="Volume"
          @input=${this.handleHeaderVolumeInput}
          @change=${this.handleVolumeChanged}
        />
        <svg class="volume-popover-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 9v6h4l5 5V4L7 9H3z"></path>
          <path
            d="M16 8.5a4 4 0 0 1 0 7"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          ></path>
        </svg>
      </div>
    `;
  }

  private handleHeaderVolumeClick = (): void => {
    if (this.headerVolumeClickTimer !== undefined) {
      // A second tap within the window is a double-tap: mute/unmute instead of
      // opening the slider popover.
      window.clearTimeout(this.headerVolumeClickTimer);
      this.headerVolumeClickTimer = undefined;
      void this.handleMuteToggle();
      return;
    }
    this.headerVolumeClickTimer = window.setTimeout(() => {
      this.headerVolumeClickTimer = undefined;
      this.openHeaderVolumePopover();
    }, 220);
  };

  private openHeaderVolumePopover(): void {
    const root = this.renderRoot as ShadowRoot;
    const popover = root.getElementById("ted-volume-popover") as
      (HTMLElement & { showPopover?: () => void }) | null;
    if (!popover || popover.matches(":popover-open")) {
      return;
    }
    // If this same tap on the anchor just light-dismissed the popover, leave it closed.
    if (Date.now() - this.headerVolumeClosedAt < 350) {
      return;
    }
    popover.showPopover?.();
  }

  private handleVolumePopoverToggle = (event: Event): void => {
    const toggleEvent = event as Event & { newState?: string };
    if (toggleEvent.newState === "open") {
      this.positionHeaderVolumePopover();
    } else {
      this.headerVolumeClosedAt = Date.now();
      // Drop the transient drag value so the readout returns to the real volume.
      this.headerVolumeDragPercent = undefined;
      this.requestUpdate();
    }
  };

  private positionHeaderVolumePopover(): void {
    const root = this.renderRoot as ShadowRoot;
    const anchor = root.getElementById("ted-volume-anchor");
    const popover = root.getElementById("ted-volume-popover");
    if (!anchor || !popover) {
      return;
    }
    const rect = anchor.getBoundingClientRect();
    popover.style.position = "fixed";
    popover.style.margin = "0";
    popover.style.top = `${Math.round(rect.bottom + 8)}px`;
    popover.style.left = "auto";
    popover.style.right = `${Math.round(window.innerWidth - rect.right)}px`;
  }

  private handleHeaderVolumeInput = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    const value = Number.parseFloat(input.value);
    if (!Number.isFinite(value)) {
      return;
    }
    // Drive the live drag preview through reactive state + a normal re-render so
    // lit-html keeps ownership of the readout/slider DOM. Writing to those nodes
    // imperatively (e.g. readout.textContent) detaches lit's tracked text node and
    // makes the next render throw, which froze the entire card until a reload.
    this.headerVolumeDragPercent = Math.max(0, Math.min(100, Math.round(value)));
    this.requestUpdate();
  };

  private async handleSourceSelect(option: string): Promise<void> {
    if (!this.hass) {
      return;
    }

    const nextOption = option.trim();
    if (!nextOption) {
      return;
    }

    const sourceEntityId = this.getEntityId("source_entity");
    if (sourceEntityId && sourceEntityId.startsWith("select.")) {
      await this.hass.callService?.("select", "select_option", {
        entity_id: sourceEntityId,
        option: nextOption
      });
      return;
    }

    const mediaPlayerId = this.getEntityId("media_player_entity");
    if (!mediaPlayerId) {
      return;
    }

    await this.hass.callService?.("media_player", "select_source", {
      entity_id: mediaPlayerId,
      source: nextOption
    });
  }

  private syncOptimisticPowerState(): void {
    if (!this.hass || !this.optimisticPowerState) {
      return;
    }

    const mediaPlayerId = this.getEntityId("media_player_entity");
    const mediaPlayer = mediaPlayerId ? this.hass.states[mediaPlayerId] : undefined;
    if (!mediaPlayer) {
      this.optimisticPowerState = undefined;
      return;
    }

    const isOn = !["off", "standby", "unavailable", "unknown", ""].includes(mediaPlayer.state);
    if ((isOn && this.optimisticPowerState === "on") || (!isOn && this.optimisticPowerState === "off")) {
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

      const nextResolved: ResolvedEntityMap = {
        media_player_entity: this.pickEntity(entityIds, [/^media_player\./], ["media_player"]),
        source_entity: this.pickEntity(entityIds, [/_input_source$/, /_source$/], []),
        sound_mode_entity: this.pickEntity(entityIds, [/^sensor\..*_sound_mode$/, /_sound_mode$/], ["sensor"]),
        active_speakers_entity: this.pickEntity(entityIds, [/^sensor\..*_active_speakers$/, /_active_speakers$/], ["sensor"])
      };

      this.resolvedEntities = nextResolved;
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

  private readStringAttribute(entity: HassEntity, key: string): string | undefined {
    const value = entity.attributes[key];
    if (typeof value !== "string") {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed || undefined;
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

  private optionEquals(left: string, right: string): boolean {
    if (left === right) {
      return true;
    }

    return left.trim().toLowerCase() === right.trim().toLowerCase();
  }

  // Apply the user's saved `source_order` to the device's source list: reorder to
  // match and hide any source the user removed. If no order is saved — or the
  // device's set of sources has changed since the order was saved — every source
  // is shown in its original order (mirrors the NovaStar card's preset ordering).
  private arrangeSources(options: string[]): string[] {
    const order = this.config?.source_order;
    if (!Array.isArray(order) || order.length === 0) {
      return options;
    }

    const baseline = this.config?.source_baseline;
    if (Array.isArray(baseline) && baseline.length > 0 && !this.sortedEqual(baseline, options)) {
      // The device's set of sources changed since this order was saved — fall back to defaults.
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

  static styles = [
    tedStyleTheme,
    css`
    ha-card {
      overflow: hidden;
      position: relative;
      isolation: isolate;
      /* Power "on" glow: green for ted-style, theme accent for HA. */
      --ted-glow: var(--ted-style-success);
    }

    ha-card.ted-card--theme-ha {
      --ted-glow: var(--ted-style-accent);
    }

    .header-row {
      align-items: center;
      display: flex;
      gap: var(--ted-style-gap);
      justify-content: space-between;
      padding: 16px 16px 4px;
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
      height: calc(22px * var(--brand-logo-scale, 1));
      max-width: calc(160px * var(--brand-logo-scale, 1));
      width: auto;
    }

    img.brand-logo {
      object-fit: contain;
    }

    .brand-logo--custom {
      height: calc(26px * var(--brand-logo-scale, 1));
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

    .header-status {
      align-items: center;
      display: inline-flex;
      flex: none;
      gap: 8px;
    }

    .header-actions {
      align-items: center;
      display: inline-flex;
      flex: none;
      gap: 14px;
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
      box-shadow: 0 0 8px color-mix(in srgb, var(--ted-style-success) 70%, transparent);
    }

    .status-dot--off {
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

    /* ON: a glowing ring only — the background and icon color stay constant. */
    .power-button--on {
      border-color: var(--ted-glow);
      box-shadow:
        0 0 0 1px var(--ted-glow),
        0 0 4px color-mix(in srgb, var(--ted-glow) 22%, transparent);
    }

    .content {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 16px;
    }

    .row {
      align-items: center;
      display: flex;
      gap: 12px;
      justify-content: space-between;
      min-height: 28px;
    }

    .value {
      color: var(--ted-style-text);
      font-weight: 600;
    }

    .display-row {
      align-items: stretch;
      display: flex;
      gap: 10px;
    }

    .display-panel {
      background: #0a0c10;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: var(--ted-style-radius-sm);
      box-shadow: inset 0 0 24px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.04);
      box-sizing: border-box;
      color: #e7ecf5;
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      font-family: "Cascadia Mono", "Cascadia Code", ui-monospace, "SF Mono", "Segoe UI Mono", Menlo, Consolas, monospace;
      gap: 10px;
      justify-content: space-between;
      min-height: 116px;
      min-width: 0;
      overflow: hidden;
      padding: 12px 14px;
      position: relative;
    }

    .display-panel--off {
      color: color-mix(in srgb, #e7ecf5 35%, transparent);
    }

    .display-source {
      font-size: 1.5rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      overflow: hidden;
      padding-right: 76px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .display-bottom {
      align-items: flex-end;
      display: flex;
      gap: 12px;
      justify-content: space-between;
    }

    .display-meta {
      align-items: baseline;
      display: flex;
      flex: 1 1 auto;
      flex-wrap: wrap;
      gap: 6px 14px;
      min-width: 0;
    }

    .display-soundmode {
      font-size: 0.95rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .display-layout {
      color: color-mix(in srgb, #e7ecf5 78%, transparent);
      font-size: 0.95rem;
      letter-spacing: 0.06em;
      margin-left: auto;
      text-align: right;
    }

    .display-volume {
      font-size: 1.9rem;
      font-weight: 600;
      line-height: 1;
      position: absolute;
      right: 14px;
      top: 12px;
      white-space: nowrap;
    }

    .display-volume-frac {
      font-size: 1.1rem;
    }

    .display-volume-muted {
      color: var(--ted-style-danger, #e5484d);
      font-size: 1.1rem;
      letter-spacing: 0.08em;
    }

    .display-matrix {
      display: flex;
      flex: 0 0 30%;
      flex-wrap: wrap;
      gap: 2px;
      justify-content: flex-end;
      width: 30%;
    }

    .spk-chip {
      align-items: center;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 2px;
      box-sizing: border-box;
      color: color-mix(in srgb, #e7ecf5 88%, transparent);
      display: inline-flex;
      font-size: 0.5rem;
      font-weight: 600;
      justify-content: center;
      letter-spacing: 0;
      line-height: 1;
      padding: 2px 3px;
      width: calc(3ch + 6px);
    }

    .volume-stepper {
      align-items: stretch;
      /* Opaque base so the card-level brushed sheen never bleeds through: under
         some HA themes --ted-style-surface-2 resolves to a translucent value,
         which (with the transparent buttons) would reveal the brushed overlay.
         The rocker overlay sits above this background, so it still shows. */
      background-color: var(--card-background-color, #1c1c1c);
      background-image: linear-gradient(var(--ted-style-surface-2), var(--ted-style-surface-2));
      border: 1px solid var(--ted-style-divider);
      border-radius: var(--ted-style-radius-sm);
      box-sizing: border-box;
      display: flex;
      flex: none;
      flex-direction: column;
      isolation: isolate;
      overflow: hidden;
      position: relative;
      width: 64px;
    }

    .volume-stepper-button {
      align-items: center;
      background: transparent;
      border: none;
      color: var(--ted-style-text);
      cursor: pointer;
      display: flex;
      flex: 1 1 0;
      justify-content: center;
      padding: 0;
      transition: background 0.15s ease, transform 0.08s ease;
      -webkit-tap-highlight-color: transparent;
    }

    .volume-stepper-button:hover {
      background: color-mix(in srgb, var(--ted-style-accent) 16%, transparent);
    }

    .volume-stepper-button:active {
      transform: scale(0.94);
    }

    .volume-stepper-button:focus-visible {
      outline: 2px solid var(--ted-style-accent);
      outline-offset: -2px;
    }

    .volume-stepper-button:disabled {
      opacity: 0.4;
      pointer-events: none;
    }

    .volume-stepper-button svg {
      fill: currentColor;
      height: 22px;
      width: 22px;
    }

    .volume-stepper-divider {
      flex: none;
      height: 1px;
      /* Engraved/sunken look, inset from the button edges. */
      margin: 0 10px;
      background-color: rgba(35, 35, 35, 0.45);
      box-shadow: 0 1px 0 rgba(235, 235, 235, 0.13);
    }

    .icon-button {
      align-items: center;
      background: var(--ted-style-surface-2);
      border: 1px solid var(--ted-style-divider);
      border-radius: 50%;
      box-sizing: border-box;
      color: var(--ted-style-muted);
      cursor: pointer;
      display: inline-flex;
      flex: none;
      height: var(--ted-style-touch);
      justify-content: center;
      padding: 0;
      transition: color 0.2s ease, border-color 0.2s ease, background 0.2s ease, transform 0.08s ease;
      width: var(--ted-style-touch);
      -webkit-tap-highlight-color: transparent;
    }

    .icon-button:hover {
      border-color: color-mix(in srgb, var(--ted-style-accent) 45%, var(--ted-style-divider));
      color: var(--ted-style-text);
    }

    .icon-button:active {
      transform: scale(0.92);
    }

    .icon-button:focus-visible {
      outline: 2px solid var(--ted-style-accent);
      outline-offset: 2px;
    }

    .icon-button:disabled {
      opacity: 0.4;
      pointer-events: none;
    }

    .icon-button--active {
      background: color-mix(in srgb, var(--ted-style-danger, #e5484d) 18%, var(--ted-style-surface-2));
      border-color: color-mix(in srgb, var(--ted-style-danger, #e5484d) 55%, var(--ted-style-divider));
      color: var(--ted-style-danger, #e5484d);
    }

    .icon-button-icon {
      fill: currentColor;
      height: 22px;
      width: 22px;
    }

    .header-icon-button {
      background: transparent;
      border: none;
      height: 30px;
      width: 30px;
    }

    .header-icon-button.icon-button--active {
      background: transparent;
      color: var(--ted-style-danger, #e5484d);
    }

    .header-icon-button .icon-button-icon {
      height: 18px;
      width: 18px;
    }

    .volume-popover {
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

    .volume-popover:popover-open {
      align-items: center;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .volume-popover::backdrop {
      background: transparent;
    }

    .volume-popover-value {
      color: var(--ted-style-text);
      font-size: 0.85rem;
      font-weight: 600;
    }

    .volume-popover-icon {
      color: var(--ted-style-muted);
      fill: currentColor;
      height: 18px;
      width: 18px;
    }

    .volume-slider-vertical {
      -webkit-appearance: none;
      appearance: none;
      background: transparent;
      direction: rtl;
      height: 150px;
      margin: 0;
      width: 28px;
      writing-mode: vertical-lr;
    }

    .volume-slider-vertical--muted {
      opacity: 0.55;
    }

    .volume-slider-vertical::-webkit-slider-runnable-track {
      background: linear-gradient(
        to top,
        var(--ted-style-accent) 0%,
        var(--ted-style-accent) var(--ted-style-fill, 50%),
        color-mix(in srgb, var(--ted-style-text) 18%, transparent) var(--ted-style-fill, 50%),
        color-mix(in srgb, var(--ted-style-text) 18%, transparent) 100%
      );
      border-radius: var(--ted-style-pill);
      width: 6px;
    }

    .volume-slider-vertical::-webkit-slider-thumb {
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

    .volume-slider-vertical::-moz-range-track {
      background: color-mix(in srgb, var(--ted-style-text) 18%, transparent);
      border-radius: var(--ted-style-pill);
      width: 6px;
    }

    .volume-slider-vertical::-moz-range-progress {
      background: var(--ted-style-accent);
      border-radius: var(--ted-style-pill);
      width: 6px;
    }

    .volume-slider-vertical::-moz-range-thumb {
      background: var(--ted-style-surface);
      border: 1px solid color-mix(in srgb, var(--ted-style-text) 20%, transparent);
      border-radius: 50%;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
      height: 22px;
      width: 22px;
    }

    .volume-slider-vertical:disabled {
      opacity: 0.4;
      pointer-events: none;
    }

    .source-grid {
      display: grid;
      gap: 8px;
      grid-template-columns: repeat(5, 1fr);
    }

    .source-button {
      align-items: center;
      aspect-ratio: 1 / 1;
      background: var(--ted-style-surface-2);
      border: 1px solid var(--ted-style-divider);
      border-radius: var(--ted-style-radius-sm);
      color: var(--ted-style-text);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      font: inherit;
      font-size: 0.82rem;
      font-weight: 600;
      gap: 10px;
      justify-content: flex-end;
      line-height: 1.15;
      overflow: hidden;
      padding: 8px;
      text-align: center;
      transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease, transform 0.08s ease;
      word-break: break-word;
      -webkit-tap-highlight-color: transparent;
    }

    .source-button--centered {
      justify-content: center;
    }

    .source-button:hover {
      border-color: color-mix(in srgb, var(--ted-style-accent) 50%, var(--ted-style-divider));
    }

    .source-button:active {
      transform: scale(0.96);
    }

    .source-button:focus-visible {
      outline: 2px solid var(--ted-style-accent);
      outline-offset: 2px;
    }

    .source-button--active {
      background: var(--ted-style-accent);
      border-color: color-mix(in srgb, var(--ted-style-accent) 60%, #ffffff);
      box-shadow: 0 2px 10px color-mix(in srgb, var(--ted-style-accent) 35%, transparent);
      color: var(--ted-style-on-accent);
    }

    .source-button--more {
      color: var(--ted-style-text);
      justify-content: center;
    }

    .source-more-icon {
      display: block;
      fill: currentColor;
      height: 26px;
      width: 26px;
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
      border-color: var(--ted-style-accent);
      color: var(--ted-style-accent);
    }

    .source-button-icon {
      --mdc-icon-size: 34px;
      color: inherit;
      fill: currentColor;
      flex: none;
      height: 34px;
      width: 34px;
    }

    .source-button--centered .source-button-icon {
      --mdc-icon-size: 44px;
      height: 44px;
      width: 44px;
    }

    .source-button--active .source-button-icon {
      --icon-primary-color: var(--ted-style-on-accent) !important;
      color: var(--ted-style-on-accent) !important;
      fill: var(--ted-style-on-accent) !important;
    }

    .source-button-label {
      display: block;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .source-button:disabled {
      opacity: 0.45;
      pointer-events: none;
    }

    .version-footer {
      color: var(--ted-style-muted);
      font-size: 0.72rem;
      letter-spacing: 0.02em;
      opacity: 0.7;
      text-align: right;
    }
  `
  ];
}

const DENON_EDITOR_FIELD_LABELS: Record<string, string> = {
  header: "Name",
  show_name: "Show name",
  brand: "Brand",
  logo_scale: "Logo scale",
  theme: "Theme styling",
  brushed: "Brushed metal effect",
  rocker: "Rocker effect (volume buttons)",
  device_id: "Device",
  source_icons: "Source icons",
  source_labels: "Source labels",
  source_order: "Source order",
  max_rows: "Max rows (0 = unlimited)",
  media_player_entity: "Media player entity",
  source_entity: "Input source entity",
  sound_mode_entity: "Sound mode entity",
  active_speakers_entity: "Active speakers entity",
  show_display: "Show front panel display",
  show_volume_buttons: "Show volume +/- buttons",
  show_sources: "Show input sources",
  show_status: "Show status icon",
  show_volume: "Show volume",
  show_card_version: "Show card version"
};

class TedAvReceiverCardEditor extends LitElement {
  public hass?: HomeAssistant;

  private config: TedAvReceiverCardConfig = {
    type: "custom:ted-av-receiver-card"
  };
  private sourceOptions: string[] = [];
  private sourceOptionsKey?: string;
  private resolvedSourceEntityId?: string;
  private resolvedSourcePlayerId?: string;
  private resolvingSourceKey?: string;
  private sourcesResetNotice = false;
  private customLogoUploading = false;
  private customLogoError?: string;
  private expandedPanels: Record<string, boolean> = {};

  static properties = {
    hass: { attribute: false },
    config: { attribute: false }
  };

  public setConfig(config: TedAvReceiverCardConfig): void {
    const nextConfig: TedAvReceiverCardConfig = { ...config };
    nextConfig.type ||= "custom:ted-av-receiver-card";
    this.config = nextConfig;
  }

  protected updated(): void {
    void this.ensureSourceOptions();
    this.maybeResetStaleSourceOrder();
  }

  protected render() {
    if (!this.hass) {
      return nothing;
    }

    const data: TedAvReceiverCardConfig = {
      theme: "ted-style",
      brushed: true,
      source_icons: "color",
      source_labels: "unknown",
      show_display: true,
      show_volume_buttons: true,
      show_sources: true,
      logo_scale: 100,
      show_name: true,
      max_rows: 1,
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
          ${this.renderFieldWithToggle(
            "header",
            { text: {} },
            this.config.header ?? "",
            "Denon Marantz AVR",
            "show_name",
            this.config.show_name !== false
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
            .schema=${this.appearanceSchema()}
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
  private renderSectionRow(id: SectionId, data: TedAvReceiverCardConfig) {
    const def = SECTION_DEFS.find((section) => section.id === id);
    const key = `section-${id}`;
    const settings = id === "display"
      ? this.displaySectionContent(data)
      : this.sourcesSectionContent(data);

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

  private statusShowKey(id: StatusItemId): "show_status" | "show_volume" {
    return id === "status" ? "show_status" : "show_volume";
  }

  private isStatusShown(id: StatusItemId): boolean {
    return this.config[this.statusShowKey(id)] !== false;
  }

  private handleStatusShowToggle(id: StatusItemId, event: Event): void {
    const checked = (event.target as { checked?: boolean } | null)?.checked === true;
    this.commitConfig({ ...this.config, [this.statusShowKey(id)]: checked });
  }

  private displaySectionContent(data: TedAvReceiverCardConfig) {
    const schema: Array<Record<string, unknown>> = [];
    if (this.config.show_display !== false) {
      schema.push({ name: "show_volume_buttons", selector: { boolean: {} } });
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

  private sourcesSectionContent(data: TedAvReceiverCardConfig) {
    const schema: Array<Record<string, unknown>> = [];
    if (this.config.show_sources !== false) {
      schema.push(
        {
          name: "source_icons",
          required: true,
          selector: {
            select: {
              mode: "dropdown",
              options: [
                { value: "color", label: "Color (default)" },
                { value: "monochrome", label: "Monochrome" },
                { value: "off", label: "Off" }
              ]
            }
          }
        },
        {
          name: "source_labels",
          required: true,
          selector: {
            select: {
              mode: "dropdown",
              options: [
                { value: "unknown", label: "Only for unknown sources (default)" },
                { value: "always", label: "Always show" },
                { value: "off", label: "Off" }
              ]
            }
          }
        },
        { name: "max_rows", selector: { number: { min: 0, max: 20, step: 1, mode: "box" } } }
      );
      if (this.sourceOptions.length > 0) {
        schema.push({
          name: "source_order",
          selector: {
            select: {
              multiple: true,
              reorder: true,
              options: this.sourceOptions.map((source) => ({ value: source, label: source }))
            }
          }
        });
      }
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

  private baseSchema(): Array<Record<string, unknown>> {
    return [
      {
        name: "device_id",
        selector: { device: { filter: { integration: DENON_DOMAIN } } }
      }
    ];
  }

  // A wide field with a compact toggle on the same line (ha-form's grid only
  // does equal columns, so this is hand-rendered with the same ha-selector
  // component ha-form uses internally).
  private renderFieldWithToggle(
    fieldName: keyof TedAvReceiverCardConfig,
    fieldSelector: Record<string, unknown>,
    fieldValue: unknown,
    placeholder: string,
    toggleName: keyof TedAvReceiverCardConfig,
    toggleValue: boolean
  ) {
    return html`
      <div class="field-row">
        <ha-selector
          class="field-grow"
          .hass=${this.hass}
          .selector=${fieldSelector}
          .label=${this.computeLabel({ name: fieldName })}
          .placeholder=${placeholder}
          .value=${fieldValue}
          @value-changed=${(event: CustomEvent) => this.handleFieldChanged(fieldName, event)}
        ></ha-selector>
        <ha-selector
          class="field-toggle"
          .hass=${this.hass}
          .selector=${{ boolean: {} }}
          .label=${this.computeLabel({ name: toggleName })}
          .value=${toggleValue}
          @value-changed=${(event: CustomEvent) => this.handleFieldChanged(toggleName, event)}
        ></ha-selector>
      </div>
    `;
  }

  private handleFieldChanged(name: keyof TedAvReceiverCardConfig, event: CustomEvent): void {
    event.stopPropagation();
    const value = (event.detail as { value?: unknown }).value;
    this.commitConfig({ ...this.config, [name]: value } as TedAvReceiverCardConfig);
  }

  private appearanceSchema(): Array<Record<string, unknown>> {
    return [
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
      { name: "brushed", selector: { boolean: {} } },
      { name: "rocker", selector: { boolean: {} } }
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

  // The logo scale control below the brand selector. The custom brand also gets
  // the image uploader. No logo-style variants are offered.
  private renderLogoControls(data: TedAvReceiverCardConfig) {
    const brandId = this.config.brand?.trim() ?? "";
    if (!brandId) {
      return nothing;
    }

    const scaleForm = html`
      <ha-form
        .hass=${this.hass}
        .data=${data}
        .schema=${[
          {
            name: "logo_scale",
            selector: { number: { min: 50, max: 200, step: 5, mode: "slider", unit_of_measurement: "%" } }
          }
        ]}
        .computeLabel=${this.computeLabel}
        @value-changed=${this.handleFormChanged}
      ></ha-form>
    `;

    if (brandId === CUSTOM_BRAND_ID) {
      return html`
        ${this.renderCustomLogoUploader()}
        ${scaleForm}
      `;
    }

    return scaleForm;
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
      const result = (await response.json()) as { id?: string };
      if (!result.id) {
        throw new Error("Upload returned no image id");
      }
      this.commitConfig({ ...this.config, brand: CUSTOM_BRAND_ID, custom_logo: `/api/image/serve/${result.id}/original` });
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
    return [
      { name: "show_card_version", selector: { boolean: {} } },
      {
        name: "",
        type: "expandable",
        title: "Override entities",
        flatten: true,
        expanded: Boolean(
          this.config.media_player_entity
          || this.config.source_entity
          || this.config.sound_mode_entity
          || this.config.active_speakers_entity
        ),
        schema: [
          { name: "media_player_entity", selector: { entity: { domain: "media_player" } } },
          { name: "source_entity", selector: { entity: {} } },
          { name: "sound_mode_entity", selector: { entity: {} } },
          { name: "active_speakers_entity", selector: { entity: {} } }
        ]
      }
    ];
  }

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

  // Per-section visibility (show_display / show_sources), shown as a switch in the
  // section row header.
  private sectionShowKey(id: SectionId): "show_display" | "show_sources" {
    return id === "display" ? "show_display" : "show_sources";
  }

  private isSectionShown(id: SectionId): boolean {
    return this.config[this.sectionShowKey(id)] !== false;
  }

  private handleSectionShowToggle(id: SectionId, event: Event): void {
    const checked = (event.target as { checked?: boolean } | null)?.checked === true;
    this.commitConfig({ ...this.config, [this.sectionShowKey(id)]: checked });
  }

  private stopPropagation = (event: Event): void => {
    event.stopPropagation();
  };

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

  private computeLabel = (schema: { name: string }): string => {
    return DENON_EDITOR_FIELD_LABELS[schema.name] ?? schema.name;
  };

  private computeHelper = (schema: { name: string }): string => {
    if (schema.name !== "source_order") {
      return "";
    }

    if (this.sourceOptions.length === 0) {
      return "Select a device to load its sources.";
    }

    const base = "Drag to reorder. Remove a source to hide it. Clear the field to show every source again.";
    return this.sourcesResetNotice
      ? `Sources changed on the device, so your custom order was reset. ${base}`
      : base;
  };

  private handleFormChanged = (event: CustomEvent<{ value: TedAvReceiverCardConfig }>): void => {
    event.stopPropagation();
    this.commitConfig({ ...event.detail.value });
  };

  // Normalize a candidate config (strip defaults/empties), reconcile the source
  // order, store it, and notify HA. Shared by every editor form and by the
  // section reorder menu.
  private commitConfig(rawConfig: TedAvReceiverCardConfig): void {
    const nextConfig: TedAvReceiverCardConfig = { ...rawConfig };
    nextConfig.type = "custom:ted-av-receiver-card";

    if (nextConfig.theme === "ted-style") {
      delete nextConfig.theme;
    }
    if (nextConfig.source_icons === undefined
      || nextConfig.source_icons === null
      || nextConfig.source_icons === "color") {
      delete nextConfig.source_icons;
    }
    if (nextConfig.source_labels === undefined
      || nextConfig.source_labels === null
      || nextConfig.source_labels === "unknown") {
      delete nextConfig.source_labels;
    }
    if (nextConfig.show_display !== false) {
      delete nextConfig.show_display;
    }
    if (nextConfig.show_volume_buttons !== false) {
      delete nextConfig.show_volume_buttons;
    }
    if (nextConfig.show_sources !== false) {
      delete nextConfig.show_sources;
    }
    if (nextConfig.show_status !== false) {
      delete nextConfig.show_status;
    }
    if (nextConfig.show_volume !== false) {
      delete nextConfig.show_volume;
    }
    if (typeof nextConfig.max_rows !== "number" || nextConfig.max_rows === 1) {
      delete nextConfig.max_rows;
    }
    if (nextConfig.show_card_version !== true) {
      delete nextConfig.show_card_version;
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
      delete nextConfig.logo_scale;
      delete nextConfig.custom_logo;
    } else if (brandId === CUSTOM_BRAND_ID) {
      nextConfig.brand = brandId;
      if (typeof nextConfig.custom_logo !== "string" || !nextConfig.custom_logo.trim()) {
        delete nextConfig.custom_logo;
      }
    } else {
      nextConfig.brand = brandId;
      delete nextConfig.custom_logo; // only used by the custom brand
    }

    const logoScale = Number(nextConfig.logo_scale);
    if (!Number.isFinite(logoScale) || logoScale === 100) {
      delete nextConfig.logo_scale;
    } else {
      nextConfig.logo_scale = Math.min(200, Math.max(50, logoScale));
    }

    if (!Array.isArray(nextConfig.section_order)
      || this.listSequenceEqual(orderSections(nextConfig.section_order), DEFAULT_SECTION_ORDER)) {
      delete nextConfig.section_order;
    }
    if (!Array.isArray(nextConfig.status_order)
      || this.listSequenceEqual(orderStatusItems(nextConfig.status_order), DEFAULT_STATUS_ORDER)) {
      delete nextConfig.status_order;
    }

    this.reconcileSourceOrder(nextConfig);

    const optionalKeys: Array<keyof TedAvReceiverCardConfig> = [
      "header",
      "device_id",
      "media_player_entity",
      "source_entity",
      "sound_mode_entity",
      "active_speakers_entity"
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

  // Load the device's input-source list so the editor can offer a reorder/hide
  // control. Mirrors how the card resolves sources: an override source entity's
  // `options`, otherwise the (override or device) media player's `source_list`.
  private async ensureSourceOptions(): Promise<void> {
    if (!this.hass) {
      return;
    }

    const sourceOverride = this.config.source_entity?.trim() ?? "";
    const playerOverride = this.config.media_player_entity?.trim() ?? "";
    const deviceId = this.config.device_id?.trim() ?? "";
    const key = `${sourceOverride}|${playerOverride}|${deviceId}`;

    if (key !== this.sourceOptionsKey) {
      this.sourceOptionsKey = key;
      this.resolvedSourceEntityId = sourceOverride || undefined;
      this.resolvedSourcePlayerId = playerOverride || undefined;

      if ((!sourceOverride || !playerOverride) && deviceId && this.hass.callWS && this.resolvingSourceKey !== key) {
        this.resolvingSourceKey = key;
        try {
          const registry = await this.hass.callWS({ type: "config/entity_registry/list" });
          if (this.sourceOptionsKey === key && Array.isArray(registry)) {
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

            if (!sourceOverride) {
              this.resolvedSourceEntityId = entityIds.find((id) => /_input_source$/.test(id))
                ?? entityIds.find((id) => /_source$/.test(id));
            }
            if (!playerOverride) {
              this.resolvedSourcePlayerId = entityIds.find((id) => id.startsWith("media_player."));
            }
          }
        } catch {
        } finally {
          if (this.resolvingSourceKey === key) {
            this.resolvingSourceKey = undefined;
          }
        }
      }
    }

    const sourceEntity = this.resolvedSourceEntityId ? this.hass.states[this.resolvedSourceEntityId] : undefined;
    const playerEntity = this.resolvedSourcePlayerId ? this.hass.states[this.resolvedSourcePlayerId] : undefined;
    const rawOptions = sourceEntity
      ? sourceEntity.attributes?.options
      : playerEntity?.attributes?.source_list;
    const options = Array.isArray(rawOptions)
      ? rawOptions.filter((item): item is string => typeof item === "string")
      : [];

    if (!this.listSequenceEqual(options, this.sourceOptions)) {
      this.sourceOptions = options;
      this.requestUpdate();
    }
  }

  // Normalize the edited order against the live source list, then store it only
  // when it actually differs (an explicit subset/reorder). An empty or identical
  // order clears the keys so the card shows every source in its native order.
  private reconcileSourceOrder(nextConfig: TedAvReceiverCardConfig): void {
    if (this.sourceOptions.length === 0) {
      // Device sources aren't loaded yet — preserve any existing config untouched.
      if (Array.isArray(this.config.source_order) && this.config.source_order.length > 0) {
        nextConfig.source_order = this.config.source_order;
        if (Array.isArray(this.config.source_baseline) && this.config.source_baseline.length > 0) {
          nextConfig.source_baseline = this.config.source_baseline;
        } else {
          delete nextConfig.source_baseline;
        }
      } else {
        delete nextConfig.source_order;
        delete nextConfig.source_baseline;
      }
      return;
    }

    const normalized = this.normalizeSourceOrder(nextConfig.source_order);
    if (normalized.length === 0 || this.listSequenceEqual(normalized, this.sourceOptions)) {
      // Empty (show all) or identical to device order — store nothing.
      delete nextConfig.source_order;
      delete nextConfig.source_baseline;
    } else {
      nextConfig.source_order = normalized;
      nextConfig.source_baseline = [...this.sourceOptions];
    }
    this.sourcesResetNotice = false;
  }

  private normalizeSourceOrder(value: unknown): string[] {
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
      const match = this.sourceOptions.find((option) => option.trim().toLowerCase() === normalizedItem);
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

  // If the device's set of sources changed since a custom order was saved, drop
  // the stale order (and flag a one-time notice) so the card shows all sources.
  private maybeResetStaleSourceOrder(): void {
    if (this.sourceOptions.length === 0) {
      return;
    }

    const order = this.config.source_order;
    const baseline = this.config.source_baseline;
    if (!Array.isArray(order) || order.length === 0) {
      return;
    }
    if (!Array.isArray(baseline) || baseline.length === 0) {
      return;
    }
    if (this.nameSetEqual(baseline, this.sourceOptions)) {
      return;
    }

    const nextConfig: TedAvReceiverCardConfig = { ...this.config, type: "custom:ted-av-receiver-card" };
    delete nextConfig.source_order;
    delete nextConfig.source_baseline;
    this.config = nextConfig;
    this.sourcesResetNotice = true;
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
      border: 1px solid var(--divider-color);
      border-radius: var(--ha-card-border-radius, 12px);
      box-sizing: border-box;
      display: flex;
      gap: 12px;
      min-height: 48px;
      padding: 4px 16px;
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
      margin-inline-start: -6px;
      padding: 6px 2px;
      touch-action: none;
    }

    .status-item-row .drag-handle ha-icon {
      pointer-events: none;
    }
  `;
}

try {
  customElements.define("ted-av-receiver-card", TedAvReceiverCard);
} catch {
}

try {
  customElements.define("ted-av-receiver-card-editor", TedAvReceiverCardEditor);
} catch {
}

registerCustomCard({
  type: "ted-av-receiver-card",
  name: "Ted AV Receiver Card",
  description: `Control card for the Denon/Marantz AVR integration (power, volume, and source). v${CARD_VERSION}`,
  preview: true,
  documentationURL: "https://github.com/tedr91/Teds-Cards-Devices#ted-av-receiver-card",
  getEntitySuggestion: (_hass, entityId) =>
    entityId.startsWith("media_player.")
      ? { config: { type: "custom:ted-av-receiver-card", media_player_entity: entityId } }
      : null
});
