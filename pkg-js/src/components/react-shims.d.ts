// @types/react is not a dependency; the Gosling component needs only these
// calls from React. This file sits next to the components so the build's
// declaration pass (tsconfig.build.json) sees it too.
declare module "react" {
  export function createElement(type: unknown, props?: unknown): unknown;
  export function createRef<T>(): { readonly current: T | null };
}
declare module "react-dom/client" {
  export interface Root {
    render(node: unknown): void;
    unmount(): void;
  }
  export function createRoot(container: Element): Root;
}
