const WORLD_WIDTH = 4000;
const BASE_CARD_WIDTH = 294;
const DEFAULT_LANE_COUNT = 12;
const DEFAULT_TOP_OFFSET = 48;
const DEFAULT_VERTICAL_SPACING = 68;
const HORIZONTAL_MARGIN_PCT = 1.2;

export function hashSeed(input, salt = 0) {
  let h = (2166136261 ^ salt) >>> 0;
  const str = String(input ?? "");
  for (let index = 0; index < str.length; index += 1) {
    h ^= str.charCodeAt(index);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function generateMessagePlacement(seedInput, text = "") {
  const seedX = hashSeed(seedInput, 1);
  const seedY = hashSeed(seedInput, 2);
  const seedR = hashSeed(seedInput, 3);

  const laneCount = DEFAULT_LANE_COUNT;
  const noteWidthPct = (BASE_CARD_WIDTH / WORLD_WIDTH) * 100;
  const usableWidthPct = 100 - HORIZONTAL_MARGIN_PCT * 2;
  const laneWidthPct = usableWidthPct / laneCount;
  const lane = seedX % laneCount;
  const laneStartPct = HORIZONTAL_MARGIN_PCT + lane * laneWidthPct;
  const jitterSpan = Math.max(0.4, laneWidthPct - noteWidthPct - 0.35);
  const jitter = (((seedX >>> 8) % 1000) / 1000) * jitterSpan;
  const maxLeftPct = 100 - HORIZONTAL_MARGIN_PCT - noteWidthPct;
  const leftPct = Math.max(HORIZONTAL_MARGIN_PCT, Math.min(maxLeftPct, laneStartPct + jitter));

  const bodyLines = Math.min(4, Math.ceil(String(text ?? "").length / 38));
  const verticalBand = seedY % 20;
  const topPx =
    DEFAULT_TOP_OFFSET +
    verticalBand * (DEFAULT_VERTICAL_SPACING + bodyLines * 6) +
    ((seedY >>> 8) % 36);
  const rotationDeg = ((seedR % 11) - 5) * 0.8;

  return {
    pos_x: Number(leftPct.toFixed(3)),
    pos_y: Number(topPx.toFixed(2)),
    rotation: Number(rotationDeg.toFixed(3)),
  };
}
