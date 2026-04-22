import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabase } from "../utils/supabaseClient.js";
import WallBackground from "../components/WallBackground.jsx";
import LanguageIcon from "../components/LanguageIcon.jsx";
import loginIcon from "../images/login.svg";
import resetViewIcon from "../images/reset-view.svg";
import terminalIcon from "../images/terminal-icon.svg";
import zoomInIcon from "../images/zoom-in.svg";
import zoomOutIcon from "../images/zoom-out.svg";
import { setDocumentHead } from "../utils/documentHead.js";
import { getLanguageConfig } from "../utils/languages.js";
import { generateMessagePlacement } from "../utils/messagePlacement.js";
import {
  deleteAllMessagesWithAdminPassword,
  fetchAllMessagesForExport,
  fetchMessagesWithFallback,
  verifyAdminPassword,
} from "../utils/messagesApi.js";

const MAX_MESSAGES = 100;
const REALTIME_BATCH_SIZE = 4;
const REALTIME_PROCESS_INTERVAL_MS = 140;
const REALTIME_FALLBACK_POLL_MS = 5000;
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

function applyRealtimeEvents(previous, events) {
  let nextMessages = previous;

  for (const event of events) {
    if (event.type === "DELETE") {
      nextMessages = removeMessage(nextMessages, event.id);
      continue;
    }

    if (event.message) {
      nextMessages = mergeMessages(nextMessages, [event.message]);
    }
  }

  return nextMessages;
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

function escapeCsvValue(value) {
  const normalized = value === null || value === undefined ? "" : String(value);
  return `"${normalized.replace(/"/g, "\"\"")}"`;
}

function buildCsvFromRows(rows) {
  if (!rows.length) return "";

  const columns = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row ?? {}).forEach((key) => set.add(key));
      return set;
    }, new Set())
  );

  const header = columns.map((column) => escapeCsvValue(column)).join(",");
  const body = rows.map((row) =>
    columns.map((column) => escapeCsvValue(row?.[column])).join(",")
  );

  return [header, ...body].join("\r\n");
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Wall() {
  const [messages, setMessages]       = useState([]);
  const [isLoading, setIsLoading]     = useState(true);
  const [connectionStatus, setConnectionStatus] = useState(null);
  const [schemaStatus, setSchemaStatus] = useState(null);
  const [boardHeight, setBoardHeight] = useState(0);
  const [placementReady, setPlacementReady] = useState(0);
  const [userPositions, setUserPositions]   = useState(() => loadSavedPositions());
  const [draggingId, setDraggingId]   = useState(null);

  // ── Infinite canvas pan state ──────────────────────────────────────────────
  const [pan, setPan]           = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [zoom, setZoom]         = useState(1);
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminSession, setAdminSession] = useState(null);
  const [adminNotice, setAdminNotice] = useState(null);
  const [isAdminBusy, setIsAdminBusy] = useState(false);
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
  const realtimeQueueRef = useRef([]);
  const realtimeTimerRef = useRef(null);
  const fallbackPollRef = useRef(null);

  const status = connectionStatus ?? schemaStatus;

  useEffect(() => {
    setDocumentHead("CCS Freedom Screen", terminalIcon);
  }, []);

  // ── Viewport resize ────────────────────────────────────────────────────────
  // (we no longer need viewportWidth for placement since we use WORLD_WIDTH)

  // ── Supabase fetch + realtime ──────────────────────────────────────────────

  const fetchMessages = useCallback(async (showSpinner) => {
    if (showSpinner) setIsLoading(true);
    const query = await fetchMessagesWithFallback(MAX_MESSAGES);

    if (query.error) {
      setConnectionStatus((current) => current ?? "wall offline; retrying with polling fallback");
      setIsLoading(false);
      return;
    }

    const supportsLanguage = query.select?.includes("language");
    const supportsPlacement = query.select?.includes("pos_x");
    const nextMessages = capMessages((query.data ?? []).filter((message) => !message.is_deleted));

    setMessages(nextMessages);
    if (!supportsLanguage) {
      setSchemaStatus("wall is using legacy schema; run the Supabase SQL migrations to restore entry language icons");
    } else if (!supportsPlacement) {
      setSchemaStatus("wall is using compatibility placement mode");
    } else {
      setSchemaStatus(null);
    }
    setIsLoading(false);
  }, []);

  const stopFallbackPolling = useCallback(() => {
    if (!fallbackPollRef.current || typeof window === "undefined") return;
    window.clearInterval(fallbackPollRef.current);
    fallbackPollRef.current = null;
  }, []);

  const startFallbackPolling = useCallback(() => {
    if (fallbackPollRef.current || typeof window === "undefined") return;

    fallbackPollRef.current = window.setInterval(() => {
      void fetchMessages(false);
    }, REALTIME_FALLBACK_POLL_MS);
  }, [fetchMessages]);

  const flushRealtimeQueue = useCallback(() => {
    realtimeTimerRef.current = null;

    if (realtimeQueueRef.current.length === 0) {
      return;
    }

    const nextBatch = realtimeQueueRef.current.splice(0, REALTIME_BATCH_SIZE);
    setMessages((previous) => applyRealtimeEvents(previous, nextBatch));

    if (realtimeQueueRef.current.length > 0 && typeof window !== "undefined") {
      realtimeTimerRef.current = window.setTimeout(flushRealtimeQueue, REALTIME_PROCESS_INTERVAL_MS);
    }
  }, []);

  const queueRealtimeEvent = useCallback((event) => {
    realtimeQueueRef.current.push(event);

    if (!realtimeTimerRef.current && typeof window !== "undefined") {
      realtimeTimerRef.current = window.setTimeout(flushRealtimeQueue, REALTIME_PROCESS_INTERVAL_MS);
    }
  }, [flushRealtimeQueue]);

  useEffect(() => {
    void fetchMessages(true);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void fetchMessages(false);
    };

    document.addEventListener("visibilitychange", handleVisibility);
    const channel = supabase
      .channel("public:messages")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (payload) => {
        if (payload.eventType === "DELETE") {
          queueRealtimeEvent({ type: "DELETE", id: payload.old.id });
          return;
        }

        if (payload.new?.is_deleted) {
          queueRealtimeEvent({ type: "DELETE", id: payload.new.id });
          return;
        }

        queueRealtimeEvent({
          type: payload.eventType,
          message: payload.new,
        });
      })
      .subscribe((state) => {
        if (state === "SUBSCRIBED") {
          stopFallbackPolling();
          setConnectionStatus(null);
          void fetchMessages(false);
        }

        if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
          startFallbackPolling();
          setConnectionStatus("realtime offline; polling fallback active");
        }
      });

    return () => {
      stopFallbackPolling();
      if (realtimeTimerRef.current && typeof window !== "undefined") {
        window.clearTimeout(realtimeTimerRef.current);
        realtimeTimerRef.current = null;
      }
      realtimeQueueRef.current = [];
      document.removeEventListener("visibilitychange", handleVisibility);
      void supabase.removeChannel(channel);
    };
  }, [fetchMessages, queueRealtimeEvent, startFallbackPolling, stopFallbackPolling]);

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

      const bodyLines   = Math.min(3, Math.ceil(message.text.length / 40));
      const cardHeight  = 94 + bodyLines * 18;
      const hasStoredPlacement =
        Number.isFinite(message.pos_x) &&
        Number.isFinite(message.pos_y) &&
        Number.isFinite(message.rotation);

      if (hasStoredPlacement) {
        placementsRef.current[message.id] = {
          leftPct: message.pos_x,
          topPx: message.pos_y,
          cardHeight,
          rotationDeg: message.rotation,
        };
        continue;
      }

      const generatedPlacement = generateMessagePlacement(`${message.id}-${message.created_at}`, message.text);
      const lane = Math.min(laneCount - 1, Math.max(0, Math.floor((generatedPlacement.pos_x / 100) * laneCount)));
      const minTopPx = SAFE_AREA_TOP_HEIGHT + 10;
      const topPx = Math.max(minTopPx, Math.max(laneHeightsRef.current[lane] ?? minTopPx, generatedPlacement.pos_y));

      laneHeightsRef.current[lane] = topPx + cardHeight + 20;
      placementsRef.current[message.id] = {
        leftPct: generatedPlacement.pos_x,
        topPx,
        cardHeight,
        rotationDeg: generatedPlacement.rotation,
      };
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

  const handleAdminLogin = useCallback(async () => {
    setIsAdminBusy(true);
    setAdminNotice(null);

    const result = await verifyAdminPassword(adminPassword);

    setIsAdminBusy(false);

    if (result.error || !result.isValid) {
      setAdminSession(null);
      setAdminNotice({
        tone: "error",
        message: result.error?.message ?? "The admin password was not accepted.",
      });
      return;
    }

    setAdminSession({
      password: adminPassword.trim(),
      authenticatedAt: Date.now(),
    });
    setAdminNotice({
      tone: "success",
      message: "Admin tools unlocked for this session.",
    });
  }, [adminPassword]);

  const handleAdminLogout = useCallback(() => {
    setAdminSession(null);
    setAdminPassword("");
    setAdminNotice({
      tone: "success",
      message: "Admin session closed.",
    });
  }, []);

  const handleAdminExportCsv = useCallback(() => {
    if (!adminSession?.password) {
      setAdminNotice({
        tone: "error",
        message: "Log in as admin first to export wall data.",
      });
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    setIsAdminBusy(true);
    setAdminNotice(null);

    void (async () => {
      const exportQuery = await fetchAllMessagesForExport();

      setIsAdminBusy(false);

      if (exportQuery.error) {
        setAdminNotice({
          tone: "error",
          message: exportQuery.error.message,
        });
        return;
      }

      const rows = exportQuery.data ?? [];

      if (rows.length === 0) {
        setAdminNotice({
          tone: "error",
          message: "There are no database rows to export right now.",
        });
        return;
      }

      const csv = buildCsvFromRows(rows);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = window.URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = `ccs-freedom-screen-data-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
      link.click();
      window.URL.revokeObjectURL(url);

      setAdminNotice({
        tone: "success",
        message: `Downloaded ${rows.length} database rows as CSV.`,
      });
    })();
  }, [adminSession]);

  const handleAdminDeleteAll = useCallback(async () => {
    if (!adminSession?.password) {
      setAdminNotice({
        tone: "error",
        message: "Log in as admin first to delete entries.",
      });
      return;
    }

    if (typeof window !== "undefined") {
      const shouldDelete = window.confirm("Delete every wall entry? This cannot be undone.");
      if (!shouldDelete) return;
    }

    setIsAdminBusy(true);
    setAdminNotice(null);

    const result = await deleteAllMessagesWithAdminPassword(adminSession.password);

    setIsAdminBusy(false);

    if (result.error) {
      setAdminNotice({
        tone: "error",
        message: result.error.message,
      });
      return;
    }

    placementsRef.current = {};
    laneHeightsRef.current = [];
    realtimeQueueRef.current = [];
    setMessages([]);
    setSelectedEntry(null);
    setUserPositions({});
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(POSITIONS_STORAGE_KEY);
    }

    setAdminNotice({
      tone: "success",
      message: `Deleted ${result.deletedCount} wall entries.`,
    });
  }, [adminSession]);

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
      <style>{`
        @keyframes wallSpawn {
          from {
            opacity: 0;
            transform: scale(0.8);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
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
                <img src={resetViewIcon} alt="" aria-hidden="true" style={styles.controlIcon} />
              </button>

              <button
                style={styles.controlBtn}
                onClick={handleZoomIn}
                title="Zoom in"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <img src={zoomInIcon} alt="" aria-hidden="true" style={styles.controlIcon} />
              </button>

              <button
                style={styles.controlBtn}
                onClick={handleZoomOut}
                title="Zoom out"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <img src={zoomOutIcon} alt="" aria-hidden="true" style={styles.controlIcon} />
              </button>

              <button
                style={{
                  ...styles.controlBtn,
                  borderColor: adminSession ? "#2d8b57" : "#1a3d2a",
                  boxShadow: adminSession ? "0 0 0 1px rgba(45, 139, 87, 0.35)" : "none",
                }}
                onClick={() => setShowLoginDialog(true)}
                title={adminSession ? "Admin tools unlocked" : "Admin login"}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <img src={loginIcon} alt="" aria-hidden="true" style={styles.controlIcon} />
              </button>
            </div>

          <div style={styles.promptLine}>
            <img
              src={terminalIcon}
              alt=""
              aria-hidden="true"
              style={styles.promptIcon}
            />
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
                    animation: draggingId === message.id ? "none" : "wallSpawn 0.3s ease",
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
                        <LanguageIcon language={message.language || langConfig.key} size={scaledNoteStyles.iconSize} />
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
          <div style={{ ...styles.dialogBox, ...styles.adminDialogBox }} onClick={(e) => e.stopPropagation()}>
            <div style={styles.dialogHeader}>
              <div>
                <h2 style={styles.dialogTitle}>Admin Tools</h2>
                <div style={styles.detailSubtitle}>
                  {adminSession ? "session unlocked" : "login required"}
                </div>
              </div>
              <button
                style={styles.closeBtn}
                onClick={() => setShowLoginDialog(false)}
                onPointerDown={(e) => e.stopPropagation()}
              >
                X
              </button>
            </div>
            <div style={styles.dialogContent}>
              <div style={styles.adminSummaryRow}>
                <div style={styles.adminSummaryCard}>
                  <div style={styles.adminSummaryLabel}>entries</div>
                  <div style={styles.adminSummaryValue}>{messages.length}</div>
                </div>
                <div style={styles.adminSummaryCard}>
                  <div style={styles.adminSummaryLabel}>realtime</div>
                  <div style={styles.adminSummaryValue}>{connectionStatus ? "fallback" : "live"}</div>
                </div>
                <div style={styles.adminSummaryCard}>
                  <div style={styles.adminSummaryLabel}>session</div>
                  <div style={styles.adminSummaryValue}>{adminSession ? "open" : "locked"}</div>
                </div>
              </div>

              <p style={styles.dialogText}>
                Use the admin password to unlock the destructive action. Exporting saves the
                raw wall table data as a CSV file.
              </p>

              <label style={styles.adminField}>
                <span style={styles.adminFieldLabel}>Admin Password</span>
                <input
                  type="password"
                  value={adminPassword}
                  onChange={(event) => setAdminPassword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !isAdminBusy) {
                      event.preventDefault();
                      void handleAdminLogin();
                    }
                  }}
                  placeholder="Enter the configured admin password"
                  style={styles.adminInput}
                />
              </label>

              {adminNotice && (
                <div
                  style={{
                    ...styles.adminNotice,
                    borderColor: adminNotice.tone === "error" ? "rgba(255, 107, 107, 0.35)" : "rgba(45, 139, 87, 0.35)",
                    color: adminNotice.tone === "error" ? "#ffb3b3" : "#bff0cf",
                  }}
                >
                  {adminNotice.message}
                </div>
              )}

              <div style={styles.adminActionGrid}>
                <button
                  type="button"
                  style={styles.adminPrimaryBtn}
                  onClick={() => void handleAdminLogin()}
                  disabled={isAdminBusy}
                >
                  {isAdminBusy ? "Checking..." : adminSession ? "Re-verify Password" : "Unlock Admin Tools"}
                </button>
                <button
                  type="button"
                  style={{
                    ...styles.adminSecondaryBtn,
                    opacity: adminSession ? 1 : 0.55,
                  }}
                  onClick={handleAdminExportCsv}
                  disabled={!adminSession || isAdminBusy}
                >
                  Export Wall Data CSV
                </button>
                <button
                  type="button"
                  style={{
                    ...styles.adminDangerBtn,
                    opacity: adminSession ? 1 : 0.55,
                  }}
                  onClick={() => void handleAdminDeleteAll()}
                  disabled={!adminSession || isAdminBusy}
                >
                  Delete All Entries
                </button>
                <button
                  type="button"
                  style={styles.adminSecondaryBtn}
                  onClick={handleAdminLogout}
                  disabled={!adminSession || isAdminBusy}
                >
                  Logout
                </button>
              </div>

              <div style={styles.adminFootnote}>
                Run `supabase/messages_security.sql` after updating the admin password seed there.
              </div>
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
  promptIcon: {
    width: "20px",
    height: "20px",
    display: "block",
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
  controlIcon: {
    width: "16px",
    height: "16px",
    display: "block",
    pointerEvents: "none",
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
  adminDialogBox: {
    width: "min(560px, calc(100vw - 32px))",
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
  adminSummaryRow: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "10px",
    marginBottom: "18px",
  },
  adminSummaryCard: {
    border: "1px solid #173b24",
    borderRadius: "8px",
    padding: "12px",
    background: "rgba(5, 16, 8, 0.8)",
  },
  adminSummaryLabel: {
    fontSize: "10px",
    color: "#5c8f73",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    marginBottom: "8px",
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  },
  adminSummaryValue: {
    fontSize: "18px",
    color: "#c7e7d3",
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  },
  adminField: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    marginTop: "18px",
  },
  adminFieldLabel: {
    fontSize: "11px",
    color: "#5c8f73",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  },
  adminInput: {
    width: "100%",
    minHeight: "44px",
    padding: "12px 14px",
    borderRadius: "8px",
    border: "1px solid #173b24",
    background: "#051008",
    color: "#d6f5e0",
    outline: "none",
    fontSize: "13px",
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  },
  adminNotice: {
    marginTop: "14px",
    padding: "12px 14px",
    borderRadius: "8px",
    border: "1px solid",
    background: "rgba(5, 16, 8, 0.8)",
    fontSize: "12px",
    lineHeight: 1.6,
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  },
  adminActionGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "10px",
    marginTop: "16px",
  },
  adminPrimaryBtn: {
    minHeight: "42px",
    border: "1px solid #2d8b57",
    background: "#0f3d24",
    color: "#d6f5e0",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "12px",
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  },
  adminSecondaryBtn: {
    minHeight: "42px",
    border: "1px solid #173b24",
    background: "#07130b",
    color: "#c7e7d3",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "12px",
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  },
  adminDangerBtn: {
    minHeight: "42px",
    border: "1px solid #6a2626",
    background: "#2a0d0d",
    color: "#ffb3b3",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "12px",
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  },
  adminFootnote: {
    marginTop: "14px",
    fontSize: "11px",
    color: "#5c8f73",
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
