/// <reference types="nativewind/types" />

// TypeScript 6 (SDK 57) requires a declaration for a side-effect import of a
// non-code module -- app/_layout.tsx does `import '../global.css'` to load the
// Tailwind layer, and without this it fails with TS2882. nativewind/types
// declares the className props but not the stylesheet import itself.
declare module '*.css';
