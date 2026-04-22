const WORLD_WIDTH = 4000;
const DEFAULT_LANE_COUNT = 12;
const DEFAULT_TOP_OFFSET = 48;
const DEFAULT_VERTICAL_SPACING = 54;

function hashSeed(input) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function generateMessagePlacement(seedInput, text = "") {
  const seed = hashSeed(seedInput);
  const laneCount = DEFAULT_LANE_COUNT;
  const cardWidth = 168;
  const noteWidthPct = (cardWidth / WORLD_WIDTH) * 100;
  const laneWidthPct = 100 / laneCount;
  const lane = seed % laneCount;
  const laneStartPct = lane * laneWidthPct;
  const jitterSpan = Math.max(1, laneWidthPct - noteWidthPct - 0.8);
  const jitter = (((seed >> 4) % 100) / 100) * jitterSpan;
  const leftPct = Math.min(98 - noteWidthPct, laneStartPct + jitter);
  const bodyLines = Math.min(4, Math.ceil(text.length / 38));
  const verticalBand = (seed >> 8) % 22;
  const topPx = DEFAULT_TOP_OFFSET + verticalBand * (DEFAULT_VERTICAL_SPACING + bodyLines * 6) + ((seed >> 12) % 24);
  const rotationDeg = (((seed >> 16) % 11) - 5) * 0.8;

  return {
    pos_x: Number(leftPct.toFixed(3)),
    pos_y: Number(topPx.toFixed(2)),
    rotation: Number(rotationDeg.toFixed(3)),
  };
}
