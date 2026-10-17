import obsidianmd from "eslint-plugin-obsidianmd";
export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "test-artifacts/**",
      "tests/**",
      "scripts/**",
      "*.mjs",
    ],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: { parserOptions: { projectService: true } },
  },
];
