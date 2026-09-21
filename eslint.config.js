// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // sim/ and scripts/ are Node tooling (CommonJS, Buffer, __dirname); the
    // app code is what this config is for.
    ignores: ["dist/*", "sim/**", "scripts/**", ".expo/**"],
  },
  {
    rules: {
      // The React Compiler rules flag patterns this code base uses on purpose
      // (useRef(new Animated.Value()).current, a setState after a guard inside
      // useEffect). Kept visible as warnings; errors are what CI blocks on.
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
    },
  },
]);
