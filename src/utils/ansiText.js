const ANSI_PATTERN = /\u001b\[([0-9;]*)m/g;

const ANSI_FOREGROUND = {
  30: "#000000",
  31: "#ff6b6b",
  32: "#58d68d",
  33: "#f4d35e",
  34: "#5dade2",
  35: "#c586c0",
  36: "#76d7ea",
  37: "#f5f5f5",
  90: "#7f8c8d",
  91: "#ff8f8f",
  92: "#8ef0b6",
  93: "#ffe08a",
  94: "#8fc8ff",
  95: "#d7a6f4",
  96: "#95f3ff",
  97: "#ffffff",
};

function cloneState(state) {
  return {
    color: state.color,
    backgroundColor: state.backgroundColor,
    fontWeight: state.fontWeight,
  };
}

function clampRgb(value) {
  return Math.max(0, Math.min(255, value));
}

function parseTrueColor(codes, index) {
  if (codes[index + 1] !== 2) return null;
  const red = codes[index + 2];
  const green = codes[index + 3];
  const blue = codes[index + 4];
  if (![red, green, blue].every((value) => Number.isFinite(value))) return null;

  return {
    consumed: 5,
    color: `rgb(${clampRgb(red)}, ${clampRgb(green)}, ${clampRgb(blue)})`,
  };
}

function applyAnsiCodes(state, codes) {
  const nextState = cloneState(state);

  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index];

    if (code === 0) {
      nextState.color = null;
      nextState.backgroundColor = null;
      nextState.fontWeight = null;
      continue;
    }

    if (code === 1) {
      nextState.fontWeight = 700;
      continue;
    }

    if (code === 22) {
      nextState.fontWeight = null;
      continue;
    }

    if (code === 39) {
      nextState.color = null;
      continue;
    }

    if (code === 49) {
      nextState.backgroundColor = null;
      continue;
    }

    if (code === 38) {
      const parsed = parseTrueColor(codes, index);
      if (parsed) {
        nextState.color = parsed.color;
        index += parsed.consumed - 1;
      }
      continue;
    }

    if (code === 48) {
      const parsed = parseTrueColor(codes, index);
      if (parsed) {
        nextState.backgroundColor = parsed.color;
        index += parsed.consumed - 1;
      }
      continue;
    }

    if (ANSI_FOREGROUND[code]) {
      nextState.color = ANSI_FOREGROUND[code];
    }
  }

  return nextState;
}

export function stripAnsiSequences(text) {
  ANSI_PATTERN.lastIndex = 0;
  return String(text ?? "").replace(ANSI_PATTERN, "");
}

export function parseAnsiText(text) {
  const input = String(text ?? "");
  const segments = [];
  let state = { color: null, fontWeight: null };
  let lastIndex = 0;
  ANSI_PATTERN.lastIndex = 0;
  let match = ANSI_PATTERN.exec(input);

  while (match) {
    if (match.index > lastIndex) {
      segments.push({
        text: input.slice(lastIndex, match.index),
        style: cloneState(state),
      });
    }

    const codes = (match[1] || "0")
      .split(";")
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value));

    state = applyAnsiCodes(state, codes.length > 0 ? codes : [0]);
    lastIndex = ANSI_PATTERN.lastIndex;
    match = ANSI_PATTERN.exec(input);
  }

  if (lastIndex < input.length) {
    segments.push({
      text: input.slice(lastIndex),
      style: cloneState(state),
    });
  }

  return segments;
}
