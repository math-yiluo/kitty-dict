declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface Platform {}
  }
}

declare module '*.wasm?url' {
  const url: string;
  export default url;
}

declare module '*?url' {
  const url: string;
  export default url;
}

export {};
