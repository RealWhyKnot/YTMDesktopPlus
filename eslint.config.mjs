import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default defineConfig(
  globalIgnores([".vite/", ".yarn/", "out/", "dist/", "node_modules/", "tools/test-harness/runs/"]),
  js.configs.recommended,
  tseslint.configs.recommended,
  pluginVue.configs["flat/recommended"],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      }
    }
  },
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser
      }
    }
  },
  {
    rules: {
      "vue/multi-word-component-names": "off"
    }
  },
  {
    // Scripts injected into the YouTube Music page. They are imported as raw
    // text, evaluated in the page's main world, and written as bare function
    // expressions that reference page globals.
    files: ["**/*.script.js"],
    rules: {
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-undef": "off"
    }
  },
  prettier
);
