module.exports = {
  root: true,
  ignorePatterns: ["node_modules/", "dist/", "build/", "public/"],
  overrides: [
    {
      files: ["*.ts", "*.tsx"],
      parser: "@typescript-eslint/parser",
      parserOptions: {
        project: ["./tsconfig.base.json"],
        ecmaVersion: 2024,
        sourceType: "module",
        ecmaFeatures: { jsx: true }
      },
      extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
        "plugin:react/recommended",
        "prettier"
      ],
      rules: {}
    },
    {
      files: ["*.js", "*.jsx"],
      extends: ["eslint:recommended"],
      rules: {}
    }
  ]
};
