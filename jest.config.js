// RAG PR B — run via `npm test`, which invokes Node directly with
// --experimental-vm-modules (see package.json's "test" script), not plain
// `jest`. Required because officeParser's PDF support (pdfjs-dist) uses a
// dynamic import() internally that Jest's default CommonJS VM context
// rejects ("A dynamic import callback was invoked without
// --experimental-vm-modules") — confirmed this only affects Jest's test
// environment, not real Node (verified working standalone both with and
// without this flag); the flag just brings Jest's runtime in line with how
// the Lambda itself already runs.
//
// tests/jest.setup.js fails the whole run immediately if the flag is missing
// (instead of a silent ok:false on the PDF fixture test).
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/jest.setup.js'],
  clearMocks: true,
  // Prevent Lambda/AWS SDK from trying to hit real endpoints during tests
  testTimeout: 10000,
};
