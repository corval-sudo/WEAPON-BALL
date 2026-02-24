// web/src/pages/Match.tsx
// Match detail / replay page.
// Shows match stats and an animated canvas replay of the stored match.

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { PhaserArena } from "../components/PhaserArena";
import type { TickFrame, WeaponDef } from "../hooks/useArenaSocket";

const API = import.meta.env["VITE_API_URL"] ?? "http://localhost:3001";

interface MatchDetail {
  id: number; winner: string; ticks: number; timestamp: string;
  ball_a_id: string; ball_b_id: string; arena_name: string; seed: number;
  ball_a_name: string; ball_b_name: string;
  ball_a_weapon: string; ball_b_weapon: string;
  ball_a_damage_dealt: number; ball_a_damage_taken: number; ball_a_accuracy: number;
  ball_b_damage_dealt: number; ball_b_damage_taken: number; ball_b_accuracy: number;
}

interface Fighter {
  id: string; name: string; color: string; baseHp: number; weaponId: string;
}

interface ReplayData {
  matchId: number;
  totalTicks: number;
  scale: number;
  arenaW: number;
  arenaH: number;
  ballAName: string;
  ballBName: string;
  ballAColor: string;
  ballBColor: string;
  ballAHp: number;
  ballBHp: number;
  ballARadius: number;
  ballBRadius: number;
  weaponA: WeaponDef | null;
  weaponB: WeaponDef | null;
  frames: TickFrame[];
}

export default function MatchPage() {
  const { id } = useParams<{ id: string }>();
  const [match, setMatch] = useState<MatchDetail | null>(null);
  const [ballA, setBallA] = useState<Fighter | null>(null);
  const [ballB, setBallB] = useState<Fighter | null>(null);
  const [loading, setLoading] = useState(true);
  const [replayLoading, setReplayLoading] = useState(true);

  const [frames, setFrames] = useState<TickFrame[]>([]);
  const [currentTick, setCurrentTick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [weaponA, setWeaponA] = useState<WeaponDef | null>(null);
  const [weaponB, setWeaponB] = useState<WeaponDef | null>(null);
  const [ballARadius, setBallARadius] = useState(42);
  const [ballBRadius, setBallBRadius] = useState(42);

  useEffect(() => {
    if (!id) return;

    // Fetch match metadata and fighters in parallel with replay frames
    const matchPromise = fetch(`${API}/api/matches/${id}`)
      .then(r => r.json())
      .then(async (m: MatchDetail) => {
        setMatch(m);
        const [fA, fB] = await Promise.all([
          fetch(`${API}/api/fighters/${m.ball_a_id}`).then(r => r.json()).then(d => d.fighter).catch(() => null),
          fetch(`${API}/api/fighters/${m.ball_b_id}`).then(r => r.json()).then(d => d.fighter).catch(() => null),
        ]);
        setBallA(fA);
        setBallB(fB);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    // Fetch real deterministic replay frames from the server
    const replayPromise = fetch(`${API}/api/matches/${id}/replay`)
      .then(r => r.json())
      .then((data: ReplayData) => {
        setFrames(data.frames);
        setCurrentTick(0);
        setWeaponA(data.weaponA ?? null);
        setWeaponB(data.weaponB ?? null);
        setBallARadius(data.ballARadius ?? 42);
        setBallBRadius(data.ballBRadius ?? 42);
        setReplayLoading(false);
      })
      .catch(() => setReplayLoading(false));

    Promise.all([matchPromise, replayPromise]);
  }, [id]);

  // Auto-start replay as soon as frames are available
  useEffect(() => {
    if (frames.length > 0) {
      setCurrentTick(0);
      setPlaying(true);
    }
  }, [frames.length]);

  const startReplay = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setCurrentTick(0);
    setPlaying(true);
  }, []);

  const togglePlay = useCallback(() => {
    setPlaying(p => !p);
  }, []);

  useEffect(() => {
    if (!playing || frames.length === 0) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
      setCurrentTick(t => {
        if (t >= frames.length - 1) {
          setPlaying(false);
          return t;
        }
        return t + 1;
      });
    }, Math.round(33 / speed));
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [playing, speed, frames.length]);

  if (loading) return <div style={styles.page}><div style={styles.muted}>Loading...</div></div>;
  if (!match) return <div style={styles.page}><div style={styles.muted}>Match not found.</div></div>;
  if (replayLoading) return <div style={styles.page}><div style={styles.muted}>Loading replay frames...</div></div>;

  const currentFrame = frames[currentTick] ?? null;
  const winnerName = match.winner === "A" ? match.ball_a_name : match.ball_b_name;
  const loserName  = match.winner === "A" ? match.ball_b_name : match.ball_a_name;
  const duration   = (match.ticks / 30).toFixed(1);

  return (
    <div style={styles.page}>
      <div style={styles.nav}>
        <Link to="/" style={styles.backLink}>← Arena</Link>
        {match.ball_a_id && <Link to={`/fighter/${match.ball_a_id}`} style={styles.backLink}>{match.ball_a_name}</Link>}
        {match.ball_b_id && <Link to={`/fighter/${match.ball_b_id}`} style={styles.backLink}>{match.ball_b_name}</Link>}
      </div>

      <h1 style={styles.title}>Match #{match.id}</h1>
      <div style={styles.subtitle}>{winnerName} def. {loserName} in {duration}s · {match.arena_name}</div>

      <div style={styles.grid}>
        {/* Canvas + controls */}
        <div style={styles.canvasPanel}>
          <PhaserArena
            frame={currentFrame}
            ballAName={match.ball_a_name}
            ballBName={match.ball_b_name}
            ballAColor={ballA?.color ?? "#4fc3f7"}
            ballBColor={ballB?.color ?? "#ef5350"}
            ballAHp={ballA?.baseHp ?? 500}
            ballBHp={ballB?.baseHp ?? 500}
            ballARadius={ballARadius}
            ballBRadius={ballBRadius}
            weaponA={weaponA}
            weaponB={weaponB}
            width={300}
            height={525}
          />
          <div style={styles.controls}>
            <button style={styles.btn} onClick={startReplay}>↺ Restart</button>
            <button style={styles.btn} onClick={togglePlay}>{playing ? "⏸ Pause" : "▶ Play"}</button>
            <select style={styles.select} value={speed} onChange={e => setSpeed(Number(e.target.value))}>
              <option value={0.5}>0.5×</option>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
              <option value={4}>4×</option>
            </select>
            <span style={styles.tickDisplay}>t:{currentTick}/{match.ticks}</span>
          </div>
        </div>

        {/* Stats */}
        <div style={styles.statsPanel}>
          <div style={styles.sectionTitle}>STATS</div>

          {[
            { name: match.ball_a_name, weapon: match.ball_a_weapon, dmgDealt: match.ball_a_damage_dealt, dmgTaken: match.ball_a_damage_taken, acc: match.ball_a_accuracy, won: match.winner === "A" },
            { name: match.ball_b_name, weapon: match.ball_b_weapon, dmgDealt: match.ball_b_damage_dealt, dmgTaken: match.ball_b_damage_taken, acc: match.ball_b_accuracy, won: match.winner === "B" },
          ].map(f => (
            <div key={f.name} style={{ ...styles.statCard, borderColor: f.won ? "#4caf50" : "#333" }}>
              <div style={styles.statCardName}>
                {f.won ? "🏆 " : ""}<strong>{f.name}</strong> ({f.weapon})
              </div>
              <div style={styles.statRow}><span>Damage Dealt</span><span>{f.dmgDealt}</span></div>
              <div style={styles.statRow}><span>Damage Taken</span><span>{f.dmgTaken}</span></div>
              <div style={styles.statRow}><span>Accuracy</span><span>{f.acc}%</span></div>
            </div>
          ))}

          <div style={styles.metaBox}>
            <div style={styles.metaRow}><span>Duration</span><span>{duration}s ({match.ticks} ticks)</span></div>
            <div style={styles.metaRow}><span>Arena</span><span>{match.arena_name}</span></div>
            <div style={styles.metaRow}><span>Seed</span><span>{match.seed}</span></div>
            <div style={styles.metaRow}><span>Date</span><span>{new Date(match.timestamp).toLocaleString()}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

const C = { bg: "#0a0a0f", panel: "#12121a", border: "#1e1e2e", text: "#e0e0ff", muted: "#666699" };

const styles: Record<string, React.CSSProperties> = {
  page:         { minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "monospace", padding: "16px 20px", maxWidth: 900, margin: "0 auto" },
  nav:          { display: "flex", gap: 16, marginBottom: 16 },
  backLink:     { color: C.muted, textDecoration: "none", fontSize: 13 },
  title:        { margin: "0 0 4px", fontSize: 22, letterSpacing: 2 },
  subtitle:     { color: C.muted, fontSize: 13, marginBottom: 20 },
  grid:         { display: "grid", gridTemplateColumns: "320px 1fr", gap: 20 },
  canvasPanel:  { display: "flex", flexDirection: "column" as const, gap: 10 },
  controls:     { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as const },
  btn:          { background: "#1e1e2e", border: "1px solid #333", color: C.text, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontFamily: "monospace", fontSize: 12 },
  select:       { background: "#1e1e2e", border: "1px solid #333", color: C.text, borderRadius: 6, padding: "4px 6px", fontFamily: "monospace", fontSize: 12 },
  tickDisplay:  { color: C.muted, fontSize: 11 },
  statsPanel:   { display: "flex", flexDirection: "column" as const, gap: 12 },
  sectionTitle: { fontSize: 11, color: C.muted, letterSpacing: 2, marginBottom: 6, textTransform: "uppercase" as const },
  statCard:     { background: C.panel, border: "1px solid", borderRadius: 8, padding: 12 },
  statCardName: { fontSize: 13, marginBottom: 8 },
  statRow:      { display: "flex", justifyContent: "space-between", fontSize: 12, color: C.muted, padding: "3px 0" },
  metaBox:      { background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 },
  metaRow:      { display: "flex", justifyContent: "space-between", fontSize: 11, color: C.muted, padding: "3px 0", borderBottom: `1px solid ${C.border}` },
  muted:        { color: C.muted, fontSize: 13 },
};
