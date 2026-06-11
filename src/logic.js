// ---------------------------------------------------------------------------
// Pure logic for the schedule board. No React, no DOM — testable in Node.
//
// Two kinds of task:
//   one-off   -> repeat: null,  completion via `done` (bool)
//   recurring -> repeat: 'daily' | { weekly: [0..6] },
//                completion via `lastDone` ('YYYY-MM-DD' of the done occurrence)
//
// Dates compare CALENDAR-DATE only (local time). Recurring tasks always look
// forward from today, so they never pile up as "overdue" — a missed occurrence
// simply rolls to the next one.
// ---------------------------------------------------------------------------

export function startOfDay(d) {
  const dt = typeof d === "string" ? parseDateInput(d) : new Date(d);
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

export function parseDateInput(value) {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const fallback = new Date(value);
  return isNaN(fallback) ? null : fallback;
}

// Local 'YYYY-MM-DD' from a Date.
export function fmtISO(date) {
  const d = startOfDay(date);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

export function dayDiff(due, now = new Date()) {
  if (!due) return null;
  const a = startOfDay(due).getTime();
  const b = startOfDay(now).getTime();
  return Math.round((a - b) / 86400000);
}

// --- recurrence ----------------------------------------------------------

// Soonest date on/after today whose weekday is in `days` (0=Sun..6=Sat).
function nextWeekly(days, now) {
  const today = startOfDay(now);
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    if (days.includes(d.getDay())) return d;
  }
  return today; // empty days -> fall back to today
}

// Current/next occurrence Date for a recurring task. Null for one-offs.
export function occurrenceDate(task, now = new Date()) {
  if (!task.repeat) return null;
  if (task.repeat === "daily") return startOfDay(now);
  if (task.repeat.weekly && task.repeat.weekly.length)
    return nextWeekly(task.repeat.weekly, now);
  return startOfDay(now);
}

// The date that drives status/label/sort: due for one-offs, occurrence for
// recurring. Returns a Date or null.
export function effectiveDue(task, now = new Date()) {
  if (task.repeat) return occurrenceDate(task, now);
  return task.due ? startOfDay(task.due) : null;
}

// Is the task complete for the relevant cycle?
export function isDone(task, now = new Date()) {
  if (task.repeat)
    return !!task.lastDone && task.lastDone === fmtISO(occurrenceDate(task, now));
  return !!task.done;
}

// --- status / labels -----------------------------------------------------

// 'done' | 'overdue' | 'soon' | 'upcoming' | 'anytime'
export function statusOf(task, now = new Date()) {
  if (isDone(task, now)) return "done";
  const d = effectiveDue(task, now);
  if (!d) return "anytime";
  const diff = dayDiff(d, now);
  if (diff < 0) return "overdue"; // only reachable by one-offs
  if (diff <= 2) return "soon";
  return "upcoming";
}

export function formatTime(t) {
  if (!t) return "";
  const [hh, mm] = t.split(":").map(Number);
  const ampm = hh < 12 ? "AM" : "PM";
  let h = hh % 12;
  if (h === 0) h = 12;
  return `${h}:${String(mm).padStart(2, "0")} ${ampm}`;
}

export function formatDate(due) {
  return startOfDay(due).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// Plain-language deadline — the signature. Appends time when present.
export function relativeLabel(task, now = new Date()) {
  const time = task.time ? " · " + formatTime(task.time) : "";
  if (isDone(task, now)) return "Done";
  const d = effectiveDue(task, now);
  if (!d) return "No date" + time;
  const diff = dayDiff(d, now);
  let base;
  if (diff < 0) {
    const n = Math.abs(diff);
    base = n === 1 ? "1 day overdue" : `${n} days overdue`;
  } else if (diff === 0) base = "Due today";
  else if (diff === 1) base = "Due tomorrow";
  else if (diff <= 7) base = `Due in ${diff} days`;
  else base = "Due " + formatDate(d);
  return base + time;
}

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Caption describing the repeat rule, e.g. "Every day", "Repeats Mon, Wed".
export function repeatLabel(task) {
  if (!task.repeat) return "";
  if (task.repeat === "daily") return "Every day";
  const days = [...(task.repeat.weekly || [])].sort((a, b) => a - b);
  if (days.length === 7) return "Every day";
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d)))
    return "Weekdays";
  if (days.length === 2 && days.includes(0) && days.includes(6))
    return "Weekends";
  return "Repeats " + days.map((d) => DAY_SHORT[d]).join(", ");
}

// --- summary / sort ------------------------------------------------------

export function summarize(tasks, now = new Date()) {
  let overdue = 0,
    pending = 0,
    done = 0;
  for (const t of tasks) {
    const s = statusOf(t, now);
    if (s === "done") done++;
    else if (s === "overdue") overdue++;
    else pending++;
  }
  return { overdue, pending, done, total: tasks.length };
}

const RANK = { overdue: 0, soon: 1, upcoming: 2, anytime: 3, done: 4 };

// Sort value: day timestamp + time-of-day so same-day tasks order by clock.
function dueSortValue(task, now) {
  const d = effectiveDue(task, now);
  if (!d) return Infinity;
  let v = startOfDay(d).getTime();
  if (task.time) {
    const [h, m] = task.time.split(":").map(Number);
    v += (h * 60 + m) * 60000;
  }
  return v;
}

export function sortTasks(tasks, now = new Date()) {
  const copy = [...tasks];
  copy.sort((a, b) => {
    const ra = RANK[statusOf(a, now)];
    const rb = RANK[statusOf(b, now)];
    if (ra !== rb) return ra - rb;

    if (ra === RANK.done) return dueSortValue(b, now) - dueSortValue(a, now);
    if (ra === RANK.anytime) return (b.createdAt || 0) - (a.createdAt || 0);
    return dueSortValue(a, now) - dueSortValue(b, now);
  });
  return copy;
}

// --- upcoming date dividers ---------------------------------------------
// Splits the Upcoming group into readable time buckets:
//   This week -> Next week -> Later this month -> month names (with year if
//   not the current year). Weeks start Monday; "this week" ends the coming Sun.
export function upcomingBucket(date, now = new Date()) {
  const D = startOfDay(date);
  const T = startOfDay(now);
  const daysToSunday = (7 - T.getDay()) % 7; // 0 if today is Sunday
  const endThisWeek = new Date(T);
  endThisWeek.setDate(T.getDate() + daysToSunday);
  const endNextWeek = new Date(endThisWeek);
  endNextWeek.setDate(endThisWeek.getDate() + 7);

  if (D <= endThisWeek) return { order: -2, label: "This week" };
  if (D <= endNextWeek) return { order: -1, label: "Next week" };

  const monthOffset =
    (D.getFullYear() - T.getFullYear()) * 12 + (D.getMonth() - T.getMonth());
  if (monthOffset === 0) return { order: 0, label: "Later this month" };

  const monthName = D.toLocaleDateString(undefined, { month: "long" });
  const label =
    D.getFullYear() === T.getFullYear()
      ? monthName
      : `${monthName} ${D.getFullYear()}`;
  return { order: monthOffset, label };
}

// Group an already-sorted list of upcoming tasks into ordered buckets.
export function groupUpcoming(items, now = new Date()) {
  const map = new Map();
  for (const t of items) {
    const b = upcomingBucket(effectiveDue(t, now), now);
    if (!map.has(b.label))
      map.set(b.label, { order: b.order, label: b.label, items: [] });
    map.get(b.label).items.push(t);
  }
  return [...map.values()].sort((a, b) => a.order - b.order);
}

// --- today section -------------------------------------------------------
// A task belongs in "Today" if it's not done and its effective due date is
// today. This single rule covers one-offs due today, daily recurring, and
// weekly recurring scheduled for the current weekday (their occurrence == today).
export function isToday(task, now = new Date()) {
  if (isDone(task, now)) return false;
  const d = effectiveDue(task, now);
  return !!d && dayDiff(d, now) === 0;
}

// Plain-text agenda of today's tasks for the clipboard.
export function todayAgendaText(tasks, now = new Date()) {
  const items = sortTasks(tasks.filter((t) => isToday(t, now)), now);
  const lines = items.map(
    (t) => "\u25A1 " + t.title + (t.time ? " \u00B7 " + formatTime(t.time) : "")
  );
  return "TODAY\n" + (lines.length ? lines.join("\n") : "(nothing scheduled)");
}
