import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { fbSet, fbListen, onAuthReady } from "./firebase.js";
import "./kids-nutrition.css";

const KIDS = [
  { id: "maddie", name: "Maddie", emoji: "\u{1F338}", color: "#e879a8" },
  { id: "max", name: "Max", emoji: "\u26A1", color: "#60a5fa" },
];

const CALORIE_TARGET = 1200;
const PROTEIN_TARGET = 50;

const QUICK_FOODS = [
  { name: "Glass of Milk", cal: 150, protein: 8, icon: "\u{1F95B}" },
  { name: "PB Sandwich", cal: 350, protein: 12, icon: "\u{1F96A}" },
  { name: "Tri-Color Pasta", cal: 220, protein: 8, icon: "\u{1F35D}" },
  { name: "Pepperoni Pizza", cal: 300, protein: 13, icon: "\u{1F355}" },
  { name: "Strawberries (5)", cal: 20, protein: 1, icon: "\u{1F353}" },
  { name: "Apple", cal: 95, protein: 0, icon: "\u{1F34E}" },
  { name: "Cucumber", cal: 16, protein: 1, icon: "\u{1F952}" },
  { name: "Chobani Flip", cal: 190, protein: 12, icon: "\u{1F95B}" },
  { name: "Orange Juice", cal: 110, protein: 2, icon: "\u{1F34A}" },
];

const TIPS = [
  { min: 0, max: 300, tip: "Still early \u2014 a good breakfast sets the tone. Try eggs or yogurt for protein!" },
  { min: 300, max: 600, tip: "Good start! Aim for protein at lunch to keep energy steady." },
  { min: 600, max: 900, tip: "Halfway there! A glass of milk is a great afternoon boost." },
  { min: 900, max: 1100, tip: "Almost at goal! A light snack should round things out." },
  { min: 1100, max: 1200, tip: "Right on track! Just a small snack away from the daily goal." },
  { min: 1200, max: 9999, tip: "Daily calorie goal reached! Great job fueling up today." },
];

const PROTEIN_TIPS = [
  { min: 0, max: 15, tip: "Protein is low \u2014 try milk, yogurt, eggs, or cheese to catch up." },
  { min: 15, max: 30, tip: "Getting some protein in. A Chobani Flip or PB sandwich would help." },
  { min: 30, max: 45, tip: "Protein looking decent! One more serving should hit the goal." },
  { min: 45, max: 9999, tip: "Protein goal is on track \u2014 nice work!" },
];

const LS_KEY = "kids-fuel-data";
const DEBOUNCE_MS = 400;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function getDayLabel(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

// ─── Main Component ──────────────────────────────────────
export default function KidsNutrition() {
  const [data, setData] = useState({});
  const [activeKid, setActiveKid] = useState("maddie");
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [showAdd, setShowAdd] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customCal, setCustomCal] = useState("");
  const [customProtein, setCustomProtein] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState(null);
  const [toast, setToast] = useState(null);
  const [syncStatus, setSyncStatus] = useState("\u2026");
  const [activeView, setActiveView] = useState("log"); // "log" or "trends"
  const saveTimer = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setData(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    onAuthReady(() => {
      setSyncStatus("ok");
      fbListen((val) => {
        setData(val);
        try { localStorage.setItem(LS_KEY, JSON.stringify(val)); } catch {}
      });
    });
  }, []);

  const persist = useCallback((newData) => {
    setData(newData);
    try { localStorage.setItem(LS_KEY, JSON.stringify(newData)); } catch {}
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => fbSet(newData), DEBOUNCE_MS);
  }, []);

  const entries = useMemo(() => {
    return data?.[activeKid]?.[selectedDate]?.entries || [];
  }, [data, activeKid, selectedDate]);

  const totals = useMemo(() => {
    return entries.reduce(
      (acc, e) => ({ cal: acc.cal + (e.cal || 0), protein: acc.protein + (e.protein || 0) }),
      { cal: 0, protein: 0 }
    );
  }, [entries]);

  const calPct = Math.min(100, Math.round((totals.cal / CALORIE_TARGET) * 100));
  const protPct = Math.min(100, Math.round((totals.protein / PROTEIN_TARGET) * 100));

  const addEntry = useCallback((name, cal, protein) => {
    const entry = { id: uid(), name, cal: Number(cal), protein: Number(protein), time: Date.now() };
    const newData = { ...data };
    if (!newData[activeKid]) newData[activeKid] = {};
    if (!newData[activeKid][selectedDate]) newData[activeKid][selectedDate] = { entries: [] };
    newData[activeKid][selectedDate] = {
      entries: [...(newData[activeKid][selectedDate].entries || []), entry],
    };
    persist(newData);
    showToast(`+${cal} cal logged for ${KIDS.find(k => k.id === activeKid).name}`);
  }, [data, activeKid, selectedDate, persist, showToast]);

  const removeEntry = useCallback((entryId) => {
    const newData = { ...data };
    const dayData = newData[activeKid]?.[selectedDate];
    if (!dayData) return;
    newData[activeKid][selectedDate] = {
      entries: dayData.entries.filter((e) => e.id !== entryId),
    };
    persist(newData);
  }, [data, activeKid, selectedDate, persist]);

  // Smart calorie lookup
  const lookupFood = async () => {
    if (!customName.trim()) return;
    setLookupLoading(true);
    setLookupResult(null);
    try {
      const res = await fetch("/api/calories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ food: customName.trim() }),
      });
      if (!res.ok) throw new Error("lookup failed");
      const result = await res.json();
      setLookupResult(result);
      setCustomCal(String(result.cal));
      setCustomProtein(String(result.protein));
    } catch {
      setLookupResult({ error: true });
    }
    setLookupLoading(false);
  };

  const handleCustomAdd = () => {
    if (!customName || !customCal) return;
    addEntry(customName, customCal, customProtein || 0);
    setCustomName("");
    setCustomCal("");
    setCustomProtein("");
    setLookupResult(null);
    setShowAdd(false);
  };

  const navigateDate = (offset) => {
    const d = new Date(selectedDate + "T12:00:00");
    d.setDate(d.getDate() + offset);
    setSelectedDate(d.toISOString().slice(0, 10));
  };

  const isToday = selectedDate === todayKey();
  const kid = KIDS.find((k) => k.id === activeKid);

  // Recent custom foods (last 7 days, deduplicated)
  const recentFoods = useMemo(() => {
    const seen = new Set();
    const foods = [];
    const kidData = data?.[activeKid] || {};
    const dates = Object.keys(kidData).sort().reverse().slice(0, 7);
    for (const d of dates) {
      for (const e of kidData[d]?.entries || []) {
        const key = `${e.name}-${e.cal}-${e.protein}`;
        if (!seen.has(key) && !QUICK_FOODS.some(q => q.name === e.name)) {
          seen.add(key);
          foods.push({ name: e.name, cal: e.cal, protein: e.protein });
        }
      }
    }
    return foods.slice(0, 6);
  }, [data, activeKid]);

  // 7-day trend data
  const trendData = useMemo(() => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const dayEntries = data?.[activeKid]?.[key]?.entries || [];
      const dayCal = dayEntries.reduce((sum, e) => sum + (e.cal || 0), 0);
      const dayProt = dayEntries.reduce((sum, e) => sum + (e.protein || 0), 0);
      days.push({ date: key, label: getDayLabel(key), cal: dayCal, protein: dayProt, count: dayEntries.length });
    }
    return days;
  }, [data, activeKid]);

  const maxTrendCal = Math.max(CALORIE_TARGET, ...trendData.map(d => d.cal));

  // Current tip
  const calTip = TIPS.find(t => totals.cal >= t.min && totals.cal < t.max)?.tip || "";
  const protTip = PROTEIN_TIPS.find(t => totals.protein >= t.min && totals.protein < t.max)?.tip || "";

  return (
    <div className="kn-app">
      {/* Header */}
      <div className="kn-header">
        <div className="kn-title">
          <span className="kn-logo">{"\u{1F34E}"}</span>
          <span>Kids Fuel</span>
        </div>
        <span className={`kn-sync ${syncStatus === "ok" ? "ok" : ""}`}>
          {syncStatus === "ok" ? "\u2713 Synced" : "\u2026"}
        </span>
      </div>

      {/* Kid Tabs */}
      <div className="kn-kid-tabs">
        {KIDS.map((k) => (
          <button
            key={k.id}
            className={`kn-kid-tab ${activeKid === k.id ? "active" : ""}`}
            style={activeKid === k.id ? { borderColor: k.color, color: k.color } : {}}
            onClick={() => setActiveKid(k.id)}
          >
            <span className="kn-kid-emoji">{k.emoji}</span>
            {k.name}
          </button>
        ))}
      </div>

      {/* Date Navigator */}
      <div className="kn-date-nav">
        <button className="kn-date-btn" onClick={() => navigateDate(-1)}>{"\u2039"}</button>
        <span className="kn-date-label">
          {isToday ? "Today" : new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
        </span>
        <button className="kn-date-btn" onClick={() => navigateDate(1)} disabled={isToday}>{"\u203A"}</button>
      </div>

      {/* Progress Rings */}
      <div className="kn-progress-section">
        <div className="kn-ring-container">
          <div className="kn-ring">
            <svg viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="52" fill="none" stroke="#1e293b" strokeWidth="10" />
              <circle
                cx="60" cy="60" r="52" fill="none"
                stroke={calPct >= 100 ? "#22c55e" : kid.color}
                strokeWidth="10"
                strokeDasharray={`${calPct * 3.267} 326.7`}
                strokeLinecap="round"
                transform="rotate(-90 60 60)"
                style={{ transition: "stroke-dasharray 0.4s ease" }}
              />
            </svg>
            <div className="kn-ring-text">
              <div className="kn-ring-value">{totals.cal}</div>
              <div className="kn-ring-label">/ {CALORIE_TARGET} cal</div>
            </div>
          </div>
          <div className="kn-ring-title">Calories</div>
        </div>

        <div className="kn-ring-container">
          <div className="kn-ring">
            <svg viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="52" fill="none" stroke="#1e293b" strokeWidth="10" />
              <circle
                cx="60" cy="60" r="52" fill="none"
                stroke={protPct >= 100 ? "#22c55e" : "#f59e0b"}
                strokeWidth="10"
                strokeDasharray={`${protPct * 3.267} 326.7`}
                strokeLinecap="round"
                transform="rotate(-90 60 60)"
                style={{ transition: "stroke-dasharray 0.4s ease" }}
              />
            </svg>
            <div className="kn-ring-text">
              <div className="kn-ring-value">{totals.protein}g</div>
              <div className="kn-ring-label">/ {PROTEIN_TARGET}g protein</div>
            </div>
          </div>
          <div className="kn-ring-title">Protein</div>
        </div>
      </div>

      {/* Tip */}
      <div className="kn-tip">
        <span className="kn-tip-icon">{"\u{1F4A1}"}</span>
        <span>{calPct < 100 ? calTip : protPct < 100 ? protTip : calTip}</span>
      </div>

      {/* View Toggle */}
      <div className="kn-view-toggle">
        <button className={`kn-view-btn ${activeView === "log" ? "active" : ""}`} onClick={() => setActiveView("log")}>
          Log
        </button>
        <button className={`kn-view-btn ${activeView === "trends" ? "active" : ""}`} onClick={() => setActiveView("trends")}>
          Trends
        </button>
      </div>

      {activeView === "log" ? (
        <>
          {/* Quick Add */}
          <div className="kn-section">
            <div className="kn-section-title">Quick Add</div>
            <div className="kn-quick-grid">
              {QUICK_FOODS.map((food) => (
                <button
                  key={food.name}
                  className="kn-quick-btn"
                  onClick={() => addEntry(food.name, food.cal, food.protein)}
                >
                  <span className="kn-quick-icon">{food.icon}</span>
                  <span className="kn-quick-name">{food.name}</span>
                  <span className="kn-quick-cal">{food.cal} cal</span>
                </button>
              ))}
            </div>

            {recentFoods.length > 0 && (
              <>
                <div className="kn-section-title" style={{ marginTop: 16 }}>Recent</div>
                <div className="kn-quick-grid">
                  {recentFoods.map((food, i) => (
                    <button
                      key={i}
                      className="kn-quick-btn recent"
                      onClick={() => addEntry(food.name, food.cal, food.protein)}
                    >
                      <span className="kn-quick-icon">{"\u{1F504}"}</span>
                      <span className="kn-quick-name">{food.name}</span>
                      <span className="kn-quick-cal">{food.cal} cal</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Smart Add */}
            <button className="kn-custom-toggle" onClick={() => { setShowAdd(!showAdd); setLookupResult(null); }}>
              {showAdd ? "Cancel" : "+ Add Food (auto-calc calories)"}
            </button>

            {showAdd && (
              <div className="kn-custom-form">
                <div className="kn-lookup-row">
                  <input
                    className="kn-input"
                    placeholder='Type food (e.g. "PB sandwich")'
                    value={customName}
                    onChange={(e) => { setCustomName(e.target.value); setLookupResult(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") lookupFood(); }}
                    autoFocus
                  />
                  <button
                    className="kn-lookup-btn"
                    onClick={lookupFood}
                    disabled={lookupLoading || !customName.trim()}
                    style={{ background: kid.color }}
                  >
                    {lookupLoading ? "\u2026" : "\u{1F50D}"}
                  </button>
                </div>

                {lookupResult && !lookupResult.error && (
                  <div className="kn-lookup-result">
                    <span className="kn-lookup-check">{"\u2705"}</span>
                    <span>{lookupResult.name}: <strong>{lookupResult.cal} cal</strong>, {lookupResult.protein}g protein</span>
                    {lookupResult.serving && <span className="kn-lookup-serving">({lookupResult.serving})</span>}
                  </div>
                )}

                {lookupResult?.error && (
                  <div className="kn-lookup-result error">
                    Couldn't look up \u2014 enter manually below
                  </div>
                )}

                <div className="kn-input-row">
                  <input
                    className="kn-input"
                    type="number"
                    placeholder="Calories"
                    value={customCal}
                    onChange={(e) => setCustomCal(e.target.value)}
                  />
                  <input
                    className="kn-input"
                    type="number"
                    placeholder="Protein (g)"
                    value={customProtein}
                    onChange={(e) => setCustomProtein(e.target.value)}
                  />
                </div>
                <button
                  className="kn-add-btn"
                  style={{ background: kid.color }}
                  onClick={handleCustomAdd}
                  disabled={!customName || !customCal}
                >
                  Add to {kid.name}'s Log
                </button>
              </div>
            )}
          </div>

          {/* Food Log */}
          <div className="kn-section">
            <div className="kn-section-title">
              {isToday ? "Today's" : new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} Food Log
              <span className="kn-entry-count">{entries.length} items</span>
            </div>

            {entries.length === 0 ? (
              <div className="kn-empty">No food logged yet. Use quick add above!</div>
            ) : (
              <div className="kn-log">
                {[...entries].reverse().map((entry) => (
                  <div key={entry.id} className="kn-log-item">
                    <div className="kn-log-info">
                      <div className="kn-log-name">{entry.name}</div>
                      <div className="kn-log-meta">
                        {entry.cal} cal {"\u00B7"} {entry.protein}g protein {"\u00B7"} {formatTime(entry.time)}
                      </div>
                    </div>
                    <button className="kn-log-remove" onClick={() => removeEntry(entry.id)}>{"\u2715"}</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        /* Trends View */
        <div className="kn-section">
          <div className="kn-section-title">7-Day Calories</div>
          <div className="kn-trend-chart">
            {trendData.map((day) => (
              <div key={day.date} className="kn-trend-bar-wrap">
                <div className="kn-trend-val">{day.cal || ""}</div>
                <div className="kn-trend-bar-bg">
                  <div
                    className="kn-trend-bar-fill"
                    style={{
                      height: `${Math.max(2, (day.cal / maxTrendCal) * 100)}%`,
                      background: day.cal >= CALORIE_TARGET ? "#22c55e" : kid.color,
                      opacity: day.date === selectedDate ? 1 : 0.6,
                    }}
                  />
                  <div
                    className="kn-trend-target"
                    style={{ bottom: `${(CALORIE_TARGET / maxTrendCal) * 100}%` }}
                  />
                </div>
                <div className={`kn-trend-label ${day.date === todayKey() ? "today" : ""}`}>{day.label}</div>
              </div>
            ))}
          </div>

          <div className="kn-section-title" style={{ marginTop: 24 }}>7-Day Protein</div>
          <div className="kn-trend-chart">
            {trendData.map((day) => (
              <div key={day.date} className="kn-trend-bar-wrap">
                <div className="kn-trend-val">{day.protein ? `${day.protein}g` : ""}</div>
                <div className="kn-trend-bar-bg">
                  <div
                    className="kn-trend-bar-fill"
                    style={{
                      height: `${Math.max(2, (day.protein / Math.max(PROTEIN_TARGET, ...trendData.map(d => d.protein))) * 100)}%`,
                      background: day.protein >= PROTEIN_TARGET ? "#22c55e" : "#f59e0b",
                      opacity: day.date === selectedDate ? 1 : 0.6,
                    }}
                  />
                  <div
                    className="kn-trend-target"
                    style={{ bottom: `${(PROTEIN_TARGET / Math.max(PROTEIN_TARGET, ...trendData.map(d => d.protein))) * 100}%` }}
                  />
                </div>
                <div className={`kn-trend-label ${day.date === todayKey() ? "today" : ""}`}>{day.label}</div>
              </div>
            ))}
          </div>

          {/* Weekly Summary */}
          <div className="kn-weekly-summary">
            <div className="kn-section-title" style={{ marginTop: 24 }}>Weekly Summary</div>
            <div className="kn-summary-grid">
              <div className="kn-summary-card">
                <div className="kn-summary-value">{Math.round(trendData.reduce((s, d) => s + d.cal, 0) / 7)}</div>
                <div className="kn-summary-label">Avg Cal/Day</div>
              </div>
              <div className="kn-summary-card">
                <div className="kn-summary-value">{Math.round(trendData.reduce((s, d) => s + d.protein, 0) / 7)}g</div>
                <div className="kn-summary-label">Avg Protein/Day</div>
              </div>
              <div className="kn-summary-card">
                <div className="kn-summary-value">{trendData.filter(d => d.cal >= CALORIE_TARGET).length}/7</div>
                <div className="kn-summary-label">Days at Goal</div>
              </div>
              <div className="kn-summary-card">
                <div className="kn-summary-value">{trendData.reduce((s, d) => s + d.count, 0)}</div>
                <div className="kn-summary-label">Meals Logged</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="kn-toast">{toast}</div>}
    </div>
  );
}
