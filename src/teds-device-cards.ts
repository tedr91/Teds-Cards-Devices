/**
 * Ted's Device Cards — main entry point.
 *
 * This file is the single bundled JavaScript module that Home Assistant loads
 * as a Lovelace resource. It imports every card in the collection so they all
 * register their custom elements when the module is evaluated.
 */
import { printVersionBanner } from "./shared/version-banner";

// Cards
import "./cards/av-receiver-card/ted-av-receiver-card";
import "./cards/novastar-card/ted-novastar-card";
import "./cards/novastar-card/ted-novastar-card-editor";

printVersionBanner();
