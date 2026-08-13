// The `igv` package's `main` field is a UMD bundle without a `default` export,
// so we import the runtime value from its ESM build (`igv/dist/igv.esm.js`).
// That subpath ships no `.d.ts`, so re-map it to the package's typed default
// export here (the two are the same `IGV` object).
declare module "igv/dist/igv.esm.js" {
  import igv from "igv";
  export default igv;
}
