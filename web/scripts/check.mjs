// Physics self-check for CI: free-field spreading, the wake curve's anchors, shielding, the range, elevated sources.
const { selfCheck } = await import("../src/honk/physics.ts");
let fails = 0;
console.assert = (ok, ...msg) => { if (!ok) { fails++; console.error("FAIL", ...msg); } };
selfCheck();
console.log(fails ? `${fails} physics check(s) failed` : "physics checks pass");

// The scorecard sentence must say which side is ahead: skill is negative when the model trails its baseline.
const { skillSentence } = await import("../src/verdict.ts");
const before = fails;
const ahead = skillSentence({ skill: 0.04, ci: [0.01, 0.07] });
console.assert(ahead === "4.0% less error, with a 95% range of 1.0% less to 7.0% less when whole weeks are resampled", "model ahead:", ahead);
const unsure = skillSentence({ skill: -0.035, ci: [-0.127, 0.048] });
console.assert(unsure.startsWith("3.5% more error") && unsure.includes("12.7% more to 4.8% less") && unsure.endsWith("includes zero, so that edge is not established"), "undecided:", unsure);
const behind = skillSentence({ skill: -0.083, ci: [-0.171, -0.01] });
console.assert(behind.startsWith("8.3% more error") && behind.includes("17.1% more to 1.0% more") && behind.endsWith("excludes zero, so that baseline is ahead on this holdout"), "model behind:", behind);
console.assert(!/-\d/.test(ahead + unsure + behind), "no signed percentages beside the words less/more");
console.log(fails > before ? `${fails - before} scorecard wording check(s) failed` : "scorecard wording checks pass");
process.exit(fails ? 1 : 0);
