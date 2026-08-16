// EAS build stub for @workspace/api-client-react.
// Metro redirects imports of that package to this file via metro.config.js
// so that EAS/CI builds that lack the workspace package still compile.
// Jest uses this file directly (the jest transform handles .ts).

let _baseUrl: string | null = null;

export function setBaseUrl(url: string | null): void {
  _baseUrl = url ? url.replace(/\/+$/, '') : null;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function setAuthTokenGetter(_getter: () => string): void {}
