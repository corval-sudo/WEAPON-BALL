// web/src/pages/Dashboard.tsx
// Homepage: live arena (center), leaderboard (right), recent results (below).
// Fully responsive — stacks to single column on mobile.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useArenaSocket } from "../hooks/useArenaSocket";
import { ArenaCanvas } from "../components/ArenaCanvas";

const API = import.meta.env["VITE_API_URL"] ?? "http://localhost:3001";

interface Fighter {
  id: string; name: string; weaponId: string;
  wins: number; losses: number; currentStreak: number;
  baseHp: number; color: string;
}

interface RecentMatch {
  id: number; winner: string; ticks: number; timestamp: string;
  ball_a_name: string; ball_b_name: string;
  ball_a_weapon: string; ball_b_weapon: string;
  ball_a_damage_dealt: number; ball_b_damage_dealt: number;
}

interface NextMatchInfo {
  ballA: Fighter;
  ballB: Fighter;
  startsAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtCountdown(secs: number): string {
  if (secs <= 0) return "0s";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
}

function fmtWR(wins: number, losses: number): string {
  const total = wins + losses;
  return total > 0 ? `${Math.round((wins / total) * 100)}%` : "—";
}

function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const arena = useArenaSocket();
  const [fighters, setFighters]   = useState<Fighter[]>([]);
  const [matches, setMatches]     = useState<RecentMatch[]>([]);
  const [countdown, setCountdown] = useState(0);
  const [nextMatch, setNextMatch] = useState<NextMatchInfo | null>(null);

  // Initial data fetch
  useEffect(() => {
    fetch(`${API}/api/fighters`).then(r => r.json()).then(setFighters).catch(() => {});
    fetch(`${API}/api/matches`).then(r => r.json()).then(setMatches).catch(() => {});
    fetch(`${API}/api/next`).then(r => r.json()).then(setNextMatch).catch(() => {});
  }, []);

  // Refresh after each match result
  useEffect(() => {
    if (arena.phase !== "result") return;
    const t = setTimeout(() => {
      fetch(`${API}/api/matches`).then(r => r.json()).then(setMatches).catch(() => {});
      fetch(`${API}/api/fighters`).then(r => r.json()).then(setFighters).catch(() => {});
      fetch(`${API}/api/next`).then(r => r.json()).then(setNextMatch).catch(() => {});
    }, 2000);
    return () => clearTimeout(t);
  }, [arena.phase]);

  // Countdown — WebSocket takes priority, falls back to /api/next startsAt
  useEffect(() => {
    if (arena.phase === "countdown") {
      setCountdown(Math.ceil(arena.startsInMs / 1000));
      const t = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
      return () => clearInterval(t);
    }
    if ((arena.phase === "idle" || arena.phase === "result") && nextMatch?.startsAt) {
      const update = () => {
        const s = Math.max(0, Math.ceil((new Date(nextMatch.startsAt).getTime() - Date.now()) / 1000));
        setCountdown(s);
      };
      update();
      const t = setInterval(update, 1000);
      return () => clearInterval(t);
    }
  }, [arena.phase, arena.startsInMs, nextMatch?.startsAt]);

  // Fighters for canvas — WebSocket > /api/next fallback
  const ballA = arena.liveBallA ?? arena.resultBallA ?? arena.nextBallA ?? nextMatch?.ballA ?? null;
  const ballB = arena.liveBallB ?? arena.resultBallB ?? arena.nextBallB ?? nextMatch?.ballB ?? null;

  // Arena status label
  const arenaLabel =
    arena.phase === "live"      ? `⚔️ MATCH #${arena.matchNumber} — LIVE` :
    arena.phase === "countdown" ? `🔜 STARTING IN ${fmtCountdown(countdown)}` :
    arena.phase === "result"    ? `🏆 MATCH #${arena.matchNumber} RESULT` :
    countdown > 0               ? `🔜 NEXT MATCH IN ${fmtCountdown(countdown)}` :
    "🎯 WORBZ ARENA";

  return (
    <div style={S.page}>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <header style={S.topbar} className="worbz-topbar">
        <span style={S.logo}>⚔️ WORBZ</span>
        <span style={S.arenaLabel} className="worbz-arena-label">{arenaLabel}</span>
        <span style={S.liveChip}>
          <span style={{ ...S.dot, background: arena.connected ? "#4caf50" : "#f44336" }} />
          {arena.connected ? "LIVE" : "OFFLINE"}
        </span>
      </header>

      {/* ── Main grid: arena | leaderboard ──────────────────────────────── */}
      <div style={S.mainGrid} className="worbz-main-grid">

        {/* ── Arena panel ─────────────────────────────────────────────── */}
        <div style={S.arenaPanel}>

          {/* Fighter nameplate row */}
          {ballA && ballB && (
            <div style={S.nameplates}>
              <Nameplate f={ballA} align="left" />
              <span style={S.vsText}>VS</span>
              <Nameplate f={ballB} align="right" />
            </div>
          )}

          {/* Canvas */}
          <div style={S.canvasWrap} className="worbz-canvas-wrap">
            <ArenaCanvas
              frame={arena.currentFrame}
              ballAName={ballA?.name ?? "Fighter A"}
              ballBName={ballB?.name ?? "Fighter B"}
              ballAColor={ballA?.color ?? "#4fc3f7"}
              ballBColor={ballB?.color ?? "#ef5350"}
              ballAHp={ballA?.baseHp ?? 500}
              ballBHp={ballB?.baseHp ?? 500}
              width={380}
              height={665}
            />
          </div>

          {/* Announcement */}
          {arena.announcement && arena.phase === "live" && (
            <p style={S.announcement}>💬 {arena.announcement}</p>
          )}

          {/* Result card */}
          {arena.phase === "result" && arena.winner && (
            <div style={S.resultCard}>
              <div style={S.resultTitle}>
                🏆 {(arena.winner === "A" ? arena.resultBallA : arena.resultBallB)?.name} WINS
              </div>
              <div style={S.resultMeta}>
                {(arena.ticks / 30).toFixed(1)}s · {fmtCountdown(countdown)} until next match
              </div>
              {arena.commentary && <p style={S.commentary}>{arena.commentary}</p>}
            </div>
          )}
        </div>

        {/* ── Leaderboard sidebar ──────────────────────────────────────── */}
        <aside style={S.sidebar} className="worbz-sidebar">
          <div style={S.sideCard}>
            <h2 style={S.sideTitle}>🏅 LEADERBOARD</h2>
            {fighters.slice(0, 15).map((f, i) => (
              <Link key={f.id} to={`/fighter/${f.id}`} style={S.leaderRow}>
                <span style={S.rank}>#{i + 1}</span>
                <span style={{ ...S.colorDot, background: f.color }} />
                <span style={S.leaderName}>{f.name}</span>
                <span style={S.leaderStats}>
                  {f.wins}W {f.losses}L
                  <span style={S.wr}> {fmtWR(f.wins, f.losses)}</span>
                </span>
                {f.currentStreak >= 2 && (
                  <span style={S.streak}>🔥{f.currentStreak}</span>
                )}
              </Link>
            ))}
          </div>
        </aside>
      </div>

      {/* ── Recent results ──────────────────────────────────────────────── */}
      <section style={S.resultsSection}>
        <h2 style={S.sideTitle}>📋 RECENT RESULTS</h2>
        <div style={S.resultsGrid} className="worbz-results-grid">
          {matches.slice(0, 20).map(m => {
            const winnerName = m.winner === "A" ? m.ball_a_name : m.ball_b_name;
            const loserName  = m.winner === "A" ? m.ball_b_name : m.ball_a_name;
            const dur = `${(m.ticks / 30).toFixed(0)}s`;
            const ago = timeAgo(m.timestamp);
            return (
              <Link key={m.id} to={`/match/${m.id}`} style={S.resultRow}>
                <span style={S.matchId}>#{m.id}</span>
                <span style={S.resultText}>
                  <strong>{winnerName}</strong>
                  <span style={S.def}> def. </span>
                  {loserName}
                </span>
                <span style={S.resultMeta2}>{dur} · {ago}</span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Nameplate({ f, align }: { f: Fighter; align: "left" | "right" }) {
  const total = f.wins + f.losses;
  const wr = total > 0 ? Math.round((f.wins / total) * 100) : 0;
  return (
    <Link to={`/fighter/${f.id}`} style={{ ...S.nameplate, textAlign: align }}>
      <div style={{ ...S.colorDot, background: f.color, margin: align === "left" ? "0 6px 0 0" : "0 0 0 6px", display: "inline-block" }} />
      <span style={S.nplateName}>{f.name}</span>
      <div style={S.nplateSub}>{f.weaponId} · {f.wins}W {f.losses}L · {wr}% WR</div>
    </Link>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const C = {
  bg:      "#07070f",
  panel:   "#0e0e1a",
  border:  "#1c1c2e",
  text:    "#e0e0ff",
  muted:   "#555588",
  accent:  "#7c4dff",
  gold:    "#ffd700",
};

const S: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: C.bg,
    color: C.text,
    fontFamily: "'Courier New', Courier, monospace",
    display: "flex",
    flexDirection: "column",
    gap: 0,
  },

  // Top bar
  topbar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 20px",
    borderBottom: `1px solid ${C.border}`,
    background: C.panel,
    flexWrap: "wrap" as const,
  },
  logo: {
    fontSize: 18,
    fontWeight: "bold",
    letterSpacing: 4,
    color: C.accent,
    flexShrink: 0,
  },
  arenaLabel: {
    flex: 1,
    textAlign: "center" as const,
    fontSize: 13,
    letterSpacing: 2,
    color: "#aaa8cc",
    minWidth: 120,
  },
  liveChip: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    fontSize: 11,
    color: "#666688",
    flexShrink: 0,
  },
  dot: {
    display: "inline-block",
    width: 8,
    height: 8,
    borderRadius: "50%",
  },

  // Main grid — arena takes all space, sidebar fixed 280px
  mainGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 280px",
    gap: 0,
    flex: 1,
  },

  // Arena
  arenaPanel: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    padding: "16px 12px",
    borderRight: `1px solid ${C.border}`,
    gap: 10,
  },
  nameplates: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    maxWidth: 460,
    gap: 8,
  },
  nameplate: {
    flex: 1,
    textDecoration: "none",
    color: C.text,
    display: "flex",
    flexDirection: "column" as const,
  },
  nplateName: {
    fontSize: 13,
    fontWeight: "bold",
    whiteSpace: "nowrap" as const,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  nplateSub: {
    fontSize: 10,
    color: "#666688",
    marginTop: 2,
  },
  vsText: {
    fontSize: 11,
    color: "#444466",
    fontWeight: "bold",
    flexShrink: 0,
  },
  colorDot: {
    display: "inline-block",
    width: 10,
    height: 10,
    borderRadius: "50%",
    flexShrink: 0,
  },
  canvasWrap: {
    borderRadius: 8,
    overflow: "hidden",
    border: `1px solid ${C.border}`,
  },
  announcement: {
    fontSize: 11,
    color: "#99bbaa",
    fontStyle: "italic",
    textAlign: "center" as const,
    maxWidth: 420,
    lineHeight: 1.6,
    margin: 0,
  },
  resultCard: {
    background: "#12102a",
    border: `1px solid ${C.accent}`,
    borderRadius: 8,
    padding: "12px 16px",
    width: "100%",
    maxWidth: 460,
    textAlign: "center" as const,
  },
  resultTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: C.gold,
    marginBottom: 4,
  },
  resultMeta: {
    fontSize: 11,
    color: "#666688",
    marginBottom: 8,
  },
  commentary: {
    fontSize: 11,
    color: "#aaaacc",
    fontStyle: "italic",
    lineHeight: 1.6,
    margin: 0,
  },

  // Sidebar / Leaderboard
  sidebar: {
    padding: "16px 12px",
    overflowY: "auto" as const,
    maxHeight: "calc(100vh - 52px)",
    borderLeft: `1px solid ${C.border}`,
  },
  sideCard: {
    background: C.panel,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: "12px 10px",
  },
  sideTitle: {
    margin: "0 0 10px",
    fontSize: 11,
    letterSpacing: 2,
    color: "#666688",
    textTransform: "uppercase" as const,
  },
  leaderRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 0",
    borderBottom: `1px solid ${C.border}`,
    textDecoration: "none",
    color: C.text,
    fontSize: 12,
  },
  rank: { color: "#444466", width: 22, textAlign: "right" as const, flexShrink: 0 },
  leaderName: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, fontSize: 11 },
  leaderStats: { fontSize: 10, color: "#666688", flexShrink: 0, whiteSpace: "nowrap" as const },
  wr: { color: "#9977cc" },
  streak: { fontSize: 10, color: "#ff9800", flexShrink: 0 },

  // Recent results — full-width strip below the main grid
  resultsSection: {
    borderTop: `1px solid ${C.border}`,
    padding: "16px 20px",
    background: C.panel,
  },
  resultsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: "2px 16px",
  },
  resultRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "5px 0",
    borderBottom: `1px solid ${C.border}`,
    textDecoration: "none",
    color: C.text,
    fontSize: 11,
  },
  matchId:    { color: "#444466", width: 36, flexShrink: 0 },
  resultText: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const },
  def:        { color: "#555577" },
  resultMeta2:{ color: "#555577", flexShrink: 0, fontSize: 10 },
};
