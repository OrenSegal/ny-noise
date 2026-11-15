// Physics self-check for CI: free-field spreading, the wake curve's anchors, shielding, the range, elevated sources.
const { selfCheck } = await import("../src/honk/physics.ts");
let fails = 0;
console.assert = (ok, ...msg) => { if (!ok) { fails++; console.error("FAIL", ...msg); } };
selfCheck();
console.log(fails ? `${fails} physics check(s) failed` : "physics checks pass");
process.exit(fails ? 1 : 0);
