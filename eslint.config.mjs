// eslint.config.mjs
// Obsidian 公式の developer guidelines 準拠チェック用設定。
// obsidianmd/eslint-plugin の recommended 設定をベースに、
// このリポジトリの TypeScript ソース (src/**/*.ts) に対して適用する。
import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
    },
  },
  {
    ignores: ["main.js", "node_modules/**", "tests/**", "docs/**"],
  },
]);
