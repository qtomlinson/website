module.exports = {
  preset: 'jest-puppeteer',
  testRegex: 'e2e/tests/.*\\.js$',
  globals: {
    __HOST__: process.env.TEST_HOST || 'http://localhost:3333'
  },
  transformIgnorePatterns: ['<rootDir>/node_modules/']
}
