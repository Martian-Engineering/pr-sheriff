declare module "*.mjs" {
  // Treat local `.mjs` modules as `any` from TypeScript.
  // Runtime semantics are handled by Node; this only unblocks `tsc --strict`.
  const anyModule: any;
  export default anyModule;
  // Named exports are also `any` via casting at use sites when needed.
  export const GitHubFetch: any;
  export const buildReferenceGraph: any;
  export const extractReferencedNumbers: any;
  export const extractReferencedNumbersFromPRAndComments: any;
}

