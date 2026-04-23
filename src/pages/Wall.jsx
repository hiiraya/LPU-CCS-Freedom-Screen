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
  deleteMessageWithAdminPassword,
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
// ── 1.5× bigger cards ──────────────────────────────────────────────────────
const BASE_NOTE_WIDTH = 294;        // was 168
const BASE_CARD_HEIGHT_BASE = 188;  // was 94  (94 × 2)
const BASE_CARD_HEIGHT_LINE = 36;   // was 18  (18 × 2)
const MAX_ZOOM = 2.5;
const FIT_PADDING = 28;
const WORLD_WIDTH = 4000;
const SAFE_AREA_TOP_HEIGHT = 28;
const SAFE_AREA_BOTTOM_HEIGHT = 22;

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
function removeSavedPosition(id) {
  try {
    const existing = loadSavedPositions();
    delete existing[id];
    window.localStorage.setItem(POSITIONS_STORAGE_KEY, JSON.stringify(existing));
  } catch {}
}

// ─── Simple deterministic hash ───────────────────────────────────────────────
function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
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

// ─── Viewport-aware placement ─────────────────────────────────────────────────
// Returns a {leftPct, topPx, rotationDeg} for a new entry placed inside the
// currently visible world rectangle. If the visible area is already crowded,
// the zone is expanded outward so the card is near but not on top of others.
function computeViewportPlacement(panX, panY, zoom, vpW, vpH, boardHeight, existingPlacements, messageSeed, messageText) {
  const CROWD_THRESHOLD = 5;
  const OVERLAP_GAP = 24;
  const NEAR_ZONE_GAP = 18;
  const SAFE_MARGIN_X = 36;
  const SAFE_MARGIN_Y = 28;
  const CARD_W = BASE_NOTE_WIDTH;
  const CARD_H = BASE_CARD_HEIGHT_BASE + Math.min(3, Math.ceil(messageText.length / 40)) * BASE_CARD_HEIGHT_LINE;
  const minY = SAFE_AREA_TOP_HEIGHT + 10;
  const maxY = Math.max(minY, Math.max(boardHeight, 700) - SAFE_AREA_BOTTOM_HEIGHT - CARD_H);

  // Visible world rectangle ("actively zoomed" area)
  let zLeft = Math.max(0, -panX / zoom);
  let zTop = Math.max(minY, -panY / zoom + SAFE_AREA_TOP_HEIGHT / zoom);
  let zRight = Math.min(WORLD_WIDTH - CARD_W, (-panX + vpW) / zoom - CARD_W);
  let zBot = Math.min(maxY, (-panY + vpH) / zoom - SAFE_AREA_BOTTOM_HEIGHT - CARD_H);

  if (zRight - zLeft < CARD_W * 2) {
    zLeft = Math.max(0, zLeft - CARD_W);
    zRight = Math.min(WORLD_WIDTH - CARD_W, zRight + CARD_W);
  }
  if (zBot - zTop < CARD_H * 2) {
    zTop = Math.max(minY, zTop - CARD_H);
    zBot = Math.min(maxY, zBot + CARD_H * 2);
  }

  const activeSafeRect = {
    left: Math.max(0, Math.min(WORLD_WIDTH - CARD_W, zLeft + SAFE_MARGIN_X)),
    right: Math.max(0, Math.min(WORLD_WIDTH - CARD_W, zRight - SAFE_MARGIN_X)),
    top: Math.max(minY, Math.min(maxY, zTop + SAFE_MARGIN_Y)),
    bottom: Math.max(minY, Math.min(maxY, zBot - SAFE_MARGIN_Y)),
  };
  if (activeSafeRect.right <= activeSafeRect.left) {
    activeSafeRect.left = Math.max(0, Math.min(WORLD_WIDTH - CARD_W, zLeft));
    activeSafeRect.right = Math.max(0, Math.min(WORLD_WIDTH - CARD_W, zRight));
  }
  if (activeSafeRect.bottom <= activeSafeRect.top) {
    activeSafeRect.top = Math.max(minY, Math.min(maxY, zTop));
    activeSafeRect.bottom = Math.max(minY, Math.min(maxY, zBot));
  }

  const existingBoxes = Object.values(existingPlacements).map((p) => {
    const x = (p.leftPct / 100) * WORLD_WIDTH;
    const y = p.topPx;
    const h = p.cardHeight ?? CARD_H;
    return { left: x, top: y, right: x + CARD_W, bottom: y + h };
  });
  const viewportZone = {
    left: activeSafeRect.left,
    right: activeSafeRect.right + CARD_W,
    top: activeSafeRect.top,
    bottom: activeSafeRect.bottom + CARD_H,
  };
  const rectsOverlap = (a, b) =>
    a.left < b.right &&
    a.right > b.left &&
    a.top < b.bottom &&
    a.bottom > b.top;
  const inZone = existingBoxes.filter((b) => rectsOverlap(b, viewportZone)).length;
  const zoneW = Math.max(1, zRight - zLeft);
  const zoneH = Math.max(1, zBot - zTop);
  const density = (inZone * CARD_W * CARD_H) / Math.max(1, zoneW * zoneH);
  const isCrammed = inZone >= CROWD_THRESHOLD || density >= 0.42;

  const overlapsExisting = (leftPx, topPx) =>
    existingBoxes.some((b) =>
      leftPx < b.right + OVERLAP_GAP &&
      leftPx + CARD_W > b.left - OVERLAP_GAP &&
      topPx < b.bottom + OVERLAP_GAP &&
      topPx + CARD_H > b.top - OVERLAP_GAP
    );
  const overlapsViewportZone = (leftPx, topPx) => rectsOverlap(
    { left: leftPx, top: topPx, right: leftPx + CARD_W, bottom: topPx + CARD_H },
    {
      left: viewportZone.left - NEAR_ZONE_GAP,
      right: viewportZone.right + NEAR_ZONE_GAP,
      top: viewportZone.top - NEAR_ZONE_GAP,
      bottom: viewportZone.bottom + NEAR_ZONE_GAP,
    }
  );
  const buildCandidates = (rect, options = {}) => {
    const {
      avoidViewport = false,
      focus = null,
    } = options;
    if (rect.right < rect.left || rect.bottom < rect.top) return [];
    const stepX = CARD_W + OVERLAP_GAP;
    const stepY = CARD_H + OVERLAP_GAP;
    const usableWidth = Math.max(0, rect.right - rect.left);
    const usableHeight = Math.max(0, rect.bottom - rect.top);
    const cols = Math.max(1, Math.floor(usableWidth / Math.max(stepX, 1)) + 1);
    const rows = Math.max(1, Math.floor(usableHeight / Math.max(stepY, 1)) + 1);
    const centerX = focus?.x ?? (rect.left + rect.right) / 2;
    const centerY = focus?.y ?? (rect.top + rect.bottom) / 2;
    const candidates = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const baseX = rect.left + Math.min(usableWidth, col * stepX);
        const baseY = rect.top + Math.min(usableHeight, row * stepY);
        const candidate = {
          x: Math.max(rect.left, Math.min(rect.right, baseX)),
          y: Math.max(rect.top, Math.min(rect.bottom, baseY)),
        };
        if (avoidViewport && overlapsViewportZone(candidate.x, candidate.y)) continue;
        candidates.push(candidate);
      }
    }

    return candidates.sort((a, b) => {
      const da = Math.hypot(a.x - centerX, a.y - centerY);
      const db = Math.hypot(b.x - centerX, b.y - centerY);
      return da - db;
    });
  };
  const pickFirstOpen = (candidates) => {
    for (const candidate of candidates) {
      if (!overlapsExisting(candidate.x, candidate.y)) return candidate;
    }
    return candidates[0] ?? null;
  };

  const viewportCenter = {
    x: (activeSafeRect.left + activeSafeRect.right) / 2,
    y: (activeSafeRect.top + activeSafeRect.bottom) / 2,
  };
  let picked = null;

  if (!isCrammed) {
    picked = pickFirstOpen(buildCandidates(activeSafeRect, { focus: viewportCenter }));
  } else {
    const padX = Math.max(CARD_W + NEAR_ZONE_GAP, zoneW * 0.22);
    const padY = Math.max(CARD_H + NEAR_ZONE_GAP, zoneH * 0.22);
    const surroundingRects = [
      {
        left: Math.min(WORLD_WIDTH - CARD_W, activeSafeRect.right + CARD_W + NEAR_ZONE_GAP),
        right: Math.min(WORLD_WIDTH - CARD_W, activeSafeRect.right + padX),
        top: Math.max(minY, activeSafeRect.top - padY * 0.5),
        bottom: Math.min(maxY, activeSafeRect.bottom + padY * 0.5),
      },
      {
        left: Math.max(0, activeSafeRect.left - padX),
        right: Math.max(0, activeSafeRect.left - CARD_W - NEAR_ZONE_GAP),
        top: Math.max(minY, activeSafeRect.top - padY * 0.5),
        bottom: Math.min(maxY, activeSafeRect.bottom + padY * 0.5),
      },
      {
        left: Math.max(0, activeSafeRect.left - padX * 0.25),
        right: Math.min(WORLD_WIDTH - CARD_W, activeSafeRect.right + padX * 0.25),
        top: Math.min(maxY, activeSafeRect.bottom + CARD_H + NEAR_ZONE_GAP),
        bottom: Math.min(maxY, activeSafeRect.bottom + padY),
      },
      {
        left: Math.max(0, activeSafeRect.left - padX * 0.25),
        right: Math.min(WORLD_WIDTH - CARD_W, activeSafeRect.right + padX * 0.25),
        top: Math.max(minY, activeSafeRect.top - padY),
        bottom: Math.max(minY, activeSafeRect.top - CARD_H - NEAR_ZONE_GAP),
      },
    ];

    for (const rect of surroundingRects) {
      picked = pickFirstOpen(buildCandidates(rect, {
        avoidViewport: true,
        focus: viewportCenter,
      }));
      if (picked) break;
    }
  }

  if (!picked) {
    picked = pickFirstOpen(buildCandidates({
      left: Math.max(0, zLeft),
      right: Math.min(WORLD_WIDTH - CARD_W, zRight),
      top: Math.max(minY, zTop),
      bottom: Math.min(maxY, zBot),
    }, { focus: viewportCenter })) ?? { x: zLeft, y: zTop };
  }

  const hash = simpleHash(messageSeed);
  const rotSign = (hash & 1) ? 1 : -1;
  const rotMag = ((hash % 140) / 140) * 7;
  const leftPct = Math.max(0, Math.min(96, (picked.x / WORLD_WIDTH) * 100));
  const topPx = Math.max(minY, Math.min(maxY, picked.y));
  return { leftPct, topPx, rotationDeg: rotSign * rotMag };
}
// ─── Component ───────────────────────────────────────────────────────────────
export default function Wall() {
  const [messages, setMessages]       = useState([]);
  const [isLoading, setIsLoading]     = useState(true);
  const [connectionStatus, setConnectionStatus] = useState(null);
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
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  // ── Minimap glow tracking ──────────────────────────────────────────────────
  const [minimapGlowId, setMinimapGlowId] = useState(null);
  const [highlightCardId, setHighlightCardId] = useState(null);
  const highlightTimeoutRef     = useRef(null);
  const highlightCheckIntervalRef = useRef(null);

  const clearHighlight = useCallback(() => {
    if (highlightTimeoutRef.current) {
      window.clearTimeout(highlightTimeoutRef.current);
      highlightTimeoutRef.current = null;
    }
    if (highlightCheckIntervalRef.current) {
      window.clearInterval(highlightCheckIntervalRef.current);
      highlightCheckIntervalRef.current = null;
    }
    setHighlightCardId(null);
  }, []);

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
  const seenMessageIdsRef = useRef(new Set());
  const initialPlacementPassDoneRef = useRef(false);

  useEffect(() => {
    setDocumentHead("CCS Freedom Screen", terminalIcon);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const mediaQuery = window.matchMedia("(pointer: coarse)");
    const updatePointerMode = () => setIsCoarsePointer(mediaQuery.matches);

    updatePointerMode();
    mediaQuery.addEventListener?.("change", updatePointerMode);

    return () => {
      mediaQuery.removeEventListener?.("change", updatePointerMode);
    };
  }, []);

  // ── Supabase fetch + realtime ──────────────────────────────────────────────
  const fetchMessages = useCallback(async (showSpinner) => {
    if (showSpinner) setIsLoading(true);
    const query = await fetchMessagesWithFallback(MAX_MESSAGES);
    if (query.error) {
      setConnectionStatus((current) => current ?? "wall offline; retrying with polling fallback");
      setIsLoading(false);
      return;
    }
    const nextMessages = capMessages((query.data ?? []).filter((message) => !message.is_deleted));
    setMessages(nextMessages);
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
    if (realtimeQueueRef.current.length === 0) return;

    const nextBatch = realtimeQueueRef.current.splice(0, REALTIME_BATCH_SIZE);

    // Collect newly inserted/updated message IDs for minimap glow
    const incomingIds = nextBatch
      .filter((e) => e.type === "INSERT" && e.message?.id != null)
      .map((e) => e.message.id);

    setMessages((previous) => applyRealtimeEvents(previous, nextBatch));

    if (incomingIds.length > 0) {
      const newestId = incomingIds[incomingIds.length - 1];
      setMinimapGlowId(newestId);
      setHighlightCardId(newestId);
    }

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
        queueRealtimeEvent({ type: payload.eventType, message: payload.new });
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

  useEffect(() => {
    if (!isInitialized && boardHeight > 0) {
      initializeView();
    }
  }, [boardHeight, initializeView, isInitialized]);

  useEffect(() => {
    if (!isInitialized || boardHeight <= 0) return;
    const syncViewToViewport = () => {
      const { width, height } = getViewportMetrics(viewportRef.current);
      const minZoom = getFitZoom(boardHeight, width, height);
      const nextZoom = Math.max(minZoom, Math.min(MAX_ZOOM, zoomRef.current));
      const nextPan = clampPan(panRef.current, nextZoom, boardHeight, width, height);
      const panChanged = nextPan.x !== panRef.current.x || nextPan.y !== panRef.current.y;
      if (panChanged) { panRef.current = nextPan; setPan(nextPan); }
      if (nextZoom !== zoomRef.current) { zoomRef.current = nextZoom; setZoom(nextZoom); }
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
      seenMessageIdsRef.current = new Set();
      setBoardHeight(Math.max(window.innerHeight, 600));
      initialPlacementPassDoneRef.current = true;
      setPlacementReady((v) => v + 1);
      return;
    }
    Object.keys(placementsRef.current).forEach((key) => {
      if (!currentIds.has(Number(key))) delete placementsRef.current[Number(key)];
    });

    const previouslySeenIds = seenMessageIdsRef.current;
    const newMessageIds = new Set(messages
      .filter((m) => !previouslySeenIds.has(m.id))
      .map((m) => m.id));
    const placementPassReady = initialPlacementPassDoneRef.current;

    const vpEl   = viewportRef.current;
    const vpW    = vpEl?.clientWidth  ?? window.innerWidth;
    const vpH    = vpEl?.clientHeight ?? window.innerHeight;
    const curPan = panRef.current;
    const curZoom = zoomRef.current;

    // Lane-based fallback for initial load
    const laneCount = Math.max(6, Math.min(16, Math.floor(WORLD_WIDTH / 280)));
    if (laneHeightsRef.current.length === 0) {
      laneHeightsRef.current = Array.from({ length: laneCount }, () => SAFE_AREA_TOP_HEIGHT + 20);
    } else if (laneHeightsRef.current.length < laneCount) {
      laneHeightsRef.current = Array.from({ length: laneCount }, (_, i) =>
        laneHeightsRef.current[i] ?? (SAFE_AREA_TOP_HEIGHT + 20)
      );
    }

    for (const message of messages) {
      if (placementsRef.current[message.id]) continue;

      const bodyLines  = Math.min(3, Math.ceil(message.text.length / 40));
      const cardHeight = BASE_CARD_HEIGHT_BASE + bodyLines * BASE_CARD_HEIGHT_LINE;

      // ── Stored DB placement ────────────────────────────────────────────────
      const hasStoredPlacement =
        Number.isFinite(message.pos_x) &&
        Number.isFinite(message.pos_y) &&
        Number.isFinite(message.rotation);

      if (hasStoredPlacement) {
        placementsRef.current[message.id] = {
          leftPct:     message.pos_x,
          topPx:       message.pos_y,
          cardHeight,
          rotationDeg: message.rotation,
        };
        continue;
      }

      // ── Realtime new entry: place inside visible viewport zone ─────────────
      if (placementPassReady && isInitialized && newMessageIds.has(message.id)) {
        const seed = `${message.id}-${message.created_at}`;
        const vp = computeViewportPlacement(
          curPan.x, curPan.y, curZoom,
          vpW, vpH, boardHeight,
          placementsRef.current,
          seed, message.text
        );
        placementsRef.current[message.id] = { ...vp, cardHeight };
        continue;
      }

      // ── Initial load: lane-based spread ───────────────────────────────────
      const generatedPlacement = generateMessagePlacement(
        `${message.id}-${message.created_at}`,
        message.text
      );
      const lane    = Math.min(laneCount - 1, Math.max(0, Math.floor((generatedPlacement.pos_x / 100) * laneCount)));
      const minTopPx = SAFE_AREA_TOP_HEIGHT + 10;
      const topPx   = Math.max(minTopPx, Math.max(laneHeightsRef.current[lane] ?? minTopPx, generatedPlacement.pos_y));
      laneHeightsRef.current[lane] = topPx + cardHeight + 20;
      placementsRef.current[message.id] = {
        leftPct:     generatedPlacement.pos_x,
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
    seenMessageIdsRef.current = currentIds;
    initialPlacementPassDoneRef.current = true;
    setBoardHeight(nextHeight + SAFE_AREA_BOTTOM_HEIGHT + 64);
    setPlacementReady((v) => v + 1);
  }, [messages, isInitialized, boardHeight]);

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
            year: "numeric", month: "short", day: "numeric",
            hour: "2-digit", minute: "2-digit", second: "2-digit",
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
      setAdminNotice({ tone: "error", message: result.error?.message ?? "The admin password was not accepted." });
      return;
    }
    setAdminSession({ password: adminPassword.trim(), authenticatedAt: Date.now() });
    setAdminNotice({ tone: "success", message: "Admin tools unlocked for this session." });
  }, [adminPassword]);

  const handleAdminLogout = useCallback(() => {
    setAdminSession(null);
    setAdminPassword("");
    setAdminNotice({ tone: "success", message: "Admin session closed." });
  }, []);

  const handleAdminExportCsv = useCallback(() => {
    if (!adminSession?.password) {
      setAdminNotice({ tone: "error", message: "Log in as admin first to export wall data." });
      return;
    }
    if (typeof window === "undefined") return;
    setIsAdminBusy(true);
    setAdminNotice(null);
    void (async () => {
      const exportQuery = await fetchAllMessagesForExport();
      setIsAdminBusy(false);
      if (exportQuery.error) {
        setAdminNotice({ tone: "error", message: exportQuery.error.message });
        return;
      }
      const rows = exportQuery.data ?? [];
      if (rows.length === 0) {
        setAdminNotice({ tone: "error", message: "There are no database rows to export right now." });
        return;
      }
      const csv  = buildCsvFromRows(rows);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url  = window.URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href  = url;
      link.download = `ccs-freedom-screen-data-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
      link.click();
      window.URL.revokeObjectURL(url);
      setAdminNotice({ tone: "success", message: `Downloaded ${rows.length} database rows as CSV.` });
    })();
  }, [adminSession]);

  const handleAdminDeleteAll = useCallback(async () => {
    if (!adminSession?.password) {
      setAdminNotice({ tone: "error", message: "Log in as admin first to delete entries." });
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
      setAdminNotice({ tone: "error", message: result.error.message });
      return;
    }
    placementsRef.current = {};
    laneHeightsRef.current = [];
    realtimeQueueRef.current = [];
    setMessages([]);
    setSelectedEntry(null);
    setUserPositions({});
    setMinimapGlowId(null);
    clearHighlight();
    if (typeof window !== "undefined") window.localStorage.removeItem(POSITIONS_STORAGE_KEY);
    const successMessage = result.mode === "soft-delete"
      ? `Archived ${result.deletedCount} wall entries (hidden immediately).`
      : `Deleted ${result.deletedCount} wall entries.`;
    setAdminNotice({ tone: "success", message: successMessage });
  }, [adminSession, clearHighlight]);

  // ── Canvas pan handlers ────────────────────────────────────────────────────
  const handleCanvasPointerDown = useCallback((e) => {
    panDragRef.current = {
      startPx: e.clientX, startPy: e.clientY,
      startOx: panRef.current.x, startOy: panRef.current.y,
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

  const handleAdminDeleteEntry = useCallback(async (messageId) => {
    if (!adminSession?.password || isAdminBusy) return;
    setIsAdminBusy(true);
    setAdminNotice(null);
    const result = await deleteMessageWithAdminPassword(adminSession.password, messageId);
    setIsAdminBusy(false);
    if (result.error) {
      setAdminNotice({ tone: "error", message: result.error.message });
      return;
    }
    if (result.deletedCount < 1) {
      setAdminNotice({ tone: "error", message: "Entry was already deleted or unavailable." });
      return;
    }
    const targetId = String(messageId);
    setMessages((previous) => previous.filter((message) => String(message.id) !== targetId));
    setUserPositions((previous) => {
      if (!(targetId in previous) && !(messageId in previous)) return previous;
      const next = { ...previous };
      delete next[targetId];
      delete next[messageId];
      return next;
    });
    delete placementsRef.current[targetId];
    delete placementsRef.current[messageId];
    removeSavedPosition(targetId);
    removeSavedPosition(messageId);
    if (String(selectedEntry?.message?.id) === targetId) setSelectedEntry(null);
    setAdminNotice({ tone: "success", message: "Deleted selected entry." });
  }, [adminSession, isAdminBusy, selectedEntry?.message?.id]);

  // ── Note drag handlers ─────────────────────────────────────────────────────
  const handlePointerDown = (e, id, currentLeftPct, currentTopPx) => {
    if (isCoarsePointer) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      id, startPointerX: e.clientX, startPointerY: e.clientY,
      startLeftPct: currentLeftPct, startTopPx: currentTopPx,
      boardWidth: WORLD_WIDTH, moved: false,
    };
    setDraggingId(id);
  };

  const handlePointerMove = (e, id) => {
    if (isCoarsePointer) return;
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
      Math.min(boardHeight - SAFE_AREA_BOTTOM_HEIGHT - 100, drag.startTopPx + deltaTopPx)
    );
    setUserPositions((prev) => ({ ...prev, [id]: { leftPct: newLeftPct, topPx: newTopPx } }));
  };

  const handlePointerUp = (e, message, entry) => {
    if (isCoarsePointer) return;
    const drag = dragRef.current;
    if (!drag || drag.id !== message.id) return;
    const deltaLeftPct = ((e.clientX - drag.startPointerX) / (drag.boardWidth * zoomRef.current)) * 100;
    const finalLeftPct = Math.max(0, Math.min(96, drag.startLeftPct + deltaLeftPct));
    const deltaTopPx   = (e.clientY - drag.startPointerY) / zoomRef.current;
    const finalTopPx   = Math.max(
      SAFE_AREA_TOP_HEIGHT + 4,
      Math.min(boardHeight - SAFE_AREA_BOTTOM_HEIGHT - 100, drag.startTopPx + deltaTopPx)
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
    if (isCoarsePointer) return;
    if (dragRef.current?.id === id) dragRef.current = null;
    setDraggingId(null);
  };

  // ── Minimap data ───────────────────────────────────────────────────────────
  const minimapCards = useMemo(() => {
    if (placedMessages.length === 0) return [];
    return placedMessages.map(({ placement, message }) => ({
      x:  placement.leftPct,
      y:  Math.min((placement.topPx / Math.max(boardHeight, 1)) * 100, 100),
      id: message.id,
    }));
  }, [placedMessages, boardHeight]);

  const minimapViewport = useMemo(() => {
    const vw = viewportRef.current?.clientWidth  ?? window.innerWidth;
    const vh = viewportRef.current?.clientHeight ?? window.innerHeight;
    const currentZoom = zoomRef.current;
    const vpW = Math.min(100, (vw / Math.max(WORLD_WIDTH * currentZoom, 1)) * 100);
    const vpH = Math.min(100, (vh / Math.max(boardHeight * currentZoom, 1)) * 100);
    const vpX = ((-pan.x) / Math.max(WORLD_WIDTH * currentZoom, 1)) * 100;
    const vpY = ((-pan.y) / Math.max(boardHeight * currentZoom, 1)) * 100;
    return {
      vpW, vpH,
      vpX: Math.max(0, Math.min(100 - vpW, vpX)),
      vpY: Math.max(0, Math.min(100 - vpH, vpY)),
    };
  }, [boardHeight, pan, zoom]);

  const highlightedEntry = useMemo(() => (
    highlightCardId == null
      ? null
      : placedMessages.find((entry) => entry.message.id === highlightCardId) ?? null
  ), [highlightCardId, placedMessages]);

  const newCardArrow = useMemo(() => {
    if (!highlightedEntry) return null;
    const viewportWidth = viewportRef.current?.clientWidth ?? window.innerWidth;
    const viewportHeight = viewportRef.current?.clientHeight ?? window.innerHeight;
    const worldX = (highlightedEntry.placement.leftPct / 100) * WORLD_WIDTH + BASE_NOTE_WIDTH / 2;
    const worldY = highlightedEntry.placement.topPx + (highlightedEntry.placement.cardHeight ?? BASE_CARD_HEIGHT_BASE) / 2;
    const screenX = pan.x + worldX * zoom;
    const screenY = pan.y + worldY * zoom;
    const isVisible = screenX >= 0 && screenX <= viewportWidth && screenY >= 0 && screenY <= viewportHeight;
    if (isVisible) return null;
    const centerX = viewportWidth / 2;
    const centerY = viewportHeight / 2;
    const dx = screenX - centerX;
    const dy = screenY - centerY;
    const angle = Math.atan2(dy, dx);
    const edgeInset = 26;
    const edgeX = centerX + Math.cos(angle) * (centerX - edgeInset);
    const edgeY = centerY + Math.sin(angle) * (centerY - edgeInset);
    const clampedX = Math.max(edgeInset, Math.min(viewportWidth - edgeInset, edgeX));
    const clampedY = Math.max(edgeInset, Math.min(viewportHeight - edgeInset, edgeY));
    return { x: clampedX, y: clampedY, angleDeg: (angle * 180) / Math.PI };
  }, [highlightedEntry, pan.x, pan.y, zoom]);

  useEffect(() => {
    if (!highlightCardId) return;
    const isVisibleNow = () => {
      const entry = placedMessages.find((item) => item.message.id === highlightCardId);
      if (!entry) return false;
      const viewportWidth = viewportRef.current?.clientWidth ?? window.innerWidth;
      const viewportHeight = viewportRef.current?.clientHeight ?? window.innerHeight;
      const worldX = (entry.placement.leftPct / 100) * WORLD_WIDTH + BASE_NOTE_WIDTH / 2;
      const worldY = entry.placement.topPx + (entry.placement.cardHeight ?? BASE_CARD_HEIGHT_BASE) / 2;
      const screenX = pan.x + worldX * zoom;
      const screenY = pan.y + worldY * zoom;
      return screenX >= 0 && screenX <= viewportWidth && screenY >= 0 && screenY <= viewportHeight;
    };
    if (isVisibleNow()) {
      clearHighlight();
      return;
    }
    highlightTimeoutRef.current = window.setTimeout(clearHighlight, 9000);
    highlightCheckIntervalRef.current = window.setInterval(() => {
      if (isVisibleNow()) clearHighlight();
    }, 400);
    return () => {
      if (highlightTimeoutRef.current) {
        window.clearTimeout(highlightTimeoutRef.current);
        highlightTimeoutRef.current = null;
      }
      if (highlightCheckIntervalRef.current) {
        window.clearInterval(highlightCheckIntervalRef.current);
        highlightCheckIntervalRef.current = null;
      }
    };
  }, [clearHighlight, highlightCardId, placedMessages, pan.x, pan.y, zoom]);

  const scaledNoteStyles = useMemo(() => {
    // All base values are 1.5× the original to produce bigger cards
    const scaled = (value) => `${(value * zoom).toFixed(2)}px`;
    const scaledBorder = `${Math.max(0.75, zoom).toFixed(2)}px`;
    return {
      noteWidth:          scaled(BASE_NOTE_WIDTH),       // 252
      noteRadius:         scaled(9),                     // was 6
      headerPadding:      `${scaled(7.5)} ${scaled(12)}`, // was 5/8
      bodyPadding:        `${scaled(9)} ${scaled(12)} ${scaled(12)}`, // was 6/8/8
      headerGap:          scaled(9),                     // was 6
      iconSize:           scaled(24),                    // was 16
      filenameFontSize:   scaled(15),                    // was 10
      timestampFontSize:  scaled(13.5),                  // was 9
      messageFontSize:    scaled(18),                    // was 12
      borderWidth:        scaledBorder,
      shadowBlur:         `${(48 * zoom).toFixed(2)}px`, // was 32
      shadowY:            `${(12 * zoom).toFixed(2)}px`, // was 8
      headerBorderWidth:  scaledBorder,
    };
  }, [zoom]);

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <main style={styles.page}>
      <style>{`
        @keyframes wallSpawn {
          from { opacity: 0; transform: scale(0.8); }
          to   { opacity: 1; transform: scale(1);   }
        }
        @keyframes minimapEntryGlow {
          0%   { transform: scale(1);   box-shadow: 0 0 0 0   rgba(0,255,136,0.95); opacity: 1; background: #fff; }
          35%  { transform: scale(4.5); box-shadow: 0 0 10px 6px rgba(0,255,136,0.7); opacity: 1; background: #00ff88; }
          100% { transform: scale(1);   box-shadow: none;                            opacity: 0.7; background: #00ff88; }
        }
      `}</style>

      {/* ── Viewport ── */}
      <section
        ref={viewportRef}
        style={{ ...styles.viewport, cursor: isPanning ? "grabbing" : "grab" }}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerCancel={handleCanvasPointerUp}
        onWheel={handleViewportWheel}
      >
        {/* Background */}
        <div style={{
          position: "absolute", left: 0, top: 0,
          width: `${WORLD_WIDTH}px`, height: `${boardHeight}px`,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "0 0", willChange: "transform", zIndex: 0, pointerEvents: "none",
        }}>
          <WallBackground />
        </div>

        {/* HUD */}
        <div style={styles.hud}>
          <div style={styles.wallTitleBar}>
            <span style={styles.wallTitleBarPrimary}>CCS FREEDOM</span>
            <span style={styles.wallTitleBarDivider}>/</span>
            <span style={styles.wallTitleBarSecondary}>DIGITAL WALL</span>
          </div>
          <div style={styles.buttonBar}>
            {/* <button
              style={styles.controlBtn}
              onClick={() => {
                if (typeof window !== "undefined") window.location.href = "/";
              }}
              title="Open editor"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <span aria-hidden="true" style={styles.controlBtnText}>{"</>"}</span>
            </button> */}
            
            <button style={styles.controlBtn} onClick={resetView} title="Reset view"
              onPointerDown={(e) => e.stopPropagation()}>
              <img src={resetViewIcon} alt="" aria-hidden="true" style={styles.controlIcon} />
            </button>
            <button style={styles.controlBtn} onClick={handleZoomIn} title="Zoom in"
              onPointerDown={(e) => e.stopPropagation()}>
              <img src={zoomInIcon} alt="" aria-hidden="true" style={styles.controlIcon} />
            </button>
            <button style={styles.controlBtn} onClick={handleZoomOut} title="Zoom out"
              onPointerDown={(e) => e.stopPropagation()}>
              <img src={zoomOutIcon} alt="" aria-hidden="true" style={styles.controlIcon} />
            </button>
            <button
              style={{
                ...styles.controlBtn,
                borderColor: adminSession ? "#2d8b57" : "#1a3d2a",
                boxShadow:   adminSession ? "0 0 0 1px rgba(45,139,87,0.35)" : "none",
              }}
              onClick={() => setShowLoginDialog(true)}
              title={adminSession ? "Admin tools unlocked" : "Admin login"}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <img src={loginIcon} alt="" aria-hidden="true" style={styles.controlIcon} />
            </button>
          </div>

          <div style={styles.promptLine}>
            <img src={terminalIcon} alt="" aria-hidden="true" style={styles.promptIcon} />
          </div>
          {newCardArrow && (
            <div
              style={{
                ...styles.newCardArrow,
                left: `${newCardArrow.x}px`,
                top: `${newCardArrow.y}px`,
                transform: `translate(-50%, -50%) rotate(${newCardArrow.angleDeg}deg)`,
              }}
              title="New entry direction">{">"}</div>
          )}
          <div style={styles.zoomLevel}>zoom {Math.round(zoom * 100)}%</div>
          {connectionStatus && <div style={styles.statusLine}>{connectionStatus}</div>}

          {/* Minimap */}
          {placedMessages.length > 0 && (
            <div style={styles.minimap}>
              {minimapCards.map((c) => {
                const isNew = minimapGlowId === c.id;
                return (
                  <div
                    key={c.id}
                    style={{
                      position: "absolute",
                      left: `${c.x}%`,
                      top:  `${c.y}%`,
                      width: 2, height: 2,
                      background: "#00ff88",
                      borderRadius: 1,
                      opacity: 0.7,
                      // Glow animation plays exactly once for new entries
                      animation: isNew
                        ? "minimapEntryGlow 0.9s ease-out forwards"
                        : "none",
                    }}
                    onAnimationEnd={isNew ? () => setMinimapGlowId((current) => (current === c.id ? null : current)) : undefined}
                  />
                );
              })}
              {/* Viewport indicator */}
              <div style={{
                position: "absolute",
                left:   `${minimapViewport.vpX}%`,
                top:    `${minimapViewport.vpY}%`,
                width:  `${Math.min(minimapViewport.vpW, 100)}%`,
                height: `${Math.min(minimapViewport.vpH, 100)}%`,
                border: "1px solid rgba(0,255,136,0.5)",
                pointerEvents: "none",
              }} />
            </div>
          )}
        </div>

        {/* World */}
        <div style={{
          position: "absolute",
          left: `${pan.x}px`, top: `${pan.y}px`,
          width: `${WORLD_WIDTH * zoom}px`, height: `${boardHeight * zoom}px`,
          zIndex: 1, pointerEvents: "none",
        }}>
          {isLoading ? (
            <div style={styles.emptyState}>loading wall...</div>
          ) : placedMessages.length === 0 ? (
            <div style={styles.emptyState}>waiting for first entry...</div>
          ) : (
            <section ref={boardRef} style={{ ...styles.board, width: "100%", height: "100%" }}>
              <div aria-hidden="true" style={{
                ...styles.safeAreaGuide, top: 0,
                height: `${SAFE_AREA_TOP_HEIGHT * zoom}px`,
                borderBottom: "1px solid rgba(143, 210, 173, 0.12)",
              }} />
              <div aria-hidden="true" style={{
                ...styles.safeAreaGuide, bottom: 0,
                height: `${SAFE_AREA_BOTTOM_HEIGHT * zoom}px`,
                borderTop: "1px solid rgba(143, 210, 173, 0.12)",
              }} />
              {placedMessages.map((entry) => {
                const { message, placement, langConfig, timeLabel } = entry;
                return (
                  <article
                    key={message.id}
                    data-note-id={message.id}
                    style={{
                      ...styles.note,
                      left:       `${placement.leftPct}%`,
                      top:        `${placement.topPx * zoom}px`,
                      width:      scaledNoteStyles.noteWidth,
                      transform:  `rotate(${placement.rotationDeg}deg)`,
                      cursor:     isCoarsePointer ? "pointer" : draggingId === message.id ? "grabbing" : "grab",
                      userSelect: "none", touchAction: isCoarsePointer ? "manipulation" : "none",
                      zIndex:     draggingId === message.id ? 10 : 1,
                      transition: draggingId === message.id ? "none" : "box-shadow 120ms ease",
                      boxShadow:  draggingId === message.id
                        ? `0 ${scaledNoteStyles.shadowY} ${scaledNoteStyles.shadowBlur} rgba(0,255,136,0.18)`
                        : undefined,
                      pointerEvents: "all",
                    }}
                    onPointerDown={(e) => handlePointerDown(e, message.id, placement.leftPct, placement.topPx)}
                    onPointerMove={(e) => handlePointerMove(e, message.id)}
                    onPointerUp={(e)   => handlePointerUp(e, message, entry)}
                    onPointerCancel={(e) => handlePointerCancel(e, message.id)}
                    onClick={isCoarsePointer ? () => openEntryDetails(entry) : undefined}
                    onDoubleClick={() => openEntryDetails(entry)}
                  >
                    <div style={{
                      ...styles.cardWrapper,
                      borderWidth:  scaledNoteStyles.borderWidth,
                      borderRadius: scaledNoteStyles.noteRadius,
                      animation: draggingId === message.id ? "none" : "wallSpawn 0.3s ease",
                    }}>
                      <div style={{
                        ...styles.cardHeader,
                        padding:          scaledNoteStyles.headerPadding,
                        gap:              scaledNoteStyles.headerGap,
                        borderBottomWidth: scaledNoteStyles.headerBorderWidth,
                      }}>
                        <div style={{
                          ...styles.iconContainer,
                          width:  scaledNoteStyles.iconSize,
                          height: scaledNoteStyles.iconSize,
                        }}>
                          <LanguageIcon language={message.language || langConfig.key} size={scaledNoteStyles.iconSize} />
                        </div>
                        <span style={{ ...styles.filename,  fontSize: scaledNoteStyles.filenameFontSize  }}>{langConfig.fileName}</span>
                        <span style={{ ...styles.timestamp, fontSize: scaledNoteStyles.timestampFontSize }}>[{timeLabel}]</span>
                      </div>
                      <div style={{ ...styles.cardBody, padding: scaledNoteStyles.bodyPadding }}>
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
                <div style={styles.detailSubtitle}>{adminSession ? "session unlocked" : "login required"}</div>
              </div>
              <button style={styles.closeBtn} onClick={() => setShowLoginDialog(false)}
                onPointerDown={(e) => e.stopPropagation()}>X</button>
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
              {/* <p style={styles.dialogText}>
                Use the admin password to unlock the destructive action. Exporting saves the
                raw wall table data as a CSV file. 
              </p> */}
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
                <div style={{
                  ...styles.adminNotice,
                  borderColor: adminNotice.tone === "error" ? "rgba(255,107,107,0.35)" : "rgba(45,139,87,0.35)",
                  color:       adminNotice.tone === "error" ? "#ffb3b3" : "#bff0cf",
                }}>
                  {adminNotice.message}
                </div>
              )}
              <div style={styles.adminActionGrid}>
                <button type="button" style={styles.adminPrimaryBtn}
                  onClick={() => void handleAdminLogin()} disabled={isAdminBusy}>
                  {isAdminBusy ? "Checking..." : adminSession ? "Re-verify Password" : "Unlock Admin Tools"}
                </button>
                <button type="button"
                  style={{ ...styles.adminSecondaryBtn, opacity: adminSession ? 1 : 0.55 }}
                  onClick={handleAdminExportCsv} disabled={!adminSession || isAdminBusy}>
                  Export Wall Data CSV
                </button>
                <button type="button"
                  style={{ ...styles.adminDangerBtn, opacity: adminSession ? 1 : 0.55 }}
                  onClick={() => void handleAdminDeleteAll()} disabled={!adminSession || isAdminBusy}>
                  Delete All Entries
                </button>
                <button type="button" style={styles.adminSecondaryBtn}
                  onClick={handleAdminLogout} disabled={!adminSession || isAdminBusy}>
                  Logout
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Entry Detail Dialog ── */}
      {selectedEntry && (
        <div style={styles.dialogOverlay} onClick={() => setSelectedEntry(null)}>
          <div style={{ ...styles.dialogBox, ...styles.entryDialogBox }} onClick={(e) => e.stopPropagation()}>
            <div style={styles.dialogHeader}>
              <div>
                <h2 style={styles.dialogTitle}>{selectedEntry.langConfig.fileName}</h2>
                <div style={styles.detailSubtitle}>entry details</div>
              </div>
              <button style={styles.closeBtn} onClick={() => setSelectedEntry(null)}
                onPointerDown={(e) => e.stopPropagation()}>X</button>
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
              {adminSession?.password && (
                <div style={styles.detailActions}>
                  <button
                    type="button"
                    style={styles.detailDeleteBtn}
                    disabled={isAdminBusy}
                    onClick={() => void handleAdminDeleteEntry(selectedEntry.message.id)}
                  >
                    {isAdminBusy ? "Deleting..." : "Delete Entry"}
                  </button>
                </div>
              )}
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
    overflow:   "hidden",
    boxSizing:  "border-box",
  },
  viewport: {
    position:   "relative",
    height:     "calc(100dvh - 24px)",
    overflow:   "hidden",
    border:     "1px solid #111111",
    background: "repeating-linear-gradient(180deg, rgba(0,255,136,0.03) 0 1px, transparent 1px 3px), #050505",
    userSelect: "none",
    touchAction: "none",
    overscrollBehavior: "contain",
  },
  hud: {
    position:      "absolute",
    inset:         0,
    zIndex:        20,
    pointerEvents: "none",
  },
  wallTitleBar: {
    position: "absolute",
    top: "12px",
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "8px 16px",
    border: "1px solid #153222",
    borderRadius: "999px",
    background: "rgba(2, 10, 6, 0.78)",
    boxShadow: "0 0 18px rgba(0, 255, 65, 0.08)",
    textAlign: "center",
    pointerEvents: "none",
    zIndex: 10,
  },
  wallTitleBarPrimary: {
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
    fontSize: "12px",
    fontWeight: 700,
    color: "#00ff41",
    letterSpacing: "0.16em",
    margin: 0,
    lineHeight: 1,
    textTransform: "uppercase",
  },
  wallTitleBarDivider: {
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
    fontSize: "11px",
    color: "#235b38",
    lineHeight: 1,
  },
  wallTitleBarSecondary: {
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
    fontSize: "11px",
    color: "#2a8a2a",
    letterSpacing: "0.22em",
    margin: 0,
    lineHeight: 1,
    textTransform: "uppercase",
  },
  promptLine: {
    position:      "absolute",
    top:           "12px",
    left:          "12px",
    pointerEvents: "none",
    display:       "flex",
    alignItems:    "center",
    justifyContent: "center",
  },
  promptIcon: { width: "20px", height: "20px", display: "block" },
  newCardArrow: {
    position: "absolute",
    pointerEvents: "none",
    color: "#00ff88",
    fontSize: "28px",
    fontWeight: 700,
    textShadow: "0 0 12px rgba(0,255,136,0.75)",
    zIndex: 24,
    lineHeight: 1,
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
    position:      "absolute",
    top:           "50px",
    right:         "12px",
    pointerEvents: "none",
    background:    "rgba(4,11,8,0.8)",
    border:        "1px solid #1a3d2a",
    color:         "#6ea287",
    fontSize:      "11px",
    padding:       "4px 10px",
    letterSpacing: "0.06em",
    fontFamily:    'Consolas, Monaco, "Courier New", monospace',
    borderRadius:  "999px",
    textTransform: "uppercase",
  },
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
  board: { position: "relative" },
  safeAreaGuide: {
    position:      "absolute",
    left:          0,
    width:         "100%",
    background:    "rgba(143,210,173,0.015)",
    boxSizing:     "border-box",
    pointerEvents: "none",
    zIndex:        0,
  },
  note: {
    position:       "absolute",
    borderRadius:   "9px",
    transformOrigin: "top left",
  },
  cardWrapper: {
    padding:    "0px",
    border:     "1px solid #0d3a0d",
    background: "#070f07",
    borderRadius: "9px",
    overflow:   "hidden",
    transition: "border-color 150ms",
  },
  cardHeader: {
    padding:      "7px 12px",
    background:   "#0a1f0a",
    borderBottom: "1px solid #0d3a0d",
    display:      "flex",
    alignItems:   "center",
    gap:          "9px",
    fontSize:     "15px",
    color:        "#2a8c2a",
  },
  iconContainer: {
    width: "24px", height: "24px",
    flexShrink: 0, display: "flex",
    alignItems: "center", justifyContent: "center",
  },
  filename: {
    flex: 1, overflow: "hidden",
    textOverflow: "ellipsis", whiteSpace: "nowrap",
    fontSize: "15px", color: "#2a8c2a",
  },
  timestamp: {
    fontSize: "13px", color: "#1a5c1a",
    whiteSpace: "nowrap", flexShrink: 0,
  },
  cardBody: { padding: "9px 12px 12px" },
  messageText: {
    fontSize: "18px", color: "#00cc55",
    lineHeight: "1.45", wordBreak: "break-word", whiteSpace: "pre-wrap",
  },
  quote: { color: "#1a6b1a" },
  buttonBar: {
    position:      "absolute",
    top:           "12px",
    right:         "12px",
    display:       "flex",
    gap:           "6px",
    pointerEvents: "all",
    zIndex:        25,
  },
  controlBtn: {
    width: "32px", height: "32px", padding: "6px",
    background: "rgba(0,0,0,0.7)",
    border: "1px solid #1a3d2a",
    color: "#00ff88", cursor: "pointer",
    borderRadius: "4px", display: "flex",
    alignItems: "center", justifyContent: "center",
    transition: "all 150ms ease",
    fontSize: "0px", lineHeight: 1,
  },
  controlBtnText: {
    color: "#6ea287",
    fontSize: "11px",
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
    letterSpacing: "0.02em",
    pointerEvents: "none",
  },
  controlIcon: { width: "16px", height: "16px", display: "block", pointerEvents: "none" },
  dialogOverlay: {
    position: "fixed", inset: 0,
    background: "rgba(0,0,0,0.7)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 50, pointerEvents: "all",
  },
  dialogBox: {
    background: "rgba(0,0,0,0.95)",
    border: "1px solid #1a5c1a",
    borderRadius: "8px",
    minWidth: "320px", maxWidth: "500px",
    boxShadow: "0 0 32px rgba(0,255,136,0.15)",
    pointerEvents: "all", overflow: "hidden",
  },
  adminDialogBox: { width: "min(560px, calc(100vw - 32px))" },
  entryDialogBox: {
    width: "min(760px, calc(100vw - 32px))", maxWidth: "760px",
    maxHeight: "min(82dvh, 820px)",
    display: "flex", flexDirection: "column",
  },
  dialogHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "16px 20px", borderBottom: "1px solid #1a3d2a",
    background: "rgba(10,31,10,0.6)",
  },
  dialogTitle: {
    margin: 0, fontSize: "16px", color: "#00ff88",
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  },
  closeBtn: {
    background: "transparent", border: "none",
    color: "#4f7a63", fontSize: "20px",
    cursor: "pointer", padding: "0px 8px",
    lineHeight: 1, transition: "color 150ms",
  },
  dialogContent: { padding: "20px", overflow: "auto" },
  dialogText: {
    margin: 0, fontSize: "13px", color: "#4f7a63",
    lineHeight: 1.6, fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  },
  adminSummaryRow: {
    display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "10px", marginBottom: "18px",
  },
  adminSummaryCard: {
    border: "1px solid #173b24", borderRadius: "8px",
    padding: "12px", background: "rgba(5,16,8,0.8)",
  },
  adminSummaryLabel: {
    fontSize: "10px", color: "#5c8f73",
    textTransform: "uppercase", letterSpacing: "0.08em",
    marginBottom: "8px", fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  },
  adminSummaryValue: {
    fontSize: "18px", color: "#c7e7d3",
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  },
  adminField: { display: "flex", flexDirection: "column", gap: "8px", marginTop: "18px" },
  adminFieldLabel: {
    fontSize: "11px", color: "#5c8f73",
    textTransform: "uppercase", letterSpacing: "0.08em",
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  },
  adminInput: {
    width: "100%", minHeight: "44px", padding: "12px 14px",
    borderRadius: "8px", border: "1px solid #173b24",
    background: "#051008", color: "#d6f5e0",
    outline: "none", fontSize: "13px",
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  },
  adminNotice: {
    marginTop: "14px", padding: "12px 14px",
    borderRadius: "8px", border: "1px solid",
    background: "rgba(5,16,8,0.8)",
    fontSize: "12px", lineHeight: 1.6,
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  },
  adminActionGrid: {
    display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "10px", marginTop: "16px",
  },
  adminPrimaryBtn: {
    minHeight: "42px", border: "1px solid #2d8b57",
    background: "#0f3d24", color: "#d6f5e0",
    borderRadius: "8px", cursor: "pointer",
    fontSize: "12px", fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  },
  adminSecondaryBtn: {
    minHeight: "42px", border: "1px solid #173b24",
    background: "#07130b", color: "#c7e7d3",
    borderRadius: "8px", cursor: "pointer",
    fontSize: "12px", fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  },
  adminDangerBtn: {
    minHeight: "42px", border: "1px solid #6a2626",
    background: "#2a0d0d", color: "#ffb3b3",
    borderRadius: "8px", cursor: "pointer",
    fontSize: "12px", fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  },
  adminFootnote: {
    marginTop: "14px", fontSize: "11px",
    color: "#5c8f73", lineHeight: 1.6,
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  },
  detailSubtitle: {
    marginTop: "4px", fontSize: "11px", color: "#5c8f73",
    textTransform: "uppercase", letterSpacing: "0.08em",
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  },
  detailMetaGrid: {
    display: "grid", gridTemplateColumns: "88px 1fr",
    gap: "10px 16px", alignItems: "start", marginBottom: "18px",
  },
  detailMetaLabel: {
    fontSize: "11px", color: "#5c8f73",
    textTransform: "uppercase", letterSpacing: "0.08em",
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  },
  detailMetaValue: {
    fontSize: "13px", color: "#c7e7d3", lineHeight: 1.5,
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
    whiteSpace: "pre-wrap", wordBreak: "break-word",
  },
  detailCodeHeader: {
    marginBottom: "10px", fontSize: "11px", color: "#5c8f73",
    textTransform: "uppercase", letterSpacing: "0.08em",
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  },
  detailCodeBlock: {
    margin: 0, padding: "16px",
    background: "#051008", border: "1px solid #173b24",
    borderRadius: "8px", color: "#bff0cf",
    fontSize: "12px", lineHeight: 1.55,
    overflow: "auto", whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  },
  detailActions: {
    marginTop: "14px",
    display: "flex",
    justifyContent: "flex-end",
  },
  detailDeleteBtn: {
    minHeight: "40px",
    padding: "0 14px",
    border: "1px solid #6a2626",
    background: "#2a0d0d",
    color: "#ffb3b3",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "12px",
    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
  },
};




