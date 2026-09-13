export type RGB = readonly [number, number, number];

// Sequential heat colormap (matplotlib "inferno"): near-black purple ->
// magenta -> orange -> pale yellow for t in [0, 1].
const INFERNO_STOPS: readonly (readonly [number, RGB])[] = [
  [0.0, [0, 0, 4]],
  [0.13, [31, 12, 72]],
  [0.25, [85, 15, 109]],
  [0.38, [136, 34, 106]],
  [0.5, [186, 54, 85]],
  [0.63, [227, 89, 51]],
  [0.75, [249, 140, 10]],
  [0.88, [252, 201, 75]],
  [1.0, [252, 255, 164]],
];

export function inferno(t: number): RGB {
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
  for (let i = 1; i < INFERNO_STOPS.length; i++) {
    const [tA, rgbA] = INFERNO_STOPS[i - 1]!;
    const [tB, rgbB] = INFERNO_STOPS[i]!;
    if (clamped <= tB) {
      const f = (clamped - tA) / (tB - tA);
      return [Math.round(rgbA[0] + (rgbB[0] - rgbA[0]) * f), Math.round(rgbA[1] + (rgbB[1] - rgbA[1]) * f), Math.round(rgbA[2] + (rgbB[2] - rgbA[2]) * f)];
    }
  }
  return INFERNO_STOPS[INFERNO_STOPS.length - 1]![1];
}
