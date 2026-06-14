import { useState, useEffect, useMemo, useRef } from "react";
import {
  statusOf, relativeLabel, summarize, sortTasks,
  isDone, repeatLabel, fmtISO, occurrenceDate, groupUpcoming,
  isToday, todayAgendaText,
} from "./logic.js";

const STORE_KEY = "on-schedule.tasks.v1";

// Grow a textarea to fit its content; CSS max-height caps it and adds scroll.
function autosize(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

function normalize(t) {
  return {
    id: t.id,
    title: t.title || "",
    note: t.note || "",
    createdAt: t.createdAt || Date.now(),
    due: t.due ?? null,
    time: t.time ?? null,
    repeat: t.repeat ?? null,
    done: !!t.done,
    lastDone: t.lastDone ?? null,
  };
}

function loadTasks() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalize) : [];
  } catch {
    return [];
  }
}

const GROUPS = [
  { key: "overdue", label: "Overdue" },
  { key: "soon", label: "Due soon" },
  { key: "upcoming", label: "Upcoming" },
  { key: "anytime", label: "Anytime" },
  { key: "done", label: "Done" },
];

// Picker shows Monday-first; values are JS weekdays (Sun=0..Sat=6).
const WEEKDAYS = [
  { lbl: "M", val: 1 }, { lbl: "T", val: 2 }, { lbl: "W", val: 3 },
  { lbl: "T", val: 4 }, { lbl: "F", val: 5 }, { lbl: "S", val: 6 },
  { lbl: "S", val: 0 },
];

function Check() {
  return (<svg viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5L20 6" /></svg>);
}
function Trash() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
    </svg>);
}
function NoteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h16M4 12h16M4 19h10" />
    </svg>);
}
function Repeat() {
  return (
    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>);
}
function Pencil() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>);
}
function Copy() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>);
}
function Chevron() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>);
}
function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" /><path d="M21 21l-3.5-3.5" />
    </svg>);
}

// ---------------------------------------------------------------------------
// Floating assistive-touch button. Self-contained: its own state lives here so
// dragging never re-renders the rest of the app. Future hooks (mini mode,
// always-on-top, notifications, overlay) can layer onto this component.
// ---------------------------------------------------------------------------
const FAB_MARGIN = 24;
const FAB_DRAG_THRESHOLD = 6;

function fabSize() {
  return typeof window !== "undefined" && window.innerWidth <= 560 ? 52 : 56;
}
function clampFab(p, size) {
  return {
    x: Math.max(0, Math.min(p.x, window.innerWidth - size)),
    y: Math.max(0, Math.min(p.y, window.innerHeight - size)),
  };
}
function defaultFabPos(size) {
  return {
    x: window.innerWidth - size - FAB_MARGIN,
    y: window.innerHeight - size - FAB_MARGIN,
  };
}

// --- Platform adapters ---------------------------------------------------
// WebAdapter is fully active. DesktopAdapter (Tauri) and AndroidAdapter
// (Capacitor) are prepared so the same provider drives every target; their
// native calls are guarded and fall back to web behavior until those builds
// exist. Persistence keys: jk.fab.position, jk.fab.settings.
const JK_KEYS = { pos: "jk.fab.position", settings: "jk.fab.settings" };

const WebAdapter = {
  name: "web",
  capabilities: { overlay: false, tray: false, restore: false, nativeNotify: false },
  loadJSON(key, fallback) {
    try {
      const r = localStorage.getItem(key);
      return r ? JSON.parse(r) : fallback;
    } catch {
      return fallback;
    }
  },
  saveJSON(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch {
      /* storage blocked */
    }
  },
  loadPosition() { return this.loadJSON(JK_KEYS.pos, null); },
  savePosition(p) { this.saveJSON(JK_KEYS.pos, { x: p.x, y: p.y }); },
  loadSettings() { return this.loadJSON(JK_KEYS.settings, {}); },
  saveSettings(s) { this.saveJSON(JK_KEYS.settings, s); },
  restoreApp() { try { window.focus(); } catch { /* */ } },
  notify(title, body) {
    try {
      if ("Notification" in window && Notification.permission === "granted")
        new Notification(title, { body });
    } catch {
      /* */
    }
  },
};

// Tauri desktop: localStorage works inside the webview, so persistence is
// inherited; restore + notify use the native bridge when present.
const DesktopAdapter = {
  ...WebAdapter,
  name: "desktop",
  capabilities: { overlay: true, tray: true, restore: true, nativeNotify: true },
  restoreApp() {
    try {
      const t = window.__TAURI__;
      if (t && t.core && t.core.invoke) t.core.invoke("show_main");
      else if (t && t.invoke) t.invoke("show_main");
    } catch {
      /* */
    }
  },
  notify(title, body) {
    try {
      const n = window.__TAURI__ && window.__TAURI__.notification;
      if (n && n.sendNotification) n.sendNotification({ title, body });
    } catch {
      /* */
    }
  },
};

// Android (Capacitor): the floating system bubble itself is a native plugin
// (SYSTEM_ALERT_WINDOW); this adapter is the JS-side seam it binds to.
const AndroidAdapter = {
  ...WebAdapter,
  name: "android",
  capabilities: { overlay: true, tray: false, restore: true, nativeNotify: true },
};

function selectAdapter() {
  try {
    if (typeof window !== "undefined") {
      if (window.__TAURI__) return DesktopAdapter;
      const cap = window.Capacitor;
      if (cap && cap.isNativePlatform && cap.isNativePlatform()) {
        return cap.getPlatform && cap.getPlatform() === "android"
          ? AndroidAdapter
          : WebAdapter;
      }
    }
  } catch {
    /* */
  }
  return WebAdapter;
}

function FabPlus() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>);
}
function FabGear() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>);
}

function AssistiveTouchProvider({ badgeCount = 0, onQuickAdd, onCopyAgenda, onSearch, onSettings }) {
  const adapter = useMemo(selectAdapter, []);
  const [size, setSize] = useState(fabSize);
  const [pos, setPos] = useState(() => {
    const s = fabSize();
    const saved = adapter.loadPosition();
    return saved ? clampFab(saved, s) : defaultFabPos(s);
  });
  const [settings, setSettings] = useState(() => adapter.loadSettings() || {});
  const [side, setSide] = useState(() =>
    settings.side || (pos.x + size / 2 >= window.innerWidth / 2 ? "right" : "left")
  );
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const rootRef = useRef(null);
  const fabRef = useRef(null);
  const drag = useRef({ active: false, moved: false, sx: 0, sy: 0, ox: 0, oy: 0, cx: 0, cy: 0 });

  function persistSide(next) {
    setSide(next);
    setSettings((prev) => {
      const merged = { ...prev, side: next };
      adapter.saveSettings(merged);
      return merged;
    });
  }

  // Stay attached to its edge across resize / rotation.
  useEffect(() => {
    const onResize = () => {
      const s = fabSize();
      setSize(s);
      setPos((p) => {
        const right = p.x + s / 2 >= window.innerWidth / 2;
        return {
          x: right ? window.innerWidth - s - FAB_MARGIN : FAB_MARGIN,
          y: Math.max(FAB_MARGIN, Math.min(p.y, window.innerHeight - s - FAB_MARGIN)),
        };
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Close on outside click or Escape while open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function onPointerDown(e) {
    const d = drag.current;
    d.active = true; d.moved = false;
    d.sx = e.clientX; d.sy = e.clientY;
    d.ox = pos.x; d.oy = pos.y; d.cx = pos.x; d.cy = pos.y;
    setDragging(true);
    try { fabRef.current.setPointerCapture(e.pointerId); } catch { /* */ }
  }
  function onPointerMove(e) {
    const d = drag.current;
    if (!d.active) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) >= FAB_DRAG_THRESHOLD) d.moved = true;
    const nx = Math.max(0, Math.min(d.ox + dx, window.innerWidth - size));
    const ny = Math.max(0, Math.min(d.oy + dy, window.innerHeight - size));
    d.cx = nx; d.cy = ny;
    setPos({ x: nx, y: ny });
  }
  function onPointerUp(e) {
    const d = drag.current;
    if (!d.active) return;
    d.active = false;
    setDragging(false);
    try { fabRef.current.releasePointerCapture(e.pointerId); } catch { /* */ }
    if (d.moved) {
      // Snap to nearest left/right edge, preserve Y.
      const right = d.cx + size / 2 >= window.innerWidth / 2;
      const np = {
        x: right ? window.innerWidth - size - FAB_MARGIN : FAB_MARGIN,
        y: Math.max(FAB_MARGIN, Math.min(d.cy, window.innerHeight - size - FAB_MARGIN)),
      };
      persistSide(right ? "right" : "left");
      setPos(np);
      adapter.savePosition(np);
    } else {
      setOpen((o) => !o); // movement < threshold → treat as click
    }
  }
  function onKeyDown(e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen((o) => !o);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const act = (fn) => () => { setOpen(false); if (fn) fn(); };
  const badge = badgeCount > 99 ? "99+" : badgeCount;

  return (
    <div ref={rootRef} className="fab-root"
      style={{ left: pos.x, top: pos.y, width: size, height: size,
        transition: dragging ? "none" : undefined }}>
      <div className={`fab-menu side-${side} ${open ? "fab-menu--open" : ""}`}
        role="menu" aria-label="Assistive menu actions">
        <button className="fab-item" role="menuitem" onClick={act(onQuickAdd)}>
          <FabPlus /><span>Quick add</span>
        </button>
        <button className="fab-item" role="menuitem" onClick={act(onCopyAgenda)}>
          <Copy /><span>Copy agenda</span>
        </button>
        <button className="fab-item" role="menuitem" onClick={act(onSearch)}>
          <SearchIcon /><span>Search</span>
        </button>
        <button className="fab-item" role="menuitem" onClick={act(onSettings)}>
          <FabGear /><span>Settings</span>
        </button>
      </div>
      <div ref={fabRef} className="fab" role="button" tabIndex={0}
        aria-label="Assistive menu" aria-haspopup="menu" aria-expanded={open}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onKeyDown={onKeyDown}>
        <span className="m-j">J</span><span className="m-k">K</span>
        {badgeCount > 0 && (
          <span className="fab-badge" aria-label={`${badgeCount} overdue`}>{badge}</span>
        )}
      </div>
    </div>
  );
}

// Renders inside the tiny always-on-top Tauri overlay window (index.html#overlay):
// just the JK bubble + overdue badge. Click → restore the main window.
// The window itself is dragged via the Tauri drag region.
function overlayOverdue() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const tasks = raw ? JSON.parse(raw) : [];
    return summarize(tasks).overdue || 0;
  } catch {
    return 0;
  }
}
export function OverlayBubble() {
  const adapter = useMemo(selectAdapter, []);
  const [overdue, setOverdue] = useState(overlayOverdue);
  useEffect(() => {
    // Event-driven badge refresh when the main window writes tasks. No polling.
    const onStorage = () => setOverdue(overlayOverdue());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const restore = () => adapter.restoreApp();
  const badge = overdue > 99 ? "99+" : overdue;
  return (
    <div className="overlay-root" data-tauri-drag-region onClick={restore}
      role="button" tabIndex={0} aria-label="Open JhunKeeper"
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); restore(); }
      }}>
      <div className="fab">
        <span className="m-j">J</span><span className="m-k">K</span>
        {overdue > 0 && <span className="fab-badge" aria-label={`${overdue} overdue`}>{badge}</span>}
      </div>
    </div>
  );
}

export default function App() {
  const [tasks, setTasks] = useState(loadTasks);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [time, setTime] = useState("");
  const [repeatMode, setRepeatMode] = useState("once"); // once | daily | weekly
  const [weeklyDays, setWeeklyDays] = useState([]);
  const [openNote, setOpenNote] = useState(null);
  const [editing, setEditing] = useState(null); // task id being edited
  const [eTitle, setETitle] = useState("");
  const [eDue, setEDue] = useState("");
  const [eTime, setETime] = useState("");
  const [eRepeatMode, setERepeatMode] = useState("once");
  const [eWeeklyDays, setEWeeklyDays] = useState([]);
  const [eNote, setENote] = useState("");
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState({});
  const [stuck, setStuck] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // task pending deletion

  // Sticky dashboard: subtle shadow once the page is scrolled.
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Auto-grow the composer title and the edit-modal title.
  const titleRef = useRef(null);
  useEffect(() => autosize(titleRef.current), [title]);
  const eTitleRef = useRef(null);
  useEffect(() => {
    if (editing) autosize(eTitleRef.current);
  }, [eTitle, editing]);
  const searchRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(tasks));
    } catch {
      /* storage blocked — board still works in-session */
    }
  }, [tasks]);

  // Re-evaluate overdue / occurrences when the day flips with the tab open.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const now = new Date();
  const summary = useMemo(() => summarize(tasks, now), [tasks]);
  const sorted = useMemo(() => sortTasks(tasks, now), [tasks]);
  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      q
        ? sorted.filter(
            (t) =>
              t.title.toLowerCase().includes(q) ||
              (t.note || "").toLowerCase().includes(q)
          )
        : sorted,
    [sorted, q]
  );
  const todayTasks = useMemo(
    () => visible.filter((t) => isToday(t, now)),
    [visible]
  );
  const todayAllCount = useMemo(
    () => sorted.filter((t) => isToday(t, now)).length,
    [sorted]
  );
  const grouped = useMemo(() => {
    const g = {};
    for (const t of visible) {
      if (isToday(t, now)) continue; // surfaced in the Today section instead
      (g[statusOf(t, now)] ||= []).push(t);
    }
    return g;
  }, [visible]);
  const visibleCount =
    todayTasks.length +
    Object.values(grouped).reduce((n, arr) => n + arr.length, 0);

  const toggleCollapse = (key) =>
    setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  function toggleWeekday(val) {
    setWeeklyDays((d) =>
      d.includes(val) ? d.filter((x) => x !== val) : [...d, val]
    );
  }

  function addTask() {
    const text = title.trim();
    if (!text) return;

    let repeat = null;
    if (repeatMode === "daily") repeat = "daily";
    else if (repeatMode === "weekly") {
      if (weeklyDays.length === 0) return; // need at least one day
      repeat = { weekly: [...weeklyDays] };
    }

    setTasks((prev) => [
      {
        id: (crypto.randomUUID && crypto.randomUUID()) ||
          String(Date.now() + Math.random()),
        title: text,
        due: repeat ? null : due || null,
        time: time || null,
        repeat,
        note: "",
        done: false,
        lastDone: null,
        createdAt: Date.now(),
      },
      ...prev,
    ]);
    setTitle(""); setDue(""); setTime("");
    setRepeatMode("once"); setWeeklyDays([]);
  }

  function clearComposer() {
    setTitle(""); setDue(""); setTime("");
    setRepeatMode("once"); setWeeklyDays([]);
  }
  const composerDirty =
    title.trim() !== "" || due !== "" || time !== "" ||
    repeatMode !== "once" || weeklyDays.length > 0;

  function toggleDone(id) {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        if (t.repeat) {
          const occ = fmtISO(occurrenceDate(t, new Date()));
          return { ...t, lastDone: isDone(t, new Date()) ? null : occ };
        }
        return { ...t, done: !t.done };
      })
    );
  }
  function updateNote(id, note) {
    setTasks((p) => p.map((t) => (t.id === id ? { ...t, note } : t)));
  }
  function removeTask(id) {
    setTasks((p) => p.filter((t) => t.id !== id));
    if (openNote === id) setOpenNote(null);
  }
  function doConfirmDelete() {
    if (confirmDelete) removeTask(confirmDelete.id);
    setConfirmDelete(null);
  }
  // Close the delete confirmation on Escape.
  useEffect(() => {
    if (!confirmDelete) return;
    const onKey = (e) => e.key === "Escape" && setConfirmDelete(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmDelete]);
  // Only one-off completed tasks are clearable; recurring ones stay.
  const clearableCount = tasks.filter((t) => !t.repeat && t.done).length;
  function clearDone() {
    setTasks((p) => p.filter((t) => !(!t.repeat && t.done)));
  }

  // --- edit -------------------------------------------------------------
  function openEdit(t) {
    setEditing(t.id);
    setETitle(t.title);
    setEDue(t.due || "");
    setETime(t.time || "");
    setENote(t.note || "");
    if (t.repeat === "daily") {
      setERepeatMode("daily");
      setEWeeklyDays([]);
    } else if (t.repeat && t.repeat.weekly) {
      setERepeatMode("weekly");
      setEWeeklyDays([...t.repeat.weekly]);
    } else {
      setERepeatMode("once");
      setEWeeklyDays([]);
    }
  }
  function cancelEdit() {
    setEditing(null);
  }
  function toggleEditWeekday(val) {
    setEWeeklyDays((d) =>
      d.includes(val) ? d.filter((x) => x !== val) : [...d, val]
    );
  }
  function saveEdit() {
    const text = eTitle.trim();
    if (!text) return;
    let repeat = null;
    if (eRepeatMode === "daily") repeat = "daily";
    else if (eRepeatMode === "weekly") {
      if (eWeeklyDays.length === 0) return;
      repeat = { weekly: [...eWeeklyDays] };
    }
    setTasks((prev) =>
      prev.map((t) =>
        t.id === editing
          ? {
              ...t,
              title: text,
              due: repeat ? null : eDue || null,
              time: eTime || null,
              repeat,
              note: eNote,
            }
          : t
      )
    );
    setEditing(null);
  }

  // Close the edit modal on Escape.
  useEffect(() => {
    if (!editing) return;
    const onKey = (e) => e.key === "Escape" && setEditing(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);

  // --- copy today's agenda ---------------------------------------------
  function copyAgenda() {
    const text = todayAgendaText(tasks, new Date());
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }
  function fallbackCopy(text, done) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      done();
    } catch {
      /* clipboard unavailable */
    }
  }

  const todayStr = now.toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });

  function groupHead(key, label, count) {
    const isCollapsed = !!collapsed[key];
    return (
      <div className={`group-head group-${key} ${isCollapsed ? "collapsed" : ""}`}
        role="button" tabIndex={0} aria-expanded={!isCollapsed}
        onClick={() => toggleCollapse(key)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleCollapse(key);
          }
        }}>
        <span className="label">{label}</span>
        <span className="count">{count}</span>
        <span className="rule" />
        <span className="chev"><Chevron /></span>
      </div>
    );
  }

  function renderTask(t) {
    const s = statusOf(t, now);
    const noteOpen = openNote === t.id;
    const rep = repeatLabel(t);
    return (
      <article key={t.id} className={`task s-${s}`}>
        <button className={`toggle ${isDone(t, now) ? "checked" : ""}`}
          onClick={() => toggleDone(t.id)}
          aria-label={isDone(t, now) ? "Mark as not done" : "Mark as done"}
          aria-pressed={isDone(t, now)}>
          <Check />
        </button>
        <div className="task-body">
          <div className="task-title">{t.title}</div>
          <div className="task-meta">
            <span className="deadline">{relativeLabel(t, now)}</span>
            {rep && <span className="repeat-cap"><Repeat />{rep}</span>}
            <button className={`note-btn ${t.note ? "has-note" : ""}`}
              onClick={() => setOpenNote(noteOpen ? null : t.id)}>
              <NoteIcon />{t.note ? "Note" : "Add note"}
            </button>
          </div>
          {noteOpen ? (
            <div className="note-area">
              <textarea autoFocus
                placeholder="How did it go? Blockers, follow-ups, anything to remember…"
                value={t.note}
                onChange={(e) => updateNote(t.id, e.target.value)}
                onBlur={() => setOpenNote(null)} />
            </div>
          ) : (
            t.note && <div className="note-preview">{t.note}</div>
          )}
        </div>
        <div className="task-actions">
          <button className="edit-btn" onClick={() => openEdit(t)}
            aria-label="Edit activity">
            <Pencil />
          </button>
          <button className="del-btn" onClick={() => setConfirmDelete(t)}
            aria-label="Delete activity">
            <Trash />
          </button>
        </div>
      </article>
    );
  }

  return (
    <div className="shell">
      <header className={`masthead ${stuck ? "stuck" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><span className="m-j">J</span><span className="m-k">K</span></div>
          <div className="brand-text">
            <h1>JhunKeeper</h1>
            <div className="today">{todayStr}</div>
          </div>
        </div>
        <div className="readouts">
          <div className="readout is-overdue">
            <span className="num">{summary.overdue}</span>
            <span className="cap">Overdue</span>
          </div>
          <div className="readout is-pending">
            <span className="num">{summary.pending}</span>
            <span className="cap">To do</span>
          </div>
          <div className="readout is-done">
            <span className="num">{summary.done}</span>
            <span className="cap">Done</span>
          </div>
        </div>
      </header>

      {todayAllCount > 0 && (
        <div className="agenda-bar">
          {copied && <span className="agenda-ok">Copied ✓</span>}
          <button className="agenda-btn" onClick={copyAgenda}>
            <Copy />Copy today's agenda
          </button>
        </div>
      )}

      <div className="composer">
        <textarea ref={titleRef} className="title-input" rows={1}
          placeholder="What needs doing?"
          value={title}
          onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTask();
            }
          }}
          aria-label="Activity" />

        <div className="composer-controls">
          {repeatMode === "once" && (
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)}
              aria-label="Due date" />
          )}
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
            aria-label="Time (optional)" />
          <select className="repeat-select" value={repeatMode}
            onChange={(e) => setRepeatMode(e.target.value)} aria-label="Repeat">
            <option value="once">Once</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
          <div className="composer-actions">
            {composerDirty && (
              <button className="clear-composer" onClick={clearComposer}>
                Clear
              </button>
            )}
            <button className="add-btn" onClick={addTask}>Add</button>
          </div>
        </div>

        {repeatMode === "weekly" && (
          <div className="weekday-pills" role="group" aria-label="Repeat on">
            {WEEKDAYS.map(({ lbl, val }) => (
              <button key={val}
                className={`wpill ${weeklyDays.includes(val) ? "on" : ""}`}
                onClick={() => toggleWeekday(val)}
                aria-pressed={weeklyDays.includes(val)}>
                {lbl}
              </button>
            ))}
          </div>
        )}
      </div>

      {tasks.length === 0 && (
        <div className="empty">
          <div className="big">Nothing on the board yet</div>
          <div>Add an activity above — set a due date, a time, or make it repeat.</div>
        </div>
      )}

      {tasks.length > 0 && (
        <div className="search">
          <SearchIcon />
          <input ref={searchRef} type="text" placeholder="Search activities and notes…"
            value={query} onChange={(e) => setQuery(e.target.value)}
            aria-label="Search activities" />
          {query && (
            <button className="search-clear" onClick={() => setQuery("")}
              aria-label="Clear search">✕</button>
          )}
        </div>
      )}

      {todayTasks.length > 0 && (
        <section>
          {groupHead("today", "Today", todayTasks.length)}
          {!collapsed.today && todayTasks.map(renderTask)}
        </section>
      )}

      {GROUPS.map(({ key, label }) => {
        const items = grouped[key];
        if (!items || items.length === 0) return null;
        const isCollapsed = !!collapsed[key];
        return (
          <section key={key}>
            {groupHead(key, label, items.length)}
            {!isCollapsed &&
              (key === "upcoming"
                ? groupUpcoming(items, now).map((bucket) => (
                    <div key={bucket.label}>
                      <div className="subhead">
                        <span className="slabel">{bucket.label}</span>
                        <span className="scount">{bucket.items.length}</span>
                        <span className="srule" />
                      </div>
                      {bucket.items.map(renderTask)}
                    </div>
                  ))
                : items.map(renderTask))}
          </section>
        );
      })}

      {tasks.length > 0 && q && visibleCount === 0 && (
        <div className="empty">
          <div className="big">No matches</div>
          <div>Nothing matches “{query.trim()}”.</div>
        </div>
      )}

      {tasks.length > 0 && (
        <div className="board-foot">
          <span>
            {summary.total} {summary.total === 1 ? "activity" : "activities"} on
            the board · saved on this device
          </span>
          {clearableCount > 0 && (
            <button className="clear-done" onClick={clearDone}>
              Clear {clearableCount} done
            </button>
          )}
        </div>
      )}
      {editing && (
        <div className="modal-overlay" onClick={cancelEdit}>
          <div className="modal" onClick={(e) => e.stopPropagation()}
            role="dialog" aria-modal="true" aria-label="Edit activity">
            <h2>Edit activity</h2>

            <div className="modal-field">
              <label className="modal-label">Title</label>
              <textarea ref={eTitleRef} className="modal-title" rows={1} value={eTitle} autoFocus
                onChange={(e) => setETitle(e.target.value.replace(/\n/g, " "))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveEdit();
                  }
                }} />
            </div>

            <div className="modal-field">
              <label className="modal-label">Schedule</label>
              <div className="row">
                {eRepeatMode === "once" && (
                  <input type="date" value={eDue}
                    onChange={(e) => setEDue(e.target.value)} aria-label="Due date" />
                )}
                <span className="time-wrap">
                  <input type="time" value={eTime}
                    onChange={(e) => setETime(e.target.value)} aria-label="Time" />
                  {eTime && (
                    <button type="button" className="time-clear"
                      onClick={() => setETime("")} aria-label="Remove time">
                      ✕
                    </button>
                  )}
                </span>
                <select className="repeat-select" value={eRepeatMode}
                  onChange={(e) => setERepeatMode(e.target.value)} aria-label="Repeat">
                  <option value="once">Once</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
              {eRepeatMode === "weekly" && (
                <div className="weekday-pills" role="group" aria-label="Repeat on">
                  {WEEKDAYS.map(({ lbl, val }) => (
                    <button key={val}
                      className={`wpill ${eWeeklyDays.includes(val) ? "on" : ""}`}
                      onClick={() => toggleEditWeekday(val)}
                      aria-pressed={eWeeklyDays.includes(val)}>
                      {lbl}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="modal-field">
              <label className="modal-label">Note</label>
              <textarea value={eNote} onChange={(e) => setENote(e.target.value)}
                placeholder="How did it go? Blockers, follow-ups, anything to remember…" />
            </div>

            <div className="modal-actions">
              <button className="btn-ghost" onClick={cancelEdit}>Cancel</button>
              <button className="add-btn" onClick={saveEdit}>Save</button>
            </div>
          </div>
        </div>
      )}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal modal-confirm" onClick={(e) => e.stopPropagation()}
            role="alertdialog" aria-modal="true" aria-label="Delete activity">
            <h2>Delete activity</h2>
            <p className="confirm-text">Are you sure you want to delete this activity?</p>
            <div className="confirm-title">“{confirmDelete.title}”</div>
            <p className="confirm-note">This action cannot be undone.</p>
            <div className="modal-actions">
              <button className="btn-ghost" autoFocus
                onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn-danger" onClick={doConfirmDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}

      <AssistiveTouchProvider
        badgeCount={summary.overdue}
        onQuickAdd={() => {
          window.scrollTo({ top: 0, behavior: "smooth" });
          setTimeout(() => titleRef.current && titleRef.current.focus(), 60);
        }}
        onCopyAgenda={copyAgenda}
        onSearch={() => {
          if (searchRef.current) {
            searchRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
            setTimeout(() => searchRef.current && searchRef.current.focus(), 60);
          }
        }}
        onSettings={() => {}}
      />
    </div>
  );
}
