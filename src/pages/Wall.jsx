import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabase } from "../utils/supabaseClient.js";
import WallBackground from "../components/WallBackground.jsx";

const MAX_MESSAGES = 50;
const POSITIONS_STORAGE_KEY = "ccs-freedom-screen-note-positions";

// The infinite canvas world is this wide. Cards spread across it.
// Tall direction grows dynamically based on card count.
const WORLD_WIDTH = 4000;

// ─── localStorage helpers ────────────────────────────────────────────────────

function loadSavedPositions() {
  try {
    if (typeof window === "undefined") return {};
    const raw = window.localStorage.getItem(POSITIONS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persistPosition(id, leftPct, topPx) {
  try {
    const existing = loadSavedPositions();
    existing[id] = { leftPct, topPx };
    window.localStorage.setItem(POSITIONS_STORAGE_KEY, JSON.stringify(existing));
  } catch {}
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

function capMessages(messages) {
  return [...messages]
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .slice(-MAX_MESSAGES);
}

function mergeMessages(previous, incoming) {
  const merged = new Map();
  [...previous, ...incoming].forEach((message) => {
    if (message.is_deleted) { merged.delete(message.id); return; }
    merged.set(message.id, message);
  });
  return capMessages(Array.from(merged.values()));
}

function removeMessage(previous, id) {
  return previous.filter((message) => message.id !== id);
}

function hashSeed(input) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function extensionFor(language) {
  switch (language) {
    case "JavaScript": return "js";
    case "Java":       return "java";
    case "C++":        return "cpp";
    case "Python":     return "py";
    default:           return "txt";
  }
}

function wrapAsciiText(text, width) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [""];
  const words = normalized.split(" ");
  const lines = [];
  let currentLine = "";
  for (const word of words) {
    if (word.length > width) {
      if (currentLine) { lines.push(currentLine); currentLine = ""; }
      for (let index = 0; index < word.length; index += width) {
        lines.push(word.slice(index, index + width));
      }
      continue;
    }
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (candidate.length > width) { lines.push(currentLine); currentLine = word; continue; }
    currentLine = candidate;
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

function buildAsciiEntry(message, widthChars) {
  const fileLabel = `entry.${extensionFor(message.language)}`;
  const timeLabel = new Date(message.created_at).toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit",
  });
  const bodyLines = wrapAsciiText(message.text, widthChars).slice(0, 6);
  const border = `+${"-".repeat(widthChars + 2)}+`;
  const padLine = (value) => `| ${value.padEnd(widthChars, " ")} |`;
  const header = `${fileLabel} ${timeLabel}`.slice(0, widthChars);
  return [border, padLine(header), padLine(""), ...bodyLines.map((l) => padLine(l.slice(0, widthChars))), border].join("\n");
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Wall() {
  const [messages, setMessages]       = useState([]);
  const [isLoading, setIsLoading]     = useState(true);
  const [status, setStatus]           = useState(null);
  const [boardHeight, setBoardHeight] = useState(0);
  const [placementReady, setPlacementReady] = useState(0);
  const [userPositions, setUserPositions]   = useState(() => loadSavedPositions());
  const [draggingId, setDraggingId]   = useState(null);

  // ── Infinite canvas pan state ──────────────────────────────────────────────
  const [pan, setPan]           = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panRef                  = useRef({ x: 0, y: 0 });
  const panDragRef              = useRef(null);
  const viewportRef             = useRef(null);

  const placementsRef   = useRef({});
  const laneHeightsRef  = useRef([]);
  const boardRef        = useRef(null);
  const dragRef         = useRef(null);

  // ── Viewport resize ────────────────────────────────────────────────────────
  // (we no longer need viewportWidth for placement since we use WORLD_WIDTH)

  // ── Supabase fetch + realtime ──────────────────────────────────────────────

  useEffect(() => {
    void fetchMessages(true);
    const refreshInterval = window.setInterval(() => void fetchMessages(false), 45000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void fetchMessages(false);
    };
    document.addEventListener("visibilitychange", handleVisibility);
    const channel = supabase
      .channel("public:messages-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (payload) => {
        if (payload.eventType === "DELETE") {
          setMessages((prev) => removeMessage(prev, payload.old.id));
          return;
        }
        setMessages((prev) => mergeMessages(prev, [payload.new]));
      })
      .subscribe((s) => {
        if (s === "CHANNEL_ERROR") setStatus("realtime offline; polling fallback active");
        if (s === "SUBSCRIBED")    setStatus(null);
      });
    return () => {
      window.clearInterval(refreshInterval);
      document.removeEventListener("visibilitychange", handleVisibility);
      void supabase.removeChannel(channel);
    };
  }, []);

  // ── Placement computation ──────────────────────────────────────────────────

  useEffect(() => {
    const currentIds = new Set(messages.map((m) => m.id));

    if (messages.length === 0) {
      placementsRef.current = {};
      laneHeightsRef.current = [];
      setBoardHeight(Math.max(window.innerHeight, 600));
      setPlacementReady((v) => v + 1);
      return;
    }

    Object.keys(placementsRef.current).forEach((key) => {
      if (!currentIds.has(Number(key))) delete placementsRef.current[Number(key)];
    });

    // Use WORLD_WIDTH so cards spread across the full infinite canvas
    const laneCount = Math.max(6, Math.min(16, Math.floor(WORLD_WIDTH / 280)));

    if (laneHeightsRef.current.length === 0) {
      laneHeightsRef.current = Array.from({ length: laneCount }, () => 56);
    } else if (laneHeightsRef.current.length < laneCount) {
      laneHeightsRef.current = Array.from({ length: laneCount }, (_, i) => laneHeightsRef.current[i] ?? 56);
    }

    for (const message of messages) {
      if (placementsRef.current[message.id]) continue;

      const seed        = hashSeed(`${message.id}-${message.created_at}`);
      const lane        = seed % laneCount;
      const widthChars  = 22 + (seed % 9);
      const bodyLines   = wrapAsciiText(message.text, widthChars).slice(0, 6).length;
      const heightPx    = 92 + bodyLines * 26;
      const noteWidthPx = widthChars * 9.4 + 44;
      const laneWidthPct  = 100 / laneCount;
      const noteWidthPct  = (noteWidthPx / WORLD_WIDTH) * 100;
      const leftStartPct  = lane * laneWidthPct + 0.5;
      const jitterSpan    = Math.max(0.5, laneWidthPct - noteWidthPct - 1);
      const jitter        = (((seed >> 4) % 100) / 100) * jitterSpan;
      const leftPct       = Math.min(98 - noteWidthPct, leftStartPct + jitter);
      const topPx         = laneHeightsRef.current[lane] + ((seed >> 8) % 18);
      const rotationDeg   = ((seed % 11) - 5) * 0.8;

      laneHeightsRef.current[lane] = topPx + heightPx + 20 + ((seed >> 10) % 18);
      placementsRef.current[message.id] = { leftPct, topPx, widthChars, heightPx, rotationDeg };
    }

    const nextHeight = messages.reduce((max, m) => {
      const p = placementsRef.current[m.id];
      if (!p) return max;
      return Math.max(max, p.topPx + p.heightPx);
    }, Math.max(window.innerHeight, 600));

    setBoardHeight(nextHeight + 64);
    setPlacementReady((v) => v + 1);
  }, [messages]);

  // ── Placed messages memo ───────────────────────────────────────────────────

  const placedMessages = useMemo(() => {
    return messages
      .map((message) => {
        const placement = placementsRef.current[message.id];
        if (!placement) return null;
        const saved = userPositions[message.id];
        const effectivePlacement = saved
          ? { ...placement, leftPct: saved.leftPct, topPx: saved.topPx }
          : placement;
        return { message, placement: effectivePlacement, ascii: buildAsciiEntry(message, placement.widthChars) };
      })
      .filter(Boolean);
  }, [messages, placementReady, userPositions]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Canvas pan handlers ────────────────────────────────────────────────────

  const handleCanvasPointerDown = useCallback((e) => {
    // Only pan when clicking the canvas itself — notes call stopPropagation
    panDragRef.current = {
      startPx: e.clientX,
      startPy: e.clientY,
      startOx: panRef.current.x,
      startOy: panRef.current.y,
    };
    setIsPanning(true);
    viewportRef.current?.setPointerCapture(e.pointerId);
  }, []);

  const handleCanvasPointerMove = useCallback((e) => {
    if (!panDragRef.current) return;
    const newPan = {
      x: panDragRef.current.startOx + (e.clientX - panDragRef.current.startPx),
      y: panDragRef.current.startOy + (e.clientY - panDragRef.current.startPy),
    };
    panRef.current = newPan;
    setPan(newPan);
  }, []);

  const handleCanvasPointerUp = useCallback(() => {
    panDragRef.current = null;
    setIsPanning(false);
  }, []);

  const resetView = useCallback(() => {
    panRef.current = { x: 0, y: 0 };
    setPan({ x: 0, y: 0 });
  }, []);

  // ── Note drag handlers ─────────────────────────────────────────────────────

  const handlePointerDown = (e, id, currentLeftPct, currentTopPx) => {
    e.preventDefault();
    e.stopPropagation(); // ← keeps canvas from starting a pan
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      id,
      startPointerX: e.clientX,
      startPointerY: e.clientY,
      startLeftPct: currentLeftPct,
      startTopPx: currentTopPx,
      boardWidth: WORLD_WIDTH,
    };
    setDraggingId(id);
  };

  const handlePointerMove = (e, id) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== id) return;
    const deltaLeftPct = ((e.clientX - drag.startPointerX) / drag.boardWidth) * 100;
    const newLeftPct = Math.max(0, Math.min(96, drag.startLeftPct + deltaLeftPct));
    const newTopPx   = Math.max(36, drag.startTopPx + (e.clientY - drag.startPointerY));
    setUserPositions((prev) => ({ ...prev, [id]: { leftPct: newLeftPct, topPx: newTopPx } }));
  };

  const handlePointerUp = (e, id) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== id) return;
    const deltaLeftPct = ((e.clientX - drag.startPointerX) / drag.boardWidth) * 100;
    const finalLeftPct = Math.max(0, Math.min(96, drag.startLeftPct + deltaLeftPct));
    const finalTopPx   = Math.max(36, drag.startTopPx + (e.clientY - drag.startPointerY));
    persistPosition(id, finalLeftPct, finalTopPx);
    dragRef.current = null;
    setDraggingId(null);
  };

  const handlePointerCancel = (_e, id) => {
    if (dragRef.current?.id === id) dragRef.current = null;
    setDraggingId(null);
  };

  // ── Fetch helper ───────────────────────────────────────────────────────────

  const fetchMessages = async (showSpinner) => {
    if (showSpinner) setIsLoading(true);
    const extendedQuery = await supabase
      .from("messages")
      .select("id,text,created_at,language,full_code,is_deleted")
      .order("created_at", { ascending: false })
      .limit(MAX_MESSAGES);
    if (!extendedQuery.error) {
      setMessages(capMessages((extendedQuery.data ?? []).filter((m) => !m.is_deleted)));
      setStatus(null);
      setIsLoading(false);
      return;
    }
    const fallbackQuery = await supabase
      .from("messages").select("id,text,created_at")
      .order("created_at", { ascending: false }).limit(MAX_MESSAGES);
    if (fallbackQuery.error) { setStatus("wall offline"); setIsLoading(false); return; }
    setMessages(capMessages(fallbackQuery.data ?? []));
    setStatus(null);
    setIsLoading(false);
  };

  // ── Minimap data ───────────────────────────────────────────────────────────
  // Shows a tiny dot-map of card positions so users can orient themselves

  const minimapCards = useMemo(() => {
    if (placedMessages.length === 0) return [];
    return placedMessages.map(({ placement }) => ({
      x: placement.leftPct,              // 0–100 % of WORLD_WIDTH
      y: Math.min((placement.topPx / Math.max(boardHeight, 1)) * 100, 100),
    }));
  }, [placedMessages, boardHeight]);

  // Viewport indicator in minimap
  const minimapViewport = useMemo(() => {
    const vw = viewportRef.current?.clientWidth  ?? window.innerWidth;
    const vh = viewportRef.current?.clientHeight ?? window.innerHeight;
    const vpW = (vw / WORLD_WIDTH) * 100;
    const vpH = (vh / Math.max(boardHeight, 1)) * 100;
    const vpX = (-panRef.current.x / WORLD_WIDTH) * 100;
    const vpY = (-panRef.current.y / Math.max(boardHeight, 1)) * 100;
    return { vpW, vpH, vpX: Math.max(0, vpX), vpY: Math.max(0, vpY) };
  }, [pan, boardHeight]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <main style={styles.page}>
      {/* ── Viewport — fixed window into the world ── */}
      <section
        ref={viewportRef}
        style={{
          ...styles.viewport,
          cursor: isPanning ? "grabbing" : "grab",
        }}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerCancel={handleCanvasPointerUp}
      >
        {/* ── Background — stays fixed in viewport ── */}
        <WallBackground />

        {/* ── HUD — fixed overlays, pointer-events selectively on ── */}
        <div style={styles.hud}>
          <div style={styles.promptLine}>tail -f ccs-freedom-screen.log</div>
          <div style={styles.dragHint}>drag notes · pan canvas</div>
          {status && <div style={styles.statusLine}>{status}</div>}

          {/* Reset view button */}
          {(pan.x !== 0 || pan.y !== 0) && (
            <button
              style={styles.resetBtn}
              onClick={resetView}
              onPointerDown={(e) => e.stopPropagation()}
            >
              ⌖ reset view
            </button>
          )}

          {/* Minimap */}
          {placedMessages.length > 0 && (
            <div style={styles.minimap}>
              {minimapCards.map((c, i) => (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    left: `${c.x}%`,
                    top:  `${c.y}%`,
                    width: 2,
                    height: 2,
                    background: "#00ff88",
                    borderRadius: 1,
                    opacity: 0.7,
                  }}
                />
              ))}
              {/* Viewport indicator */}
              <div
                style={{
                  position: "absolute",
                  left:   `${minimapViewport.vpX}%`,
                  top:    `${minimapViewport.vpY}%`,
                  width:  `${Math.min(minimapViewport.vpW, 100)}%`,
                  height: `${Math.min(minimapViewport.vpH, 100)}%`,
                  border: "1px solid rgba(0,255,136,0.5)",
                  pointerEvents: "none",
                }}
              />
            </div>
          )}
        </div>

        {/* ── World — pannable container ── */}
        <div
          style={{
            position:   "absolute",
            inset:      0,
            transform:  `translate(${pan.x}px, ${pan.y}px)`,
            willChange: "transform",
            zIndex:     1,
          }}
        >
          {isLoading ? (
            <div style={styles.emptyState}>loading wall...</div>
          ) : placedMessages.length === 0 ? (
            <div style={styles.emptyState}>waiting for first entry...</div>
          ) : (
            <section
              ref={boardRef}
              style={{
                ...styles.board,
                width:  `${WORLD_WIDTH}px`,
                height: `${boardHeight}px`,
              }}
            >
              {placedMessages.map(({ message, placement, ascii }) => (
                <article
                  key={message.id}
                  data-note-id={message.id}
                  style={{
                    ...styles.note,
                    left:      `${placement.leftPct}%`,
                    top:       `${placement.topPx}px`,
                    transform: `rotate(${placement.rotationDeg}deg)`,
                    width:     `${placement.widthChars + 4}ch`,
                    cursor:    draggingId === message.id ? "grabbing" : "grab",
                    userSelect: "none",
                    touchAction: "none",
                    zIndex:    draggingId === message.id ? 10 : 1,
                    transition: draggingId === message.id ? "none" : "box-shadow 120ms ease",
                    boxShadow:  draggingId === message.id
                      ? "0 8px 32px rgba(0, 255, 136, 0.18)"
                      : undefined,
                  }}
                  onPointerDown={(e) => handlePointerDown(e, message.id, placement.leftPct, placement.topPx)}
                  onPointerMove={(e) => handlePointerMove(e, message.id)}
                  onPointerUp={(e)   => handlePointerUp(e, message.id)}
                  onPointerCancel={(e) => handlePointerCancel(e, message.id)}
                >
                  <div style={styles.noteShell}>
                    <pre style={styles.noteAscii}>{ascii}</pre>
                  </div>
                </article>
              ))}
            </section>
          )}
        </div>
      </section>
    </main>
  );
}

const styles = {
  page: {
    height:     "100dvh",
    padding:    "12px",
    background: "#000000",
    color:      "#00ff88",
    overflow:   "hidden",   // page never scrolls — canvas pans instead
    boxSizing:  "border-box",
  },
  // Fixed-size window into the infinite world
  viewport: {
    position:   "relative",
    height:     "calc(100dvh - 24px)",
    overflow:   "hidden",
    border:     "1px solid #111111",
    background: "repeating-linear-gradient(180deg, rgba(0, 255, 136, 0.03) 0 1px, transparent 1px 3px), #050505",
    userSelect: "none",
  },
  // HUD sits above everything, pointer-events: none except interactive children
  hud: {
    position:      "absolute",
    inset:         0,
    zIndex:        20,
    pointerEvents: "none",
  },
  promptLine: {
    position:      "absolute",
    top:           "12px",
    left:          "12px",
    fontSize:      "12px",
    color:         "#4f7a63",
    pointerEvents: "none",
  },
  dragHint: {
    position:      "absolute",
    top:           "12px",
    left:          "50%",
    transform:     "translateX(-50%)",
    fontSize:      "11px",
    color:         "#2a4a38",
    letterSpacing: "0.06em",
    pointerEvents: "none",
    whiteSpace:    "nowrap",
  },
  statusLine: {
    position:      "absolute",
    top:           "12px",
    right:         "12px",
    fontSize:      "12px",
    color:         "#8cae9a",
    pointerEvents: "none",
  },
  resetBtn: {
    position:       "absolute",
    bottom:         "48px",
    right:          "12px",
    pointerEvents:  "all",
    background:     "rgba(0,0,0,0.75)",
    border:         "1px solid #1a3d2a",
    color:          "#4f7a63",
    fontSize:       "11px",
    padding:        "4px 10px",
    cursor:         "pointer",
    letterSpacing:  "0.06em",
    fontFamily:     'Consolas, Monaco, "Courier New", monospace',
    borderRadius:   "2px",
    transition:     "color 120ms, border-color 120ms",
  },
  // Minimap in bottom-right corner
  minimap: {
    position:      "absolute",
    bottom:        "12px",
    right:         "12px",
    width:         "120px",
    height:        "70px",
    border:        "1px solid #1a3d2a",
    background:    "rgba(0,0,0,0.6)",
    pointerEvents: "none",
    overflow:      "hidden",
  },
  emptyState: {
    position:    "absolute",
    inset:       0,
    display:     "grid",
    placeItems:  "center",
    fontSize:    "14px",
    color:       "#5b7a69",
    pointerEvents: "none",
  },
  board: {
    position: "relative",
    paddingTop: "36px",
  },
  note: {
    position: "absolute",
  },
  noteShell: {
    padding:    "6px 8px",
    border:     "1px solid #132117",
    background: "rgba(0, 0, 0, 0.88)",
    boxShadow:  "0 0 16px rgba(0, 255, 136, 0.06)",
  },
  noteAscii: {
    margin:      0,
    fontSize:    "14px",
    lineHeight:  1.45,
    color:       "#00ff88",
    whiteSpace:  "pre",
    fontFamily:  'Consolas, Monaco, "Courier New", monospace',
    pointerEvents: "none",
  },
};