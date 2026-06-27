// @ts-check
/**
 * Regenerate the README showcase image and per-card preview images.
 *
 * Renders the built cards (`dist/teds-device-cards.js`) in headless Chromium against a
 * small HTML harness, then takes an *element* screenshot of the card row. The PNG
 * dimensions come from the natural rendered size of the element, not from a hard-coded clip.
 *
 *   npm run build            # produce dist/teds-device-cards.js (required first)
 *   npm run screenshots      # writes images/showcase.png + images/cards/<card>.png
 *
 * Env:
 *   SCREENSHOT_SCALE   deviceScaleFactor (default 2 → crisp retina output; use 1 for 1×)
 *   SCREENSHOT_PORT    static-server port (default 8778)
 */
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.SCREENSHOT_PORT ?? 8778);
const SCALE = Number(process.env.SCREENSHOT_SCALE ?? 2);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const BUNDLE = "dist/teds-device-cards.js";

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".map": "application/json",
};

/** A shared mock `hass` object; per-card entity states are merged in per shot. */
function hassLiteral(states) {
  return `{
    states: ${JSON.stringify(states)},
    callService: () => {},
    callWS: async () => ([]),
    callApi: async () => ({}),
    localize: (k) => k,
    language: "en",
    locale: { language: "en" },
    formatEntityState: (s) => s.state,
    themes: {},
  }`;
}

/**
 * Build the harness HTML. Cards are appended to `#wrap`; the body paints a dark gradient
 * so the element screenshot has a nice backdrop. A stub `<ha-icon>` (defined before the
 * bundle loads) fetches the real MDI glyph from a CDN so icons render in the screenshot.
 */
function harnessHtml({ cards, padding }) {
  const setup = cards
    .map((c, i) => {
      const frame = c.frame
        ? `card.style.width=${JSON.stringify(c.frame.width ?? "auto")};card.style.height=${JSON.stringify(c.frame.height ?? "auto")};`
        : "";
      return `
      {
        const card = document.createElement(${JSON.stringify(c.tag)});
        card.setConfig(${JSON.stringify({ type: "x", ...c.config })});
        card.hass = ${hassLiteral(c.states)};
        ${frame}
        wrap.appendChild(card);
        cards[${i}] = card;
      }`;
    })
    .join("\n");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>screenshot harness</title>
    <style>
      html, body { margin: 0; }
      body {
        background: radial-gradient(1200px 600px at 30% -10%, #3a4a63 0%, #1d2430 55%, #141923 100%);
        padding: 44px;
        font-family: "Segoe UI", system-ui, sans-serif;
      }
      #wrap { display: flex; gap: 28px; align-items: flex-start; padding: ${padding}px; width: max-content; }
    </style>
  </head>
  <body>
    <div id="wrap"></div>
    <script type="module">
      customElements.define(
        "ha-icon",
        class extends HTMLElement {
          connectedCallback() {
            this.style.display = "inline-block";
            this.style.width = "var(--mdc-icon-size, 24px)";
            this.style.height = "var(--mdc-icon-size, 24px)";
            this.style.lineHeight = "0";
            if (this._icon) this._render(this._icon);
          }
          set icon(v) { this._icon = v; if (this.isConnected) this._render(v); }
          async _render(v) {
            if (!v) return;
            const name = String(v).replace("mdi:", "");
            try {
              const r = await fetch(\`https://cdn.jsdelivr.net/npm/@mdi/svg/svg/\${name}.svg\`);
              if (!r.ok) return;
              this.innerHTML = await r.text();
              const s = this.querySelector("svg");
              if (s) { s.style.width = "100%"; s.style.height = "100%"; s.style.fill = "currentColor"; }
            } catch (e) { /* offline: icon stays blank */ }
          }
        },
      );

      await import("/${BUNDLE}");
      const wrap = document.getElementById("wrap");
      const cards = [];
${setup}
      await Promise.all(cards.map((c) => c.updateComplete).filter(Boolean));
      window.__ready = true;
    </script>
  </body>
</html>`;
}

/** A mock Denon/Marantz media_player state with a realistic source list. */
const AV_STATES = {
  "media_player.home_theater_avr": {
    entity_id: "media_player.home_theater_avr",
    state: "on",
    attributes: {
      friendly_name: "Home Theater AVR",
      volume_level: 0.405,
      is_volume_muted: false,
      source: "Apple TV",
      source_list: ["Apple TV", "Netflix", "Spotify", "YouTube", "Plex", "Prime Video", "Roku", "Xbox", "PlayStation", "Tidal"],
      sound_mode: "Dolby Atmos",
      supported_features: 152461,
    },
  },
  "sensor.home_theater_avr_sound_mode": {
    entity_id: "sensor.home_theater_avr_sound_mode",
    state: "Dolby Atmos",
    attributes: { friendly_name: "Sound Mode" },
  },
  "sensor.home_theater_avr_active_speakers": {
    entity_id: "sensor.home_theater_avr_active_speakers",
    state: "7.2.4",
    attributes: {
      friendly_name: "Active Speakers",
      layout: "7.2.4",
      channels: ["FL", "FR", "C", "SW1", "SW2", "SL", "SR", "SBL", "SBR", "FHL", "FHR", "RHL", "RHR"],
    },
  },
};

const AV_CONFIG = {
  header: "Home Theater AVR",
  theme: "ted-style",
  media_player_entity: "media_player.home_theater_avr",
  sound_mode_entity: "sensor.home_theater_avr_sound_mode",
  active_speakers_entity: "sensor.home_theater_avr_active_speakers",
  source_icons: "color",
  max_rows: 0,
};

/** A mock NovaStar H Series controller plus its companion status entities. */
const NOVASTAR_STATES = {
  "sensor.novastar_h_series_controller": {
    entity_id: "sensor.novastar_h_series_controller",
    state: "Online",
    attributes: { friendly_name: "NovaStar H Series", model: "H9" },
  },
  "switch.novastar_h2_power_screen_output": {
    entity_id: "switch.novastar_h2_power_screen_output",
    state: "on",
    attributes: { friendly_name: "Screen Output" },
  },
  "sensor.novastar_h_series_status": {
    entity_id: "sensor.novastar_h_series_status",
    state: "Normal",
    attributes: { friendly_name: "Status" },
  },
  "select.novastar_h_series_preset": {
    entity_id: "select.novastar_h_series_preset",
    state: "Movie Night",
    attributes: {
      friendly_name: "Preset",
      options: ["Movie Night", "Sports", "Gaming", "Presentation", "Standby"],
    },
  },
  "number.novastar_h_series_brightness": {
    entity_id: "number.novastar_h_series_brightness",
    state: "80",
    attributes: { friendly_name: "Brightness", min: 0, max: 100, step: 1, unit_of_measurement: "%" },
  },
  "sensor.novastar_h_series_temperature": {
    entity_id: "sensor.novastar_h_series_temperature",
    state: "42",
    attributes: { friendly_name: "Temperature", unit_of_measurement: "°C", device_class: "temperature" },
  },
  "sensor.novastar_h_series_screens": {
    entity_id: "sensor.novastar_h_series_screens",
    state: "1",
    attributes: { friendly_name: "Screens", screens: [{ width: 1920, height: 1080 }] },
  },
  "sensor.novastar_h_series_layers": {
    entity_id: "sensor.novastar_h_series_layers",
    state: "3",
    attributes: {
      friendly_name: "Layers",
      layers: [
        { general: { layerId: "1", zorder: 1, name: "Apple TV" }, window: { x: 0, y: 0, width: 1216, height: 1080 }, audioStatus: { isOpen: true } },
        { general: { layerId: "2", zorder: 2, name: "Blu-ray" }, window: { x: 1216, y: 0, width: 704, height: 540 } },
        { general: { layerId: "3", zorder: 3, name: "Camera" }, window: { x: 1216, y: 540, width: 704, height: 540 } },
      ],
    },
  },
};

const NOVASTAR_CONFIG = {
  header: "NovaStar H Series",
  theme: "ted-style",
  display_mode: "standard",
  controller_entity: "sensor.novastar_h_series_controller",
  power_entity: "switch.novastar_h2_power_screen_output",
  status_entity: "sensor.novastar_h_series_status",
  preset_entity: "select.novastar_h_series_preset",
  brightness_entity: "number.novastar_h_series_brightness",
  temperature_entity: "sensor.novastar_h_series_temperature",
  screens_entity: "sensor.novastar_h_series_screens",
  layers_entity: "sensor.novastar_h_series_layers",
};

/** Both cards rendered side-by-side for the README hero image. */
const SHOWCASE = {
  out: "images/showcase.png",
  padding: 0,
  cards: [
    { tag: "ted-av-receiver-card", frame: { width: "460px" }, config: AV_CONFIG, states: AV_STATES },
    { tag: "ted-novastar-card", frame: { width: "460px" }, config: NOVASTAR_CONFIG, states: NOVASTAR_STATES },
  ],
};

/** Per-card preview images → images/cards/<name>.png. */
const CARDS = [
  {
    name: "ted-av-receiver-card",
    padding: 28,
    cards: [{ tag: "ted-av-receiver-card", frame: { width: "460px" }, config: AV_CONFIG, states: AV_STATES }],
  },
  {
    name: "ted-novastar-card",
    padding: 28,
    cards: [{ tag: "ted-novastar-card", frame: { width: "460px" }, config: NOVASTAR_CONFIG, states: NOVASTAR_STATES }],
  },
];

/** Static file server rooted at the repo, plus in-memory generated harness pages. */
function startServer(pages) {
  const server = createServer(async (req, res) => {
    const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
    if (pages.has(urlPath)) {
      res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
      res.end(pages.get(urlPath));
      return;
    }
    try {
      const data = await readFile(join(ROOT, urlPath));
      res.writeHead(200, { "content-type": MIME[extname(urlPath)] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  return new Promise((res) => server.listen(PORT, "127.0.0.1", () => res(server)));
}

function pngSize(buf) {
  return `${buf.readUInt32BE(16)}×${buf.readUInt32BE(20)}`;
}

async function shoot(page, pages, { out, padding, cards }) {
  const route = `/__harness_${Math.random().toString(36).slice(2)}.html`;
  pages.set(route, harnessHtml({ cards, padding }));
  await page.goto(ORIGIN + route, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ready === true, { timeout: 10000 });
  await page.waitForTimeout(1500); // let CDN icon SVGs finish loading
  const target = join(ROOT, out);
  await mkdir(dirname(target), { recursive: true });
  const buf = await page.locator("#wrap").screenshot();
  await writeFile(target, buf);
  pages.delete(route);
  console.log(`  ${out.padEnd(38)} ${pngSize(buf)}`);
}

async function main() {
  if (!existsSync(join(ROOT, BUNDLE))) {
    console.error(`${BUNDLE} not found — run \`npm run build\` first.`);
    process.exit(1);
  }

  const pages = new Map();
  const server = await startServer(pages);
  const browser = await chromium.launch();
  const context = await browser.newContext({ deviceScaleFactor: SCALE, viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  try {
    console.log("Rendering showcase:");
    await shoot(page, pages, SHOWCASE);

    console.log("Rendering per-card previews:");
    for (const card of CARDS) {
      await shoot(page, pages, { out: `images/cards/${card.name}.png`, padding: card.padding, cards: card.cards });
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
