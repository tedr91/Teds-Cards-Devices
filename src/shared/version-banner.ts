import { VERSION } from "./const";

/** Print a styled banner to the browser console identifying this package. */
export function printVersionBanner(): void {
  // eslint-disable-next-line no-console
  console.info(
    `%c TED-DEVICE-CARDS %c ${VERSION} `,
    "color: white; background: #4a90e2; font-weight: 700;",
    "color: #4a90e2; background: white; font-weight: 700;",
  );
}
