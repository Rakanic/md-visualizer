Vendored, unmodified third-party code (loaded offline):

- `marked.min.js`: marked 12.0.2 (MIT)
- `mermaid.min.js`: mermaid 11.17.2 + @mermaid-js/layout-elk 0.2.3 (MIT; ELK via elkjs, EPL-2.0), bundled into one
  IIFE with esbuild 0.24.2 from:
  ```js
  import mermaid from 'mermaid';
  import elkLayouts from '@mermaid-js/layout-elk';
  mermaid.registerLayoutLoaders(elkLayouts);
  globalThis.mermaid = mermaid;
  ```
