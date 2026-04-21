import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../utils/supabaseClient.js";
import WallBackground from "../components/WallBackground.jsx";

const MAX_MESSAGES = 50;
const POSITIONS_STORAGE_KEY = "ccs-freedom-screen-note-positions";

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
    if (message.is_deleted) {
      merged.delete(message.id);
      return;
    }

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
    case "JavaScript":
      return "js";
    case "Java":
      return "java";
    case "C++":
      return "cpp";
    case "Python":
      return "py";
    default:
      return "txt";
  }
}

function wrapAsciiText(text, width) {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return [""];
  }

  const words = normalized.split(" ");
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    if (word.length > width) {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = "";
      }

      for (let index = 0; index < word.length; index += width) {
        lines.push(word.slice(index, index + width));
      }

      continue;
    }

    const candidate = currentLine ? `${currentLine} ${word}` : word;

    if (candidate.length > width) {
      lines.push(currentLine);
      currentLine = word;
      continue;
    }

    currentLine = candidate;
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

function buildAsciiEntry(message, widthChars) {
  const fileLabel = `entry.${extensionFor(message.language)}`;
  const timeLabel = new Date(message.created_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const bodyLines = wrapAsciiText(message.text, widthChars).slice(0, 6);
  const border = `+${"-".repeat(widthChars + 2)}+`;
  const padLine = (value) => `| ${value.padEnd(widthChars, " ")} |`;
  const header = `${fileLabel} ${timeLabel}`.slice(0, widthChars);
  const lines = [
    border,
    padLine(header),
    padLine(""),
    ...bodyLines.map((line) => padLine(line.slice(0, widthChars))),
    border,
  ];

  return lines.join("\n");
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Wall() {
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState(null);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === "undefined" ? 1440 : window.innerWidth
  );
  const [boardHeight, setBoardHeight] = useState(0);

  // Bumped every time placements are (re)computed — ensures the memo always
  // re-runs after a new message arrives, even when boardHeight stays the same.
  const [placementReady, setPlacementReady] = useState(0);

  // User-dragged positions, keyed by message.id. Loaded from localStorage and
  // updated live while dragging.  Saved to localStorage on pointer-up.
  const [userPositions, setUserPositions] = useState(() => loadSavedPositions());

  // Which note is currently being dragged (for cursor styling only)
  const [draggingId, setDraggingId] = useState(null);

  const placementsRef = useRef({});
  const laneHeightsRef = useRef([]);
  const boardRef = useRef(null);

  // Drag state stored in a ref so pointermove never causes extra re-renders
  const dragRef = useRef(null);

  // ── Viewport resize ────────────────────────────────────────────────────────

  useEffect(() => {
    const syncViewport = () => setViewportWidth(window.innerWidth);
    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  }, []);

  // ── Supabase fetch + realtime ──────────────────────────────────────────────

  useEffect(() => {
    void fetchMessages(true);

    const refreshInterval = window.setInterval(() => {
      void fetchMessages(false);
    }, 45000);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void fetchMessages(false);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    const channel = supabase
      .channel("public:messages-feed")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const deleted = payload.old;
            setMessages((previous) => removeMessage(previous, deleted.id));
            return;
          }

          const next = payload.new;
          setMessages((previous) => mergeMessages(previous, [next]));
        },
      )
      .subscribe((subscriptionStatus) => {
        if (subscriptionStatus === "CHANNEL_ERROR") {
          setStatus("realtime offline; polling fallback active");
        }

        if (subscriptionStatus === "SUBSCRIBED") {
          setStatus(null);
        }
      });

    return () => {
      window.clearInterval(refreshInterval);
      document.removeEventListener("visibilitychange", handleVisibility);
      void supabase.removeChannel(channel);
    };
  }, []);

  // ── Placement computation ──────────────────────────────────────────────────
  // Runs whenever messages or viewport changes. After computing, bumps
  // placementReady so the memo below always re-evaluates.

  useEffect(() => {
    const currentIds = new Set(messages.map((message) => message.id));

    if (messages.length === 0) {
      placementsRef.current = {};
      laneHeightsRef.current = [];
      setBoardHeight(Math.max(window.innerHeight - 40, 480));
      setPlacementReady((v) => v + 1);
      return;
    }

    Object.keys(placementsRef.current).forEach((key) => {
      if (!currentIds.has(Number(key))) {
        delete placementsRef.current[Number(key)];
      }
    });

    const boardWidth = Math.max(720, viewportWidth - 32);
    const laneCount = Math.max(3, Math.min(8, Math.floor(boardWidth / 220)));

    if (laneHeightsRef.current.length === 0) {
      laneHeightsRef.current = Array.from({ length: laneCount }, () => 56);
    } else if (laneHeightsRef.current.length < laneCount) {
      laneHeightsRef.current = Array.from(
        { length: laneCount },
        (_, index) => laneHeightsRef.current[index] ?? 56
      );
    }

    for (const message of messages) {
      if (placementsRef.current[message.id]) {
        continue;
      }

      const seed = hashSeed(`${message.id}-${message.created_at}`);
      const lane = seed % laneCount;
      const widthChars = 22 + (seed % 9);
      const bodyLineCount = wrapAsciiText(message.text, widthChars).slice(0, 6).length;
      const heightPx = 92 + bodyLineCount * 26;
      const noteWidthPx = widthChars * 9.4 + 44;
      const laneWidthPct = 100 / laneCount;
      const noteWidthPct = (noteWidthPx / boardWidth) * 100;
      const leftStartPct = lane * laneWidthPct + 1;
      const jitterSpan = Math.max(1.2, laneWidthPct - noteWidthPct - 2);
      const jitter = (((seed >> 4) % 100) / 100) * jitterSpan;
      const leftPct = Math.min(98 - noteWidthPct, leftStartPct + jitter);
      const topPx = laneHeightsRef.current[lane] + ((seed >> 8) % 18);
      const rotationDeg = ((seed % 11) - 5) * 0.8;

      laneHeightsRef.current[lane] = topPx + heightPx + 20 + ((seed >> 10) % 18);

      placementsRef.current[message.id] = {
        leftPct,
        topPx,
        widthChars,
        heightPx,
        rotationDeg,
      };
    }

    const nextHeight = messages.reduce((maxHeight, message) => {
      const placement = placementsRef.current[message.id];
      if (!placement) return maxHeight;
      return Math.max(maxHeight, placement.topPx + placement.heightPx);
    }, Math.max(window.innerHeight - 40, 480));

    setBoardHeight(nextHeight + 32);

    // Always bump — guarantees the memo reruns even when boardHeight is unchanged
    setPlacementReady((v) => v + 1);
  }, [messages, viewportWidth]);

  // ── Placed messages memo ───────────────────────────────────────────────────
  // Depends on placementReady so it re-evaluates every time placements update,
  // and on userPositions so drag moves instantly reflect on screen.

  const placedMessages = useMemo(() => {
    return messages
      .map((message) => {
        const placement = placementsRef.current[message.id];
        if (!placement) return null;

        const saved = userPositions[message.id];
        const effectivePlacement = saved
          ? { ...placement, leftPct: saved.leftPct, topPx: saved.topPx }
          : placement;

        return {
          message,
          placement: effectivePlacement,
          ascii: buildAsciiEntry(message, placement.widthChars),
        };
      })
      .filter((entry) => entry !== null);
  }, [messages, placementReady, userPositions]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Drag handlers ──────────────────────────────────────────────────────────

  const handlePointerDown = (e, id, currentLeftPct, currentTopPx) => {
    e.preventDefault();
    (e.currentTarget).setPointerCapture(e.pointerId);

    const boardEl = boardRef.current;
    if (!boardEl) return;

    dragRef.current = {
      id,
      startPointerX: e.clientX,
      startPointerY: e.clientY,
      startLeftPct: currentLeftPct,
      startTopPx: currentTopPx,
      boardWidth: boardEl.getBoundingClientRect().width,
    };

    setDraggingId(id);
  };

  const handlePointerMove = (e, id) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== id) return;

    const deltaX = e.clientX - drag.startPointerX;
    const deltaY = e.clientY - drag.startPointerY;
    const deltaLeftPct = (deltaX / drag.boardWidth) * 100;

    const newLeftPct = Math.max(0, Math.min(96, drag.startLeftPct + deltaLeftPct));
    const newTopPx = Math.max(36, drag.startTopPx + deltaY);

    setUserPositions((prev) => ({
      ...prev,
      [id]: { leftPct: newLeftPct, topPx: newTopPx },
    }));
  };

  const handlePointerUp = (e, id) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== id) return;

    const deltaX = e.clientX - drag.startPointerX;
    const deltaY = e.clientY - drag.startPointerY;
    const deltaLeftPct = (deltaX / drag.boardWidth) * 100;

    const finalLeftPct = Math.max(0, Math.min(96, drag.startLeftPct + deltaLeftPct));
    const finalTopPx = Math.max(36, drag.startTopPx + deltaY);

    // Persist final position to localStorage
    persistPosition(id, finalLeftPct, finalTopPx);

    dragRef.current = null;
    setDraggingId(null);
  };

  const handlePointerCancel = (_e, id) => {
    if (dragRef.current?.id === id) {
      dragRef.current = null;
    }
    setDraggingId(null);
  };

  // ── Fetch helper ───────────────────────────────────────────────────────────

  const fetchMessages = async (showSpinner) => {
    if (showSpinner) {
      setIsLoading(true);
    }

    const extendedQuery = await supabase
      .from("messages")
      .select("id,text,created_at,language,full_code,is_deleted")
      .order("created_at", { ascending: false })
      .limit(MAX_MESSAGES);

    if (!extendedQuery.error) {
      setMessages(
        capMessages((extendedQuery.data ?? []).filter((message) => !message.is_deleted))
      );
      setStatus(null);
      setIsLoading(false);
      return;
    }

    const fallbackQuery = await supabase
      .from("messages")
      .select("id,text,created_at")
      .order("created_at", { ascending: false })
      .limit(MAX_MESSAGES);

    if (fallbackQuery.error) {
      setStatus("wall offline");
      setIsLoading(false);
      return;
    }

    setMessages(capMessages(fallbackQuery.data ?? []));
    setStatus(null);
    setIsLoading(false);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <main style={styles.page}>
      <section style={styles.canvas}>
        <WallBackground />

        <div style={styles.content}>
          <div style={styles.promptLine}>tail -f ccs-freedom-screen.log</div>
          <div style={styles.dragHint}>drag entries to rearrange</div>

          {status && <div style={styles.statusLine}>{status}</div>}

          {isLoading ? (
            <div style={styles.emptyState}>loading wall...</div>
          ) : placedMessages.length === 0 ? (
            <div style={styles.emptyState}>waiting for first entry...</div>
          ) : (
            <section
              ref={boardRef}
              style={{ ...styles.board, minHeight: `${boardHeight}px` }}
            >
              {placedMessages.map(({ message, placement, ascii }) => (
                <article
                  key={message.id}
                  style={{
                    ...styles.note,
                    left: `${placement.leftPct}%`,
                    top: `${placement.topPx}px`,
                    transform: `rotate(${placement.rotationDeg}deg)`,
                    width: `${placement.widthChars + 4}ch`,
                    cursor: draggingId === message.id ? "grabbing" : "grab",
                    // Prevent text selection and touch scroll while dragging
                    userSelect: "none",
                    touchAction: "none",
                    // Lift the dragged note on top of others
                    zIndex: draggingId === message.id ? 10 : 1,
                    // Snap-back transition only when NOT dragging
                    transition:
                      draggingId === message.id ? "none" : "box-shadow 120ms ease",
                    boxShadow:
                      draggingId === message.id
                        ? "0 8px 32px rgba(0, 255, 136, 0.18)"
                        : undefined,
                  }}
                  onPointerDown={(e) =>
                    handlePointerDown(e, message.id, placement.leftPct, placement.topPx)
                  }
                  onPointerMove={(e) => handlePointerMove(e, message.id)}
                  onPointerUp={(e) => handlePointerUp(e, message.id)}
                  onPointerCancel={(e) => handlePointerCancel(e, message.id)}
                >
                  <div className="wall-note-shell" style={styles.noteShell}>
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
    minHeight: "100dvh",
    padding: "12px",
    background: "#000000",
    color: "#00ff88",
    position: "relative",
  },
  canvas: {
    position: "relative",
    minHeight: "calc(100dvh - 24px)",
    overflow: "hidden",
    border: "1px solid #111111",
    background:
      "repeating-linear-gradient(180deg, rgba(0, 255, 136, 0.03) 0 1px, transparent 1px 3px), #050505",
  },
  content: {
    position: "relative",
    zIndex: 1,
  },
  promptLine: {
    position: "absolute",
    top: "12px",
    left: "12px",
    zIndex: 2,
    fontSize: "12px",
    color: "#4f7a63",
    pointerEvents: "none",
  },
  dragHint: {
    position: "absolute",
    top: "12px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 2,
    fontSize: "11px",
    color: "#2a4a38",
    letterSpacing: "0.06em",
    pointerEvents: "none",
  },
  statusLine: {
    position: "absolute",
    top: "12px",
    right: "12px",
    zIndex: 2,
    fontSize: "12px",
    color: "#8cae9a",
  },
  emptyState: {
    minHeight: "calc(100dvh - 24px)",
    display: "grid",
    placeItems: "center",
    fontSize: "14px",
    color: "#5b7a69",
  },
  board: {
    position: "relative",
    paddingTop: "36px",
  },
  note: {
    position: "absolute",
  },
  noteShell: {
    padding: "6px 8px",
    border: "1px solid #132117",
    background: "rgba(0, 0, 0, 0.88)",
    boxShadow: "0 0 16px rgba(0, 255, 136, 0.06)",
  },
  noteAscii: {
    margin: 0,
    fontSize: "14px",
    lineHeight: 1.45,
    color: "#00ff88",
    whiteSpace: "pre",
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
    pointerEvents: "none",
  },
};