/**
 * Demo agent/engine fixtures assume an unbound unit (Attract picker):
 * cross-catalog named adds stay allowed. Clear any shell/.env bind so
 * `npm test` stays green when NEXT_PUBLIC_MACHINE_ID=coffee locally.
 * Bound-unit cases set the env inside the test and restore it after.
 */
delete process.env.NEXT_PUBLIC_MACHINE_ID;
