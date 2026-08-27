export function tko_galleryIndex(tko_current: number, tko_total: number, tko_direction: -1 | 1) {
  if (tko_total <= 0) return 0;
  return Math.min(Math.max(tko_current + tko_direction, 0), tko_total - 1);
}
