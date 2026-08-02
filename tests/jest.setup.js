'use strict';

/**
 * Fail fast when Jest is started without --experimental-vm-modules.
 * officeParser's PDF path (pdfjs-dist) uses dynamic import(); without the
 * flag, extractText returns ok:false with a cryptic OfficeParser message and
 * documentExtraction PDF tests look like product failures. CI and `npm test`
 * already pass the flag — this guard catches direct `jest` / bare binary
 * invocations (the 2026-08-02 false-alarm root cause).
 */
function hasExperimentalVmModules() {
  const inArgv = process.execArgv.some((a) => a.includes('experimental-vm-modules'));
  const inNodeOptions = typeof process.env.NODE_OPTIONS === 'string'
    && process.env.NODE_OPTIONS.includes('experimental-vm-modules');
  return inArgv || inNodeOptions;
}

if (!hasExperimentalVmModules()) {
  throw new Error(
    'PDF extraction tests require --experimental-vm-modules — run via `npm test`, not `jest` directly',
  );
}
