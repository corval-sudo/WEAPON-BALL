// web/src/pages/Dashboard.tsx
// Homepage: live arena match (canvas + countdown), leaderboard, recent results feed.

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
  startsAt: string; // ISO timestamp
}

export default function Dashboard() {
  const arena = useArenaSocket();
  const [fighters, setFighters] = useState<Fighter[]>([]);
  const [matches, setMatches] = useState<RecentMatch[]>([]);
  const [countdown, setCountdown] = useState(0);
  const [nextMatch, setNextMatch] = useState<NextMatchInfo | null>(null);

  useEffect(() => {
    fetch(`${API}/api/fighters`).then(r => r.json()).then(setFighters).catch(() => {});
    fetch(`${API}/api/matches`).then(r => r.json()).then(setMatches).catch(() => {});
    fetch(`${API}/api/next`).then(r => r.json()).then(setNextMatch).catch(() => {});
  }, []);

  // Refresh recent matches after each result
  useEffect(() => {
    if (arena.phase === "result") {
      setTimeout(() => {
        fetch(`${API}/api/matches`).then(r => r.json()).then(setMatches).catch(() => {});
        fetch(`${API}/api/fighters`).then(r => r.json()).then(setFighters).catch(() => {});
        fetch(`${API}/api/next`).then(r => r.json()).then(setNextMatch).catch(() => {});
      }, 2000);
    }
  }, [arena.phase]);

  // Countdown timer — driven by /api/next startsAt timestamp when idle,
  // or by the WebSocket startsInMs during live countdown phase.
  useEffect(() => {
    // WebSocket live countdown takes priority (match is imminent)
    if (arena.phase === "countdown") {
      setCountdown(Math.ceil(arena.startsInMs / 1000));
      const timer = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
      return () => clearInterval(timer);
    }

    // HTTP polling fallback: compute countdown from the scheduled startsAt timestamp
    if (arena.phase === "idle" && nextMatch?.startsAt) {
      const update = () => {
        const secsLeft = Math.max(0, Math.ceil((new Date(nextMatch.startsAt).getTime() - Date.now()) / 1000));
        setCountdown(secsLeft);
      };
      update();
      const timer = setInterval(update, 1000);
      return () => clearInterval(timer);
    }
  }, [arena.phase, arena.startsInMs, nextMatch?.startsAt]);

  // Current fighters for canvas — fall back to /api/next data when WebSocket is idle
  const ballA = arena.liveBallA ?? arena.resultBallA ?? arena.nextBallA ?? nextMatch?.ballA ?? null;
  const ballB = arena.liveBallB ?? arena.resultBallB ?? arena.nextBallB ?? nextMatch?.ballB ?? null;

  return (
    <div style={styles.page}>
      {/* Header */}
      <header style={styles.header}>
        <h1 style={styles.title}>⚔️ WORBZ ARENA</h1>
        <div style={styles.liveIndicator}>
          <span style={{ ...styles.dot, background: arena.connected ? "#4caf50" : "#f44336" }} />
          {arena.connected ? "LIVE" : "CONNECTING..."}
        </div>
      </header>

      <div style={styles.grid}>
        {/* Left: Live Match */}
        <div style={styles.matchPanel}>
          <h2 style={styles.sectionTitle}>
            {arena.phase === "live" ? `⚔️ MATCH #${arena.matchNumber}` :
             arena.phase === "countdown" ? `🔜 NEXT MATCH IN ${countdown}s` :
             arena.phase === "result" ? `🏆 MATCH #${arena.matchNumber} RESULT` :
             (nextMatch && countdown > 0) ? `🔜 NEXT MATCH IN ${countdown}s` :
             "🎯 ARENA"}
          </h2>

          {/* Announcement */}
          {arena.announcement && arena.phase === "live" && (
            <p style={styles.announcement}>{arena.announcement}</p>
          )}

          {/* Canvas */}
          <div style={styles.canvasWrapper}>
            <ArenaCanvas
              frame={arena.currentFrame}
              ballAName={ballA?.name ?? "Fighter A"}
              ballBName={ballB?.name ?? "Fighter B"}
              ballAColor={ballA?.color ?? "#4fc3f7"}
              ballBColor={ballB?.color ?? "#ef5350"}
              ballAHp={ballA?.baseHp ?? 500}
              ballBHp={ballB?.baseHp ?? 500}
              width={300}
              height={525}
            />
          </div>

          {/* Fighter cards */}
          {(ballA && ballB) && (
            <div style={styles.fighterCards}>
              <FighterCard f={ballA} side="A" />
              <span style={styles.vs}>VS</span>
              <FighterCard f={ballB} side="B" />
            </div>
          )}

          {/* Result */}
          {arena.phase === "result" && arena.winner && (
            <div style={styles.resultCard}>
              <div style={styles.resultWinner}>
                🏆 {(arena.winner === "A" ? arena.resultBallA : arena.resultBallB)?.name ?? "???"} WINS
              </div>
              <div style={styles.resultDuration}>
                {(arena.ticks / 30).toFixed(1)}s
              </div>
              {arena.commentary && (
                <p style={styles.commentary}>{arena.commentary}</p>
              )}
            </div>
          )}
        </div>

        {/* Right: Leaderboard + Feed */}
        <div style={styles.sidePanel}>
          <div style={styles.leaderboard}>
            <h2 style={styles.sectionTitle}>🏅 LEADERBOARD</h2>
            {fighters.slice(0, 10).map((f, i) => (
              <Link key={f.id} to={`/fighter/${f.id}`} style={styles.leaderRow}>
                <span style={styles.rank}>#{i + 1}</span>
                <span style={{ ...styles.dot, background: f.color, width: 10, height: 10, flexShrink: 0 }} />
                <span style={styles.leaderName}>{f.name}</span>
                <span style={styles.leaderRecord}>{f.wins}W/{f.losses}L</span>
                {f.currentStreak > 1 && (
                  <span style={styles.streak}>🔥{f.currentStreak}</span>
                )}
              </Link>
            ))}
          </div>

          <div style={styles.feed}>
            <h2 style={styles.sectionTitle}>📋 RECENT RESULTS</h2>
            {matches.slice(0, 15).map(m => {
              const winnerName = m.winner === "A" ? m.ball_a_name : m.ball_b_name;
              const loserName  = m.winner === "A" ? m.ball_b_name : m.ball_a_name;
              return (
                <Link key={m.id} to={`/match/${m.id}`} style={styles.feedRow}>
                  <span style={styles.matchNum}>#{m.id}</span>
                  <span style={styles.feedText}>
                    <strong>{winnerName}</strong> def. {loserName}
                    <span style={styles.duration}> {(m.ticks / 30).toFixed(0)}s</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function FighterCard({ f }: { f: Fighter; side?: "A" | "B" }) {
  const total = f.wins + f.losses;
  const wr = total > 0 ? Math.round((f.wins / total) * 100) : 0;
  return (
    <div style={{ ...styles.fighterCard, borderColor: f.color }}>
      <div style={{ ...styles.dot, background: f.color, width: 12, height: 12 }} />
      <Link to={`/fighter/${f.id}`} style={styles.fighterCardName}>{f.name}</Link>
      <div style={styles.fighterCardSub}>{f.weaponId} · {wr}% WR</div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const C = {
  bg: "#0a0a0f",
  panel: "#12121a",
  border: "#1e1e2e",
  text: "#e0e0ff",
  muted: "#666699",
  accent: "#7c4dff",
};

const styles: Record<string, React.CSSProperties> = {
  page:         { minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "monospace", padding: "12px 16px" },
  header:       { display: "flex", alignItems: "center", gap: 16, marginBottom: 16, borderBottom: `1px solid ${C.border}`, paddingBottom: 12 },
  title:        { margin: 0, fontSize: 22, letterSpacing: 3, color: C.accent },
  liveIndicator:{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: C.muted },
  dot:          { display: "inline-block", borderRadius: "50%", width: 8, height: 8 },
  grid:         { display: "grid", gridTemplateColumns: "340px 1fr", gap: 20 },
  matchPanel:   { background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14 },
  sidePanel:    { display: "flex", flexDirection: "column", gap: 16 },
  sectionTitle: { margin: "0 0 10px", fontSize: 13, letterSpacing: 2, color: C.muted, textTransform: "uppercase" as const },
  announcement: { fontSize: 11, color: "#aabb99", fontStyle: "italic", margin: "8px 0", lineHeight: 1.5 },
  canvasWrapper:{ display: "flex", justifyContent: "center", margin: "8px 0" },
  fighterCards: { display: "flex", alignItems: "center", gap: 8, marginTop: 10 },
  fighterCard:  { flex: 1, border: "1px solid", borderRadius: 6, padding: "6px 8px", background: "#0d0d18", display: "flex", flexDirection: "column" as const, gap: 2 },
  fighterCardName: { fontSize: 11, color: C.text, fontWeight: "bold", textDecoration: "none" },
  fighterCardSub: { fontSize: 10, color: C.muted },
  vs:           { color: C.muted, fontSize: 12, fontWeight: "bold" },
  resultCard:   { background: "#1a1a2e", border: `1px solid ${C.accent}`, borderRadius: 8, padding: 12, marginTop: 12 },
  resultWinner: { fontSize: 15, fontWeight: "bold", color: "#ffd700", marginBottom: 4 },
  resultDuration: { fontSize: 11, color: C.muted, marginBottom: 8 },
  commentary:   { fontSize: 11, color: "#aaaacc", fontStyle: "italic", lineHeight: 1.6, margin: 0 },
  leaderboard:  { background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14 },
  leaderRow:    { display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: `1px solid ${C.border}`, textDecoration: "none", color: C.text, fontSize: 12 },
  rank:         { color: C.muted, width: 24, textAlign: "right" as const, flexShrink: 0 },
  leaderName:   { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const },
  leaderRecord: { color: C.muted, fontSize: 11, flexShrink: 0 },
  streak:       { color: "#ff9800", fontSize: 11, flexShrink: 0 },
  feed:         { background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14, flex: 1 },
  feedRow:      { display: "flex", alignItems: "center", gap: 8, padding: "4px 0", borderBottom: `1px solid ${C.border}`, textDecoration: "none", color: C.text, fontSize: 11 },
  matchNum:     { color: C.muted, width: 36, flexShrink: 0 },
  feedText:     { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const },
  duration:     { color: C.muted },
};
