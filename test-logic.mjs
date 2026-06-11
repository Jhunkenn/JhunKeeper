import {
  dayDiff, statusOf, relativeLabel, summarize, sortTasks,
  fmtISO, occurrenceDate, isDone, formatTime, repeatLabel,
} from "./src/logic.js";

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  => ${JSON.stringify(got)}`);
  if (ok) pass++; else { fail++; console.log(`      expected ${JSON.stringify(want)}`); }
}

const NOW = new Date(2026, 5, 11, 14, 30); // Thu Jun 11 2026, 2:30pm
const W = NOW.getDay();                     // today's weekday
const wd = (offset) => (W + offset + 7) % 7; // weekday `offset` days from today
const isoOffset = (n) => { const d = new Date(NOW); d.setDate(d.getDate()+n); return fmtISO(d); };

// ===== one-off (regression) =====
eq("dayDiff today", dayDiff("2026-06-11", NOW), 0);
eq("dayDiff yesterday", dayDiff("2026-06-10", NOW), -1);
eq("status overdue", statusOf({ due: "2026-06-09" }, NOW), "overdue");
eq("status today=soon", statusOf({ due: "2026-06-11" }, NOW), "soon");
eq("status upcoming", statusOf({ due: "2026-06-20" }, NOW), "upcoming");
eq("status done wins", statusOf({ due: "2026-06-01", done: true }, NOW), "done");
eq("status no-date", statusOf({ due: null }, NOW), "anytime");
eq("label 3 overdue", relativeLabel({ due: "2026-06-08" }, NOW), "3 days overdue");
eq("label in 5", relativeLabel({ due: "2026-06-16" }, NOW), "Due in 5 days");

// ===== time =====
eq("time 6:30pm", formatTime("18:30"), "6:30 PM");
eq("time midnight", formatTime("00:00"), "12:00 AM");
eq("time noon", formatTime("12:00"), "12:00 PM");
eq("time 9:05am", formatTime("09:05"), "9:05 AM");
eq("label with time", relativeLabel({ due: "2026-06-11", time: "18:00" }, NOW), "Due today · 6:00 PM");

// ===== recurring: daily =====
const daily = { repeat: "daily", title: "Stretch" };
eq("daily occ = today", fmtISO(occurrenceDate(daily, NOW)), isoOffset(0));
eq("daily status soon", statusOf(daily, NOW), "soon");
eq("daily label", relativeLabel(daily, NOW), "Due today");
const dailyDone = { repeat: "daily", lastDone: isoOffset(0) };
eq("daily done today", isDone(dailyDone, NOW), true);
eq("daily done status", statusOf(dailyDone, NOW), "done");
const dailyStale = { repeat: "daily", lastDone: isoOffset(-1) }; // done yesterday
eq("daily resets next day", isDone(dailyStale, NOW), false);
eq("daily stale is due again", statusOf(dailyStale, NOW), "soon");

// ===== recurring: weekly =====
const wToday = { repeat: { weekly: [wd(0)] } };   // on today's weekday
const wTomorrow = { repeat: { weekly: [wd(1)] } }; // tomorrow's weekday
const wIn3 = { repeat: { weekly: [wd(3)] } };      // 3 days out
const wYesterday = { repeat: { weekly: [wd(-1)] } }; // weekday that was yesterday

eq("weekly today due today", relativeLabel(wToday, NOW), "Due today");
eq("weekly today status", statusOf(wToday, NOW), "soon");
eq("weekly tomorrow", relativeLabel(wTomorrow, NOW), "Due tomorrow");
eq("weekly in 3", relativeLabel(wIn3, NOW), "Due in 3 days");
eq("weekly in 3 upcoming", statusOf(wIn3, NOW), "upcoming");
// KEY: a weekday that already passed this week rolls forward, NOT overdue
eq("weekly missed rolls fwd", statusOf(wYesterday, NOW), "upcoming");
eq("weekly missed label", relativeLabel(wYesterday, NOW), "Due in 6 days");

// weekly completion this cycle
const wDone = { repeat: { weekly: [wd(0)] }, lastDone: isoOffset(0) };
eq("weekly done today", isDone(wDone, NOW), true);
eq("weekly done status", statusOf(wDone, NOW), "done");
// completing tomorrow's task today should NOT mark it done (wrong occurrence)
const wTomorrowStale = { repeat: { weekly: [wd(1)] }, lastDone: isoOffset(0) };
eq("weekly wrong-cycle not done", isDone(wTomorrowStale, NOW), false);

// ===== repeat labels =====
eq("repeat daily label", repeatLabel({ repeat: "daily" }), "Every day");
eq("repeat weekdays", repeatLabel({ repeat: { weekly: [1,2,3,4,5] } }), "Weekdays");
eq("repeat weekends", repeatLabel({ repeat: { weekly: [0,6] } }), "Weekends");
eq("repeat mon wed fri", repeatLabel({ repeat: { weekly: [1,3,5] } }), "Repeats Mon, Wed, Fri");
eq("repeat none", repeatLabel({ repeat: null }), "");

// ===== summary with mixed =====
const mixed = [
  { id:1, due:"2026-06-08", done:false },        // overdue
  { id:2, repeat:"daily" },                       // soon -> pending
  { id:3, repeat:{weekly:[wd(0)]}, lastDone:isoOffset(0) }, // done
  { id:4, due:"2026-06-20", done:false },         // upcoming -> pending
];
eq("mixed summary", summarize(mixed, NOW), { overdue:1, pending:2, done:1, total:4 });

// ===== same-day time sort =====
const sameDay = [
  { id:"pm", due:"2026-06-11", time:"18:00" },
  { id:"am", due:"2026-06-11", time:"08:00" },
  { id:"none", due:"2026-06-11" },
];
eq("time sort within day", sortTasks(sameDay, NOW).map(t=>t.id), ["none","am","pm"]);



// ===== upcoming date dividers =====
import { upcomingBucket, groupUpcoming } from "./src/logic.js";
// NOW = Thu Jun 11 2026 -> endThisWeek=Jun14(Sun), endNextWeek=Jun21
eq("bucket this week", upcomingBucket("2026-06-14", NOW).label, "This week");
eq("bucket next week", upcomingBucket("2026-06-15", NOW).label, "Next week");
eq("bucket next week end", upcomingBucket("2026-06-21", NOW).label, "Next week");
eq("bucket later this month", upcomingBucket("2026-06-25", NOW).label, "Later this month");
eq("bucket july", upcomingBucket("2026-07-03", NOW).label, "July");
eq("bucket august", upcomingBucket("2026-08-10", NOW).label, "August");
eq("bucket jan next yr", upcomingBucket("2027-01-05", NOW).label, "January 2027");

const up = [
  { id:"a", due:"2026-08-10" },
  { id:"b", due:"2026-06-14" },
  { id:"c", due:"2026-07-03" },
  { id:"d", due:"2026-06-25" },
  { id:"e", due:"2026-06-18" },
];
const groups = groupUpcoming(up, NOW).map(g => g.label);
eq("upcoming groups ordered", groups, ["This week","Next week","Later this month","July","August"]);

console.log(`\n(divider tests included above)`);



// ===== today section + agenda =====
import { isToday, todayAgendaText } from "./src/logic.js";
eq("today: one-off due today", isToday({ due: "2026-06-11" }, NOW), true);
eq("today: daily", isToday({ repeat: "daily" }, NOW), true);
eq("today: weekly on today", isToday({ repeat: { weekly: [wd(0)] } }, NOW), true);
eq("today: weekly other day", isToday({ repeat: { weekly: [wd(2)] } }, NOW), false);
eq("today: due tomorrow not today", isToday({ due: "2026-06-12" }, NOW), false);
eq("today: overdue not today", isToday({ due: "2026-06-09" }, NOW), false);
eq("today: done excluded", isToday({ due: "2026-06-11", done: true }, NOW), false);
eq("today: daily done-today excluded", isToday({ repeat: "daily", lastDone: isoOffset(0) }, NOW), false);
eq("today: anytime excluded", isToday({ due: null }, NOW), false);

const agendaTasks = [
  { id: 1, title: "Sprint stand-up", due: "2026-06-11", time: "09:30" },
  { id: 2, title: "Morning stretch", repeat: "daily", time: "07:00" },
  { id: 3, title: "Email report", due: "2026-06-11" },
  { id: 4, title: "Tomorrow thing", due: "2026-06-12" },
];
eq("agenda text", todayAgendaText(agendaTasks, NOW),
  "TODAY\n\u25A1 Email report\n\u25A1 Morning stretch \u00B7 7:00 AM\n\u25A1 Sprint stand-up \u00B7 9:30 AM");
eq("agenda empty", todayAgendaText([{ id: 9, due: "2026-06-20" }], NOW), "TODAY\n(nothing scheduled)");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
