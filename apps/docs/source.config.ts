import { defineConfig, defineDocs } from "fumadocs-mdx/config";

const brandPrimary = "#e2ff1f";
const brandString = "#eaff73";

const anviaCodeTheme = {
  name: "anvia-dark",
  type: "dark" as const,
  fg: "#d9d9d9",
  bg: "#050505",
  colors: {
    "editor.background": "#050505",
    "editor.foreground": "#d9d9d9",
    "editorLineNumber.foreground": "#555555",
    "editor.selectionBackground": `${brandPrimary}33`,
    "editor.inactiveSelectionBackground": `${brandPrimary}22`,
  },
  settings: [
    {
      settings: {
        foreground: "#d9d9d9",
        background: "#050505",
      },
    },
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: {
        foreground: "#6f7774",
        fontStyle: "italic",
      },
    },
    {
      scope: ["keyword", "storage.type", "storage.modifier", "keyword.control"],
      settings: {
        foreground: brandPrimary,
      },
    },
    {
      scope: [
        "string",
        "string.quoted",
        "string.template",
        "string.regexp",
        "constant.other.symbol",
        "punctuation.definition.string",
      ],
      settings: {
        foreground: brandString,
      },
    },
    {
      scope: ["constant.numeric", "constant.language", "constant.character", "support.constant"],
      settings: {
        foreground: "#d8b4fe",
      },
    },
    {
      scope: ["entity.name.function", "support.function", "meta.function-call"],
      settings: {
        foreground: "#c4b5fd",
      },
    },
    {
      scope: ["variable", "variable.other", "meta.object-literal.key", "support.variable"],
      settings: {
        foreground: "#d9d9d9",
      },
    },
    {
      scope: ["entity.name.type", "support.type", "support.class", "entity.name.class"],
      settings: {
        foreground: "#f0abfc",
      },
    },
    {
      scope: ["variable.parameter", "meta.parameter"],
      settings: {
        foreground: "#facc15",
      },
    },
    {
      scope: ["punctuation", "meta.brace", "meta.delimiter"],
      settings: {
        foreground: "#8a8a8a",
      },
    },
    {
      scope: ["invalid", "invalid.illegal"],
      settings: {
        foreground: "#f87171",
      },
    },
  ],
};

export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: {
      themes: {
        light: "github-light",
        dark: anviaCodeTheme,
      },
    },
  },
});

export const docs = defineDocs({
  dir: "content/docs",
});
