module.exports = {
  preset: 'react-native',
  setupFiles: ['./jest.setup.js'],
  // tools/ui-preview is a separate Vite app with its own dependencies.
  modulePathIgnorePatterns: ['<rootDir>/tools/'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/__tests__/helpers/'],
};
