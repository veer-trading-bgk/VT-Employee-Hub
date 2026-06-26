module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  clearMocks: true,
  // Prevent Lambda/AWS SDK from trying to hit real endpoints during tests
  testTimeout: 10000,
};
