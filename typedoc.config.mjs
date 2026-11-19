/** @type {Partial<import("typedoc").TypeDocOptions>} */
const config = {
  out: 'docs',
  exclude: [
    'src/**/*.spec.ts',
    'src/test-utils/*',
  ],
  entryPoints: [
    'src/index.ts',
  ],
  excludePrivate: true,
  excludeProtected: true,
  excludeExternals: true,
  hideGenerator: true,
  includeVersion: false,
  // Link "Defined in" to the branch, not to the commit the docs were made from: that commit is gone after a rebase,
  // and a new commit id would rewrite every page of the docs.
  gitRevision: 'latest',
  externalSymbolLinkMappings: {
    '@types/node': {
      '__global.AbortSignal': 'https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal',
    },
  },
  validation: {
    invalidLink: true,
    notExported: true,
  },
  blockTags: [
    '@deprecated',
    '@example',
    '@group',
    '@param',
    '@returns',
    '@since',
  ],
}

export default config
