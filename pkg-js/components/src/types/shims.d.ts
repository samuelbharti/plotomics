// regl-scatterplot ships its own types in recent versions, but we declare a
// permissive module here so the build is resilient across versions and the
// strict project tsconfig never fails on it. The factory code uses a narrow,
// documented slice of the API.
declare module "regl-scatterplot";
