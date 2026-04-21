import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabase } from "../utils/supabaseClient.js";
import WallBackground from "../components/WallBackground.jsx";
import LanguageIcon from "../components/LanguageIcon.jsx";
import terminalIcon from "../images/terminal-icon.svg";
import { setDocumentHead } from "../utils/documentHead.js";
import { getLanguageConfig } from "../utils/languages.js";

const MAX_MESSAGES = 67;
const POSITIONS_STORAGE_KEY = "ccs-freedom-screen-note-positions";
const BASE_NOTE_WIDTH = 168;
const MAX_ZOOM = 2.5;
const FIT_PADDING = 28;

// The infinite canvas world is this wide. Cards spread across it.
// Tall direction grows dynamically based on card count.
const WORLD_WIDTH = 4000;

// SAFE AREA BOUNDARIES (in viewport pixels, not world coordinates)
// These areas should not have entries placed into them
const SAFE_AREA_TOP_HEIGHT = 28;    // Top bar height for title/info
const SAFE_AREA_BOTTOM_HEIGHT = 22; // Footer height for credits/info

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

function renderTerminalPromptIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="48" height="48" fill="white" fillOpacity="0.01" />
      <rect
        x="4"
        y="8"
        width="40"
        height="32"
        rx="2"
        fill="#09140d"
        stroke="#4f7a63"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M12 18L19 24L12 30"
        stroke="#8fd2ad"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M23 32H36"
        stroke="#8fd2ad"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function getViewportMetrics(viewport) {
  return {
    width: viewport?.clientWidth ?? window.innerWidth,
    height: viewport?.clientHeight ?? window.innerHeight,
  };
}

function getFitZoom(boardHeight, viewportWidth, viewportHeight) {
  const availableWidth = Math.max(1, viewportWidth - FIT_PADDING * 2);
  const availableHeight = Math.max(1, viewportHeight - FIT_PADDING * 2);
  return Math.min(
    availableWidth / WORLD_WIDTH,
    availableHeight / Math.max(boardHeight, 1),
    1
  );
}

function clampPan(nextPan, zoom, boardHeight, viewportWidth, viewportHeight) {
  const scaledWidth = WORLD_WIDTH * zoom;
  const scaledHeight = boardHeight * zoom;

  const x = scaledWidth <= viewportWidth
    ? (viewportWidth - scaledWidth) / 2
    : Math.max(viewportWidth - scaledWidth, Math.min(0, nextPan.x));

  const y = scaledHeight <= viewportHeight
    ? (viewportHeight - scaledHeight) / 2
    : Math.max(viewportHeight - scaledHeight, Math.min(0, nextPan.y));

  return { x, y };
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
  const [zoom, setZoom]         = useState(1);
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const panRef                  = useRef({ x: 0, y: 0 });
  const zoomRef                 = useRef(1);
  const panDragRef              = useRef(null);
  const tapRef                  = useRef({ id: null, at: 0 });
  const viewportRef             = useRef(null);

  const placementsRef   = useRef({});
  const laneHeightsRef  = useRef([]);
  const boardRef        = useRef(null);
  const dragRef         = useRef(null);

  useEffect(() => {
    setDocumentHead("CCS Freedom Screen", terminalIcon);
  }, []);

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

  const applyView = useCallback((nextPan, nextZoom) => {
    const { width, height } = getViewportMetrics(viewportRef.current);
    const clampedPan = clampPan(nextPan, nextZoom, boardHeight, width, height);
    panRef.current = clampedPan;
    zoomRef.current = nextZoom;
    setPan(clampedPan);
    setZoom(nextZoom);
  }, [boardHeight]);

  const centerViewAtZoom = useCallback((targetZoom) => {
    const { width, height } = getViewportMetrics(viewportRef.current);
    const centeredPan = {
      x: (width - WORLD_WIDTH * targetZoom) / 2,
      y: (height - boardHeight * targetZoom) / 2,
    };
    applyView(centeredPan, targetZoom);
  }, [applyView, boardHeight]);

  const initializeView = useCallback(() => {
    centerViewAtZoom(1);
    setIsInitialized(true);
  }, [centerViewAtZoom]);

  const resetView = useCallback(() => {
    const { width, height } = getViewportMetrics(viewportRef.current);
    const fitZoom = getFitZoom(boardHeight, width, height);
    centerViewAtZoom(fitZoom);
    setIsInitialized(true);
  }, [boardHeight, centerViewAtZoom]);

  const zoomAroundPoint = useCallback((targetZoom, anchorX, anchorY) => {
    const { width, height } = getViewportMetrics(viewportRef.current);
    const minZoom = getFitZoom(boardHeight, width, height);
    const nextZoom = Math.max(minZoom, Math.min(MAX_ZOOM, targetZoom));
    const currentZoom = zoomRef.current;
    const currentPan = panRef.current;

    const worldX = (anchorX - currentPan.x) / currentZoom;
    const worldY = (anchorY - currentPan.y) / currentZoom;

    const nextPan = {
      x: anchorX - worldX * nextZoom,
      y: anchorY - worldY * nextZoom,
    };

    applyView(nextPan, nextZoom);
  }, [applyView, boardHeight]);

  // ── Initialize centered view when boardHeight is ready ──────────────────────

  useEffect(() => {
    if (!isInitialized && boardHeight > 0 && messages.length > 0) {
      initializeView();
    }
  }, [boardHeight, initializeView, isInitialized, messages.length]);

  useEffect(() => {
    if (!isInitialized || boardHeight <= 0) return;

    const syncViewToViewport = () => {
      const { width, height } = getViewportMetrics(viewportRef.current);
      const minZoom = getFitZoom(boardHeight, width, height);
      const nextZoom = Math.max(minZoom, Math.min(MAX_ZOOM, zoomRef.current));
      const nextPan = clampPan(panRef.current, nextZoom, boardHeight, width, height);
      const panChanged = nextPan.x !== panRef.current.x || nextPan.y !== panRef.current.y;

      if (panChanged) {
        panRef.current = nextPan;
        setPan(nextPan);
      }

      if (nextZoom !== zoomRef.current) {
        zoomRef.current = nextZoom;
        setZoom(nextZoom);
      }
    };

    syncViewToViewport();
    window.addEventListener("resize", syncViewToViewport);
    return () => window.removeEventListener("resize", syncViewToViewport);
  }, [boardHeight, isInitialized]);

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
      // Start below the safe area (top bar) to avoid overlapping
      laneHeightsRef.current = Array.from({ length: laneCount }, () => SAFE_AREA_TOP_HEIGHT + 20);
    } else if (laneHeightsRef.current.length < laneCount) {
      laneHeightsRef.current = Array.from({ length: laneCount }, (_, i) => laneHeightsRef.current[i] ?? (SAFE_AREA_TOP_HEIGHT + 20));
    }

    for (const message of messages) {
      if (placementsRef.current[message.id]) continue;

      const seed        = hashSeed(`${message.id}-${message.created_at}`);
      const lane        = seed % laneCount;
      const bodyLines   = Math.min(3, Math.ceil(message.text.length / 40));
      const cardHeight  = 94 + bodyLines * 18;
      const cardWidth   = BASE_NOTE_WIDTH;
      const noteWidthPct  = (cardWidth / WORLD_WIDTH) * 100;
      const laneWidthPct  = 100 / laneCount;
      // Center the lanes around 50% (middle of the canvas)
      const centerOffset = (50 - (100 / 2)) / 2;
      const leftStartPct  = centerOffset + (lane * laneWidthPct);
      const jitterSpan    = Math.max(0.5, laneWidthPct - noteWidthPct - 1);
      const jitter        = (((seed >> 4) % 100) / 100) * jitterSpan;
      const leftPct       = Math.min(98 - noteWidthPct, leftStartPct + jitter);
      
      // Ensure cards start below the safe top area
      const minTopPx = SAFE_AREA_TOP_HEIGHT + 10;
      const topPx    = Math.max(minTopPx, laneHeightsRef.current[lane] + ((seed >> 8) % 18));
      const rotationDeg   = ((seed % 11) - 5) * 0.8;

      laneHeightsRef.current[lane] = topPx + cardHeight + 20 + ((seed >> 10) % 18);
      placementsRef.current[message.id] = { leftPct, topPx, cardHeight, rotationDeg };
    }

    const nextHeight = messages.reduce((max, m) => {
      const p = placementsRef.current[m.id];
      if (!p) return max;
      return Math.max(max, p.topPx + p.cardHeight);
    }, Math.max(window.innerHeight, 600));

    // Add margin below content and reserve space for footer safe area
    setBoardHeight(nextHeight + SAFE_AREA_BOTTOM_HEIGHT + 64);
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
        const langConfig = getLanguageConfig(message.language);
        const timeLabel = new Date(message.created_at).toLocaleTimeString([], {
          hour: "2-digit", minute: "2-digit",
        });
        return {
          message,
          placement: effectivePlacement,
          langConfig,
          timeLabel,
          fullTimestampLabel: new Date(message.created_at).toLocaleString([], {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
        };
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
    const { width, height } = getViewportMetrics(viewportRef.current);
    const unclampedPan = {
      x: panDragRef.current.startOx + (e.clientX - panDragRef.current.startPx),
      y: panDragRef.current.startOy + (e.clientY - panDragRef.current.startPy),
    };
    const newPan = clampPan(unclampedPan, zoomRef.current, boardHeight, width, height);
    panRef.current = newPan;
    setPan(newPan);
  }, [boardHeight]);

  const handleCanvasPointerUp = useCallback(() => {
    panDragRef.current = null;
    setIsPanning(false);
  }, []);

  const handleZoomIn = useCallback(() => {
    const { width, height } = getViewportMetrics(viewportRef.current);
    zoomAroundPoint(zoomRef.current * 1.2, width / 2, height / 2);
  }, [zoomAroundPoint]);

  const handleZoomOut = useCallback(() => {
    const { width, height } = getViewportMetrics(viewportRef.current);
    zoomAroundPoint(zoomRef.current / 1.2, width / 2, height / 2);
  }, [zoomAroundPoint]);

  const handleViewportWheel = useCallback((e) => {
    if (!e.shiftKey) return;

    e.preventDefault();
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;

    const anchorX = e.clientX - rect.left;
    const anchorY = e.clientY - rect.top;
    const zoomFactor = Math.exp(-e.deltaY * 0.0025);
    zoomAroundPoint(zoomRef.current * zoomFactor, anchorX, anchorY);
  }, [zoomAroundPoint]);

  const openEntryDetails = useCallback((entry) => {
    setSelectedEntry(entry);
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
      moved: false,
    };
    setDraggingId(id);
  };

  const handlePointerMove = (e, id) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== id) return;
    const deltaX = e.clientX - drag.startPointerX;
    const deltaY = e.clientY - drag.startPointerY;
    if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) drag.moved = true;
    const deltaLeftPct = ((e.clientX - drag.startPointerX) / (drag.boardWidth * zoomRef.current)) * 100;
    const newLeftPct = Math.max(0, Math.min(96, drag.startLeftPct + deltaLeftPct));
    const deltaTopPx = deltaY / zoomRef.current;
    const newTopPx = Math.max(
      SAFE_AREA_TOP_HEIGHT + 4,
      Math.min(
        boardHeight - SAFE_AREA_BOTTOM_HEIGHT - 100,
        drag.startTopPx + deltaTopPx
      )
    );

    setUserPositions((prev) => ({ ...prev, [id]: { leftPct: newLeftPct, topPx: newTopPx } }));
  };

  const handlePointerUp = (e, message, entry) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== message.id) return;
    const deltaLeftPct = ((e.clientX - drag.startPointerX) / (drag.boardWidth * zoomRef.current)) * 100;
    const finalLeftPct = Math.max(0, Math.min(96, drag.startLeftPct + deltaLeftPct));
    const deltaTopPx = (e.clientY - drag.startPointerY) / zoomRef.current;
    const finalTopPx = Math.max(
      SAFE_AREA_TOP_HEIGHT + 4,
      Math.min(
        boardHeight - SAFE_AREA_BOTTOM_HEIGHT - 100,
        drag.startTopPx + deltaTopPx
      )
    );

    if (drag.moved) {
      persistPosition(message.id, finalLeftPct, finalTopPx);
    } else {
      const now = Date.now();
      if (tapRef.current.id === message.id && now - tapRef.current.at < 320) {
        tapRef.current = { id: null, at: 0 };
        openEntryDetails(entry);
      } else {
        tapRef.current = { id: message.id, at: now };
      }
    }

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
    const currentZoom = zoomRef.current;
    const vpW = Math.min(100, (vw / Math.max(WORLD_WIDTH * currentZoom, 1)) * 100);
    const vpH = Math.min(100, (vh / Math.max(boardHeight * currentZoom, 1)) * 100);
    const vpX = ((-pan.x) / Math.max(WORLD_WIDTH * currentZoom, 1)) * 100;
    const vpY = ((-pan.y) / Math.max(boardHeight * currentZoom, 1)) * 100;
    return {
      vpW,
      vpH,
      vpX: Math.max(0, Math.min(100 - vpW, vpX)),
      vpY: Math.max(0, Math.min(100 - vpH, vpY)),
    };
  }, [boardHeight, pan, zoom]);

  const scaledNoteStyles = useMemo(() => {
    const scaled = (value) => `${(value * zoom).toFixed(2)}px`;
    const scaledBorder = `${Math.max(0.75, zoom).toFixed(2)}px`;

    return {
      noteWidth: scaled(BASE_NOTE_WIDTH),
      noteRadius: scaled(6),
      headerPadding: `${scaled(5)} ${scaled(8)}`,
      bodyPadding: `${scaled(6)} ${scaled(8)} ${scaled(8)}`,
      headerGap: scaled(6),
      iconSize: scaled(16),
      filenameFontSize: scaled(10),
      timestampFontSize: scaled(9),
      signatureFontSize: scaled(9),
      messageFontSize: scaled(12),
      borderWidth: scaledBorder,
      shadowBlur: `${(32 * zoom).toFixed(2)}px`,
      shadowY: `${(8 * zoom).toFixed(2)}px`,
      headerBorderWidth: scaledBorder,
    };
  }, [zoom]);

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
        onWheel={handleViewportWheel}
      >
        {/* ── Background — expands with canvas ── */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: `${WORLD_WIDTH}px`,
            height: `${boardHeight}px`,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
            willChange: "transform",
            zIndex: 0,
            pointerEvents: "none",
          }}
        >
          <WallBackground />
        </div>

        {/* ── HUD — fixed overlays, pointer-events selectively on ── */}
        <div style={styles.hud}>
          {/* Control buttons at top */}
          <div style={styles.buttonBar}>
            <button
              style={styles.controlBtn}
              onClick={resetView}
              title="Reset view"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 5V3H5M3 19V21H5M21 3V5H19M21 21V19H19M9 3H3V9M15 3H21V9M3 15V21H9M21 15V21H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>

            <button
              style={styles.controlBtn}
              onClick={handleZoomIn}
              title="Zoom in"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path fillRule="evenodd" clipRule="evenodd" d="M4 11C4 7.13401 7.13401 4 11 4C14.866 4 18 7.13401 18 11C18 14.866 14.866 18 11 18C7.13401 18 4 14.866 4 11ZM11 2C6.02944 2 2 6.02944 2 11C2 15.9706 6.02944 20 11 20C13.125 20 15.078 19.2635 16.6177 18.0319L20.2929 21.7071C20.6834 22.0976 21.3166 22.0976 21.7071 21.7071C22.0976 21.3166 22.0976 20.6834 21.7071 20.2929L18.0319 16.6177C19.2635 15.078 20 13.125 20 11C20 6.02944 15.9706 2 11 2Z" fill="currentColor"/>
                <path fillRule="evenodd" clipRule="evenodd" d="M10 14C10 14.5523 10.4477 15 11 15C11.5523 15 12 14.5523 12 14V12H14C14.5523 12 15 11.5523 15 11C15 10.4477 14.5523 10 14 10H12V8C12 7.44772 11.5523 7 11 7C10.4477 7 10 7.44772 10 8V10H8C7.44772 10 7 10.4477 7 11C7 11.5523 7.44772 12 8 12H10V14Z" fill="currentColor"/>
              </svg>
            </button>

            <button
              style={styles.controlBtn}
              onClick={handleZoomOut}
              title="Zoom out"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path fillRule="evenodd" clipRule="evenodd" d="M4 11C4 7.13401 7.13401 4 11 4C14.866 4 18 7.13401 18 11C18 14.866 14.866 18 11 18C7.13401 18 4 14.866 4 11ZM11 2C6.02944 2 2 6.02944 2 11C2 15.9706 6.02944 20 11 20C13.125 20 15.078 19.2635 16.6177 18.0319L20.2929 21.7071C20.6834 22.0976 21.3166 22.0976 21.7071 21.7071C22.0976 21.3166 22.0976 20.6834 21.7071 20.2929L18.0319 16.6177C19.2635 15.078 20 13.125 20 11C20 6.02944 15.9706 2 11 2Z" fill="currentColor"/>
                <path fillRule="evenodd" clipRule="evenodd" d="M7 11C7 10.4477 7.44772 10 8 10H14C14.5523 10 15 10.4477 15 11C15 11.5523 14.5523 12 14 12H8C7.44772 12 7 11.5523 7 11Z" fill="currentColor"/>
              </svg>
            </button>

            <button
              style={styles.controlBtn}
              onClick={() => setShowLoginDialog(true)}
              title="Admin login"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M13 2C10.2386 2 8 4.23858 8 7C8 7.55228 8.44772 8 9 8C9.55228 8 10 7.55228 10 7C10 5.34315 11.3431 4 13 4H17C18.6569 4 20 5.34315 20 7V17C20 18.6569 18.6569 20 17 20H13C11.3431 20 10 18.6569 10 17C10 16.4477 9.55228 16 9 16C8.44772 16 8 16.4477 8 17C8 19.7614 10.2386 22 13 22H17C19.7614 22 22 19.7614 22 17V7C22 4.23858 19.7614 2 17 2H13Z" fill="currentColor"/>
                <path d="M3 11C2.44772 11 2 11.4477 2 12C2 12.5523 2.44772 13 3 13H11.2821C11.1931 13.1098 11.1078 13.2163 11.0271 13.318C10.7816 13.6277 10.5738 13.8996 10.427 14.0945C10.3536 14.1921 10.2952 14.2705 10.255 14.3251L10.2084 14.3884L10.1959 14.4055L10.1915 14.4115C10.1914 14.4116 10.191 14.4122 11 15L10.1915 14.4115C9.86687 14.8583 9.96541 15.4844 10.4122 15.809C10.859 16.1336 11.4843 16.0346 11.809 15.5879L11.8118 15.584L11.822 15.57L11.8638 15.5132C11.9007 15.4632 11.9553 15.3897 12.0247 15.2975C12.1637 15.113 12.3612 14.8546 12.5942 14.5606C13.0655 13.9663 13.6623 13.2519 14.2071 12.7071L14.9142 12L14.2071 11.2929C13.6623 10.7481 13.0655 10.0337 12.5942 9.43937C12.3612 9.14542 12.1637 8.88702 12.0247 8.7025C11.9553 8.61033 11.9007 8.53682 11.8638 8.48679L11.822 8.43002L11.8118 8.41602L11.8095 8.41281C11.4848 7.96606 10.859 7.86637 10.4122 8.19098C9.96541 8.51561 9.86636 9.14098 10.191 9.58778L11 9C10.191 9.58778 10.1909 9.58773 10.191 9.58778L10.1925 9.58985L10.1959 9.59454L10.2084 9.61162L10.255 9.67492C10.2952 9.72946 10.3536 9.80795 10.427 9.90549C10.5738 10.1004 10.7816 10.3723 11.0271 10.682C11.1078 10.7837 11.1931 10.8902 11.2821 11H3Z" fill="currentColor"/>
              </svg>
            </button>
          </div>

          <div style={styles.promptLine}>
            {renderTerminalPromptIcon()}
          </div>
          <div style={styles.zoomLevel}>zoom {Math.round(zoom * 100)}%</div>
          {status && <div style={styles.statusLine}>{status}</div>}

          

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
            left:       `${pan.x}px`,
            top:        `${pan.y}px`,
            width:      `${WORLD_WIDTH * zoom}px`,
            height:     `${boardHeight * zoom}px`,
            zIndex:     1,
            pointerEvents: "none",
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
                width:  "100%",
                height: "100%",
              }}
            >
              <div
                aria-hidden="true"
                style={{
                  ...styles.safeAreaGuide,
                  top: 0,
                  height: `${SAFE_AREA_TOP_HEIGHT * zoom}px`,
                  borderBottom: "1px solid rgba(143, 210, 173, 0.12)",
                }}
              />
              <div
                aria-hidden="true"
                style={{
                  ...styles.safeAreaGuide,
                  bottom: 0,
                  height: `${SAFE_AREA_BOTTOM_HEIGHT * zoom}px`,
                  borderTop: "1px solid rgba(143, 210, 173, 0.12)",
                }}
              />
              {placedMessages.map((entry) => {
                const { message, placement, langConfig, timeLabel } = entry;

                return (
                <article
                  key={message.id}
                  data-note-id={message.id}
                  style={{
                    ...styles.note,
                    left:      `${placement.leftPct}%`,
                    top:       `${placement.topPx * zoom}px`,
                    width:     scaledNoteStyles.noteWidth,
                    transform: `rotate(${placement.rotationDeg}deg)`,
                    cursor:    draggingId === message.id ? "grabbing" : "grab",
                    userSelect: "none",
                    touchAction: "none",
                    zIndex:    draggingId === message.id ? 10 : 1,
                    transition: draggingId === message.id ? "none" : "box-shadow 120ms ease",
                    boxShadow:  draggingId === message.id
                      ? `0 ${scaledNoteStyles.shadowY} ${scaledNoteStyles.shadowBlur} rgba(0, 255, 136, 0.18)`
                      : undefined,
                    pointerEvents: "all",
                  }}
                  onPointerDown={(e) => handlePointerDown(e, message.id, placement.leftPct, placement.topPx)}
                  onPointerMove={(e) => handlePointerMove(e, message.id)}
                  onPointerUp={(e)   => handlePointerUp(e, message, entry)}
                  onPointerCancel={(e) => handlePointerCancel(e, message.id)}
                  onDoubleClick={() => openEntryDetails(entry)}
                >
                  <div style={{
                    ...styles.cardWrapper,
                    borderWidth: scaledNoteStyles.borderWidth,
                    borderRadius: scaledNoteStyles.noteRadius,
                  }}>
                    <div style={{
                      ...styles.cardHeader,
                      padding: scaledNoteStyles.headerPadding,
                      gap: scaledNoteStyles.headerGap,
                      borderBottomWidth: scaledNoteStyles.headerBorderWidth,
                    }}>
                      <div style={{
                        ...styles.iconContainer,
                        width: scaledNoteStyles.iconSize,
                        height: scaledNoteStyles.iconSize,
                      }}>
                        <LanguageIcon language={langConfig.key} size={16 * zoom} />
                      </div>
                      <span style={{ ...styles.filename, fontSize: scaledNoteStyles.filenameFontSize }}>{langConfig.fileName}</span>
                      <span style={{ ...styles.timestamp, fontSize: scaledNoteStyles.timestampFontSize }}>[{timeLabel}]</span>
                    </div>
                    <div style={{ ...styles.cardBody, padding: scaledNoteStyles.bodyPadding }}>
                      <div style={{ ...styles.signature, fontSize: scaledNoteStyles.signatureFontSize }}>{langConfig.signature}</div>
                      <div style={{ ...styles.messageText, fontSize: scaledNoteStyles.messageFontSize }}>
                        <span style={{ ...styles.quote, fontSize: scaledNoteStyles.messageFontSize }}>"</span>
                        {message.text}
                        <span style={{ ...styles.quote, fontSize: scaledNoteStyles.messageFontSize }}>"</span>
                      </div>
                    </div>
                  </div>
                </article>
                );
              })}
            </section>
          )}
        </div>
      </section>

      {/* ── Login Dialog ── */}
      {showLoginDialog && (
        <div style={styles.dialogOverlay} onClick={() => setShowLoginDialog(false)}>
          <div style={styles.dialogBox} onClick={(e) => e.stopPropagation()}>
            <div style={styles.dialogHeader}>
              <h2 style={styles.dialogTitle}>Admin Login</h2>
              <button
                style={styles.closeBtn}
                onClick={() => setShowLoginDialog(false)}
                onPointerDown={(e) => e.stopPropagation()}
              >
                X
              </button>
            </div>
            <div style={styles.dialogContent}>
              <p style={styles.dialogText}>Admin login functionality will be implemented here.</p>
            </div>
          </div>
        </div>
      )}

      {selectedEntry && (
        <div style={styles.dialogOverlay} onClick={() => setSelectedEntry(null)}>
          <div style={{ ...styles.dialogBox, ...styles.entryDialogBox }} onClick={(e) => e.stopPropagation()}>
            <div style={styles.dialogHeader}>
              <div>
                <h2 style={styles.dialogTitle}>{selectedEntry.langConfig.fileName}</h2>
                <div style={styles.detailSubtitle}>entry details</div>
              </div>
              <button
                style={styles.closeBtn}
                onClick={() => setSelectedEntry(null)}
                onPointerDown={(e) => e.stopPropagation()}
              >
                X
              </button>
            </div>
            <div style={styles.dialogContent}>
              <div style={styles.detailMetaGrid}>
                <div style={styles.detailMetaLabel}>language</div>
                <div style={styles.detailMetaValue}>{selectedEntry.langConfig.name}</div>
                <div style={styles.detailMetaLabel}>saved</div>
                <div style={styles.detailMetaValue}>{selectedEntry.fullTimestampLabel}</div>
                <div style={styles.detailMetaLabel}>message</div>
                <div style={styles.detailMetaValue}>{selectedEntry.message.text}</div>
              </div>
              <div style={styles.detailCodeHeader}>full code</div>
              <pre style={styles.detailCodeBlock}>
                <code>{selectedEntry.message.full_code || selectedEntry.message.text}</code>
              </pre>
            </div>
          </div>
        </div>
      )}
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
    overscrollBehavior: "contain",
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
    pointerEvents: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
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
  zoomLevel: {
    position:       "absolute",
    top:            "50px",
    right:          "12px",
    pointerEvents:  "none",
    background:     "rgba(4, 11, 8, 0.8)",
    border:         "1px solid #1a3d2a",
    color:          "#6ea287",
    fontSize:       "11px",
    padding:        "4px 10px",
    letterSpacing:  "0.06em",
    fontFamily:     'Consolas, Monaco, "Courier New", monospace',
    borderRadius:   "999px",
    textTransform:  "uppercase",
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
  },
  safeAreaGuide: {
    position: "absolute",
    left: 0,
    width: "100%",
    background: "rgba(143, 210, 173, 0.015)",
    boxSizing: "border-box",
    pointerEvents: "none",
    zIndex: 0,
  },
  note: {
    position: "absolute",
    borderRadius: "6px",
    transformOrigin: "top left",
  },
  cardWrapper: {
    padding: "0px",
    border: "1px solid #0d3a0d",
    background: "#070f07",
    borderRadius: "6px",
    overflow: "hidden",
    transition: "border-color 150ms",
  },
  cardHeader: {
    padding: "5px 8px",
    background: "#0a1f0a",
    borderBottom: "1px solid #0d3a0d",
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "10px",
    color: "#2a8c2a",
  },
  iconContainer: {
    width: "16px",
    height: "16px",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  filename: {
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: "10px",
    color: "#2a8c2a",
  },
  timestamp: {
    fontSize: "9px",
    color: "#1a5c1a",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  cardBody: {
    padding: "6px 8px 8px",
  },
  signature: {
    fontSize: "9px",
    color: "#1a6b1a",
    marginBottom: "2px",
  },
  messageText: {
    fontSize: "12px",
    color: "#00cc55",
    lineHeight: "1.45",
    wordBreak: "break-word",
    whiteSpace: "pre-wrap",
  },
  quote: {
    color: "#1a6b1a",
  },
  buttonBar: {
    position: "absolute",
    top: "12px",
    right: "12px",
    display: "flex",
    gap: "6px",
    pointerEvents: "all",
    zIndex: 25,
  },
  controlBtn: {
    width: "32px",
    height: "32px",
    padding: "6px",
    background: "rgba(0, 0, 0, 0.7)",
    border: "1px solid #1a3d2a",
    color: "#00ff88",
    cursor: "pointer",
    borderRadius: "4px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 150ms ease",
    fontSize: "0px",
    lineHeight: 1,
  },
  dialogOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0, 0, 0, 0.7)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 50,
    pointerEvents: "all",
  },
  dialogBox: {
    background: "rgba(0, 0, 0, 0.95)",
    border: "1px solid #1a5c1a",
    borderRadius: "8px",
    minWidth: "320px",
    maxWidth: "500px",
    boxShadow: "0 0 32px rgba(0, 255, 136, 0.15)",
    pointerEvents: "all",
    overflow: "hidden",
  },
  entryDialogBox: {
    width: "min(760px, calc(100vw - 32px))",
    maxWidth: "760px",
    maxHeight: "min(82dvh, 820px)",
    display: "flex",
    flexDirection: "column",
  },
  dialogHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px 20px",
    borderBottom: "1px solid #1a3d2a",
    background: "rgba(10, 31, 10, 0.6)",
  },
  dialogTitle: {
    margin: 0,
    fontSize: "16px",
    color: "#00ff88",
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  },
  closeBtn: {
    background: "transparent",
    border: "none",
    color: "#4f7a63",
    fontSize: "20px",
    cursor: "pointer",
    padding: "0px 8px",
    lineHeight: 1,
    transition: "color 150ms",
  },
  dialogContent: {
    padding: "20px",
    overflow: "auto",
  },
  dialogText: {
    margin: 0,
    fontSize: "13px",
    color: "#4f7a63",
    lineHeight: 1.6,
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  },
  detailSubtitle: {
    marginTop: "4px",
    fontSize: "11px",
    color: "#5c8f73",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  },
  detailMetaGrid: {
    display: "grid",
    gridTemplateColumns: "88px 1fr",
    gap: "10px 16px",
    alignItems: "start",
    marginBottom: "18px",
  },
  detailMetaLabel: {
    fontSize: "11px",
    color: "#5c8f73",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  },
  detailMetaValue: {
    fontSize: "13px",
    color: "#c7e7d3",
    lineHeight: 1.5,
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  detailCodeHeader: {
    marginBottom: "10px",
    fontSize: "11px",
    color: "#5c8f73",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  },
  detailCodeBlock: {
    margin: 0,
    padding: "16px",
    background: "#051008",
    border: "1px solid #173b24",
    borderRadius: "8px",
    color: "#bff0cf",
    fontSize: "12px",
    lineHeight: 1.55,
    overflow: "auto",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  },
};
