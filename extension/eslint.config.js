export default [
  { ignores: ["dist/**", "node_modules/**", "*.zip"] },
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023, sourceType: "module",
      globals: { chrome: "readonly", window: "readonly", document: "readonly", location: "readonly", globalThis: "readonly", console: "readonly", navigator: "readonly",
        setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly", clearInterval: "readonly", fetch: "readonly", URL: "readonly", process: "readonly", Buffer: "readonly" },
    },
    rules: {},
  },
];
