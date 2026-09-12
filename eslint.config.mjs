import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // Primitivas vendored de shadcn/ui: las regenera su CLI, no las editamos a mano.
    // Las reglas del React Compiler marcan patrones reales (Math.random() en el
    // skeleton del sidebar, setState en efecto en el hook de breakpoint) que no nos
    // toca arreglar aqui; corregirlas divergiria del upstream y se perderia al
    // regenerar. Siguen activas para todo el codigo propio.
    files: ["components/ui/**", "hooks/use-mobile.ts"],
    rules: {
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
