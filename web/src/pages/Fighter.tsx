// web/src/pages/Fighter.tsx
// Fighter profile page: career stats, win rate, weapon, match history.

import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";

const API = import.meta.env["VITE_API_URL"] ?? "http://localhost:3001";

interface Fighter {
  id: string; name: string; weaponId: string; personality: string;
  wins: number; losses: number; currentStreak: number; longestWinStreak: number;
  totalDamageDealt: number; totalDamageTaken: number; baseHp: number;
  radius: number; color: string; createdAt: string;
}

interface MatchRow {
  id: number; winner: string; ticks: number; timestamp: string;
  ball_a_id: string; ball_b_id: string;
  ball_a_name: string; ball_b_name: string;
  ball_a_damage_dealt: number; ball_b_damage_dealt: number;
}

export default function FighterPage() {
  const { id } = useParams<{ id: string }>();
  const [fighter, setFighter] = useState<Fighter | null>(null);
  const [history, setHistory] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetch(`${API}/api/fighters/${id}`)
      .then(r => r.json())
      .then(data => {
        setFighter(data.fighter);
        setHistory(data.history ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={styles.page}><div style={styles.muted}>Loading...</div></div>;
  if (!fighter) return <div style={styles.page}><div style={styles.muted}>Fighter not found.</div></div>;

  const total = fighter.wins + fighter.losses;
  const winRate = total > 0 ? ((fighter.wins / total) * 100).toFixed(1) : "0.0";

  return (
    <div style={styles.page}>
      <div style={styles.nav}><Link to="/" style={styles.backLink}>← Back to Arena</Link></div>

      <div style={styles.profileHeader}>
        <div style={{ ...styles.colorDot, background: fighter.color }} />
        <div>
          <h1 style={styles.name}>{fighter.name}</h1>
          <div style={styles.subtitle}>{fighter.weaponId} · #{fighter.id.slice(0, 8)}</div>
        </div>
      </div>

      {/* Stats grid */}
      <div style={styles.statsGrid}>
        <StatBox label="Wins" value={fighter.wins} accent="#4DFF91" />
        <StatBox label="Losses" value={fighter.losses} accent="#FF3D00" />
        <StatBox label="Win Rate" value={`${winRate}%`} accent="#4DFF91" />
        <StatBox label="Streak" value={fighter.currentStreak > 0 ? `${fighter.currentStreak}W` : fighter.currentStreak < 0 ? `${Math.abs(fighter.currentStreak)}L` : "—"} />
        <StatBox label="Best Streak" value={fighter.longestWinStreak} />
        <StatBox label="DMG Dealt" value={fighter.totalDamageDealt.toLocaleString()} />
        <StatBox label="DMG Taken" value={fighter.totalDamageTaken.toLocaleString()} />
        <StatBox label="Base HP" value={fighter.baseHp} />
      </div>

      {/* Personality */}
      {fighter.personality && (
        <div style={styles.personalityBox}>
          <div style={styles.sectionTitle}>CHARACTER</div>
          <p style={styles.personality}>{fighter.personality}</p>
        </div>
      )}

      {/* Match history */}
      <div style={styles.historySection}>
        <div style={styles.sectionTitle}>MATCH HISTORY</div>
        {history.length === 0 && <div style={styles.muted}>No matches yet.</div>}
        {history.map(m => {
          const isA = m.ball_a_id === id;
          const myDmg   = isA ? m.ball_a_damage_dealt : m.ball_b_damage_dealt;
          const oppDmg  = isA ? m.ball_b_damage_dealt : m.ball_a_damage_dealt;
          const oppName = isA ? m.ball_b_name : m.ball_a_name;
          const won = (isA && m.winner === "A") || (!isA && m.winner === "B");
          const date = new Date(m.timestamp).toLocaleDateString();
          return (
            <Link key={m.id} to={`/match/${m.id}`} style={styles.historyRow}>
              <span style={{ ...styles.outcomeTag, background: won ? "#0a1a0c" : "#1a0a08", color: won ? "#4DFF91" : "#FF3D00" }}>
                {won ? "WIN" : "LOSS"}
              </span>
              <span style={styles.historyOpp}>vs {oppName}</span>
              <span style={styles.historyDmg}>{myDmg} / {oppDmg} dmg</span>
              <span style={styles.historyDur}>{(m.ticks / 30).toFixed(1)}s</span>
              <span style={styles.historyDate}>{date}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function StatBox({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div style={styles.statBox}>
      <div style={{ ...styles.statValue, color: accent ?? "#4DFF91" }}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  );
}

const C = { bg: "#000000", panel: "#0a0f0b", border: "#0d2a1c", text: "#4DFF91", muted: "#4a5a4e" };

const styles: Record<string, React.CSSProperties> = {
  page:           { minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'Courier New', Courier, monospace", padding: "16px 20px", maxWidth: 800, margin: "0 auto" },
  nav:            { marginBottom: 16 },
  backLink:       { color: C.muted, textDecoration: "none", fontSize: 13 },
  profileHeader:  { display: "flex", alignItems: "center", gap: 14, marginBottom: 24 },
  colorDot:       { width: 48, height: 48, borderRadius: "50%", flexShrink: 0 },
  name:           { margin: 0, fontSize: 24, fontFamily: "'Orbitron', sans-serif", fontWeight: 700, letterSpacing: 0 },
  subtitle:       { color: C.muted, fontSize: 12, marginTop: 4 },
  statsGrid:      { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 },
  statBox:        { background: C.panel, border: `1px solid ${C.border}`, padding: "12px 10px", textAlign: "center" as const },
  statValue:      { fontSize: 20, fontWeight: "bold", marginBottom: 4 },
  statLabel:      { fontSize: 10, color: C.muted, letterSpacing: "0.2em", fontFamily: "'Orbitron', sans-serif" },
  personalityBox: { background: C.panel, border: `1px solid ${C.border}`, padding: 14, marginBottom: 20 },
  personality:    { margin: 0, fontSize: 12, color: C.muted, lineHeight: 1.7, fontStyle: "italic" },
  sectionTitle:   { fontSize: 10, color: "#4DFF91", letterSpacing: "0.2em", marginBottom: 10, textTransform: "uppercase" as const, fontFamily: "'Orbitron', sans-serif", fontWeight: 700 },
  historySection: { background: C.panel, border: `1px solid ${C.border}`, padding: 14 },
  historyRow:     { display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: `1px solid ${C.border}`, textDecoration: "none", color: C.text, fontSize: 12 },
  outcomeTag:     { padding: "2px 7px", fontSize: 10, fontWeight: "bold", flexShrink: 0 },
  historyOpp:     { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const },
  historyDmg:     { color: C.muted, fontSize: 11, flexShrink: 0 },
  historyDur:     { color: C.muted, fontSize: 11, flexShrink: 0 },
  historyDate:    { color: C.muted, fontSize: 10, flexShrink: 0 },
  muted:          { color: C.muted, fontSize: 13 },
};
