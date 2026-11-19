// Contract 1: opaque transaction handle. Created only by withTransaction() in src/server/db.ts;
// only *.repository.ts / *.server.ts files unwrap it. Domain code passes it through untouched.
declare const txBrand: unique symbol;
export type TxHandle = { readonly [txBrand]: true };
