/**
 * Reads resolved CSS safe-area inset variables (in pixels) from documentElement.
 */
export function getSafeAreaInsets() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { top: 0, bottom: 0, left: 0, right: 0 };
  }
  const style = getComputedStyle(document.documentElement);
  const parsePx = (name) => {
    const val = parseFloat(style.getPropertyValue(name));
    return Number.isFinite(val) ? val : 0;
  };
  return {
    top: parsePx("--safe-top"),
    bottom: parsePx("--safe-bottom"),
    left: parsePx("--safe-left"),
    right: parsePx("--safe-right"),
  };
}
