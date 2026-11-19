// The scorecard's sentence on the selected model against a baseline. Skill is the reduction in weighted error, so it
// is negative when the model is behind; the refresh job reruns weekly and either side can be ahead on a given holdout.
type Edge = { skill: number; ci: [number, number] };

const side = (v: number) => `${(Math.abs(v) * 100).toFixed(1)}% ${v >= 0 ? "less" : "more"}`;

export function skillSentence({ skill, ci }: Edge): string {
  const verdict = ci[0] > 0 ? "" // the whole range is on the model's side: nothing to hedge
    : ci[1] < 0 ? ", which excludes zero, so that baseline is ahead on this holdout"
    : ", which includes zero, so that edge is not established";
  return `${side(skill)} error, with a 95% range of ${side(ci[0])} to ${side(ci[1])} when whole weeks are resampled${verdict}`;
}
