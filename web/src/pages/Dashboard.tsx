// web/src/pages/Dashboard.tsx
// Homepage: live arena (center), leaderboard (right), recent results (below).
// Fighter cards on left/right of the canvas show W/L, weapon stats, ball stats.
// Admin panel (VITE_ADMIN_MODE=true) adds recording controls to the sidebar.

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useArenaSocket } from "../hooks/useArenaSocket";
import type { Fighter as LiveFighter, WeaponDef } from "../hooks/useArenaSocket";
import { PhaserArena } from "../components/PhaserArena";
import { AdminPanel } from "../components/AdminPanel";
import { MatchRecorder, saveRecordingMeta } from "../recorder/MatchRecorder";
import type { RuntimeRecording } from "../recorder/MatchRecorder";

const API        = import.meta.env["VITE_API_URL"] ?? "http://localhost:3001";
const ADMIN_MODE = import.meta.env["VITE_ADMIN_MODE"] === "true";

interface LeaderboardFighter {
  id: string; name: string; weaponId: string;
  wins: number; losses: number; currentStreak: number;
  baseHp: number; color: string; radius: number;
}

interface RecentMatch {
  id: number; winner: string; ticks: number; timestamp: string;
  ball_a_name: string; ball_b_name: string;
  ball_a_weapon: string; ball_b_weapon: string;
  ball_a_damage_dealt: number; ball_b_damage_dealt: number;
}

interface NextMatchInfo {
  ballA: LiveFighter;
  ballB: LiveFighter;
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
  const [fighters, setFighters]       = useState<LeaderboardFighter[]>([]);
  const [matches, setMatches]         = useState<RecentMatch[]>([]);
  const [countdown, setCountdown]     = useState(0);
  const [nextMatch, setNextMatch]     = useState<NextMatchInfo | null>(null);
  const [showLeaderboard, setShowLB]  = useState(true);
  const [showResults, setShowResults] = useState(true);

  // ── Recording state ──────────────────────────────────────────────────────
  const [recordNextMatch, setRecordNextMatch]   = useState(false);
  const [recordAllMatches, setRecordAllMatches] = useState(false);
  const [showHiddenArena, setShowHiddenArena]   = useState(false);
  const [hiddenCanvasReady, setHiddenCanvasReady] = useState(false);
  const [isRecording, setIsRecording]           = useState(false);
  const [recordings, setRecordings]             = useState<RuntimeRecording[]>([]);
  // Refs — avoid stale closure problems in async callbacks
  const recorderRef           = useRef(new MatchRecorder());
  const hiddenContainerRef    = useRef<HTMLDivElement>(null);
  const recordingActiveRef    = useRef(false);
  const recordAllRef          = useRef(false);

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

  // Countdown — WebSocket takes priority, falls back to /api/next startsAt.
  // Use -1 as sentinel for "startsAt is known but in the past" (scheduler busy/restarting).
  useEffect(() => {
    if (arena.phase === "countdown") {
      setCountdown(Math.ceil(arena.startsInMs / 1000));
      const t = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
      return () => clearInterval(t);
    }
    if ((arena.phase === "idle" || arena.phase === "result") && nextMatch?.startsAt) {
      const update = () => {
        const ms = new Date(nextMatch.startsAt).getTime() - Date.now();
        setCountdown(ms > 0 ? Math.ceil(ms / 1000) : -1);
      };
      update();
      const t = setInterval(update, 1000);
      return () => clearInterval(t);
    }
  }, [arena.phase, arena.startsInMs, nextMatch?.startsAt]);

  // Keep recordAllRef in sync so async stop() callbacks read current state
  useEffect(() => { recordAllRef.current = recordAllMatches; }, [recordAllMatches]);

  // Mount hidden arena immediately when recording is armed (don't wait for countdown —
  // React 18 batches next_match+match_start so "countdown" phase can be skipped entirely).
  useEffect(() => {
    if (recordNextMatch || recordAllMatches) {
      console.log("[REC] Recording armed — mounting hidden arena");
      setShowHiddenArena(true);
    }
  }, [recordNextMatch, recordAllMatches]);

  // Reset canvas-ready flag when the hidden arena is torn down
  useEffect(() => {
    if (!showHiddenArena) {
      setHiddenCanvasReady(false);
    }
  }, [showHiddenArena]);

  // Start recording when match goes live AND hidden canvas is initialised.
  // hiddenCanvasReady in the deps list means this also fires if the canvas
  // becomes ready *after* phase already flipped to "live" (arm-while-live scenario).
  useEffect(() => {
    if (arena.phase !== "live") return;
    if (recordingActiveRef.current || recorderRef.current.isRecording) return;
    if (!hiddenCanvasReady) {
      console.warn("[REC] Phase is live but canvas not ready yet");
      return;
    }

    // Always re-query the canvas from the container at start time.
    // This avoids stale-ref bugs caused by React StrictMode's cleanup cycle
    // (game.destroy resets canvas.width/height to 1 via Phaser's CanvasPool).
    const canvas = hiddenContainerRef.current?.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canvas) {
      console.warn("[REC] No canvas found in hidden container");
      return;
    }
    if (canvas.width !== 1080 || canvas.height !== 1890) {
      console.warn(`[REC] Canvas wrong size: ${canvas.width}×${canvas.height} — not starting recorder`);
      return;
    }

    console.log(`[REC] Starting recorder — canvas ${canvas.width}×${canvas.height}`);
    recorderRef.current.start(
      canvas,
      arena.matchNumber,
      arena.liveBallA?.name ?? "Fighter A",
      arena.liveBallB?.name ?? "Fighter B",
    );
    recordingActiveRef.current = true;
    setIsRecording(true);

    // Consume "record next only" flag without clearing "all matches" mode
    if (recordNextMatch && !recordAllMatches) setRecordNextMatch(false);
  }, [arena.phase, arena.matchNumber, hiddenCanvasReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop recording when match ends — delay 3s so the winner overlay is visible in the recording.
  useEffect(() => {
    if (arena.phase !== "result" || !recordingActiveRef.current) return;

    const timer = setTimeout(() => {
      recordingActiveRef.current = false;

      recorderRef.current.stop(arena.winner ?? "?").then(rec => {
        saveRecordingMeta(rec);
        setRecordings(prev => [rec, ...prev]);
        setIsRecording(false);
        // Tear down hidden arena if "record all" mode is off
        if (!recordAllRef.current) setShowHiddenArena(false);
      }).catch(e => {
        console.warn("[Recording] stop() failed:", e.message);
        setIsRecording(false);
        if (!recordAllRef.current) setShowHiddenArena(false);
      });
    }, 3000);

    return () => clearTimeout(timer);
  }, [arena.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fighters for canvas — WebSocket > /api/next fallback
  const ballA = arena.liveBallA ?? arena.resultBallA ?? arena.nextBallA ?? nextMatch?.ballA ?? null;
  const ballB = arena.liveBallB ?? arena.resultBallB ?? arena.nextBallB ?? nextMatch?.ballB ?? null;

  // Arena status label — countdown === -1 means startsAt is known but past (match imminent)
  const arenaLabel =
    arena.phase === "live"      ? `MATCH #${arena.matchNumber} — LIVE` :
    arena.phase === "countdown" ? `STARTING IN ${fmtCountdown(countdown)}` :
    arena.phase === "result"    ? `MATCH #${arena.matchNumber} RESULT` :
    countdown === -1            ? `NEXT MATCH STARTING SOON` :
    countdown > 0               ? `NEXT MATCH IN ${fmtCountdown(countdown)}` :
    "WORBZ ARENA";

  return (
    <div style={S.page}>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <header style={S.topbar} className="worbz-topbar">
        <img src="/brand/worbz-wordmark-short.svg" alt="WORBZ" style={S.logo} />
        <span style={S.arenaLabel} className="worbz-arena-label">{arenaLabel}</span>
        <span style={S.liveChip}>
          <span style={{ ...S.dot, background: arena.connected ? "#4DFF91" : "#FF3D00" }} />
          {arena.connected ? "LIVE" : "OFFLINE"}
        </span>
      </header>

      {/* ── Main grid: arena | leaderboard ──────────────────────────────── */}
      <div style={S.mainGrid} className="worbz-main-grid">

        {/* ── Arena panel ─────────────────────────────────────────────── */}
        <div style={S.arenaPanel}>

          {/* Fighter cards + canvas row */}
          <div style={S.canvasRow}>

            {/* Left fighter card — Ball A */}
            <FighterCard f={ballA} weapon={arena.weaponA} side="left" />

            {/* Center: VS strip + canvas + controls */}
            <div style={S.centerCol}>
              {/* VS strip */}
              {ballA && ballB && (
                <div style={S.vsStrip}>
                  <span style={{ ...S.vsName, color: ballA.color }}>{ballA.name}</span>
                  <span style={S.vsText}>VS</span>
                  <span style={{ ...S.vsName, color: ballB.color, textAlign: "right" }}>{ballB.name}</span>
                </div>
              )}

              {/* Canvas — Phaser 3 WebGL renderer */}
              <div style={S.canvasWrap} className="worbz-canvas-wrap">
                <PhaserArena
                  frame={arena.currentFrame}
                  ballAName={ballA?.name ?? "Fighter A"}
                  ballBName={ballB?.name ?? "Fighter B"}
                  ballAColor={ballA?.color ?? "#4fc3f7"}
                  ballBColor={ballB?.color ?? "#ef5350"}
                  ballAHp={ballA?.baseHp ?? 500}
                  ballBHp={ballB?.baseHp ?? 500}
                  ballARadius={ballA?.radius ?? 42}
                  ballBRadius={ballB?.radius ?? 42}
                  weaponA={arena.weaponA}
                  weaponB={arena.weaponB}
                  width={340}
                  height={595}
                />
              </div>
            </div>

            {/* Right fighter card — Ball B */}
            <FighterCard f={ballB} weapon={arena.weaponB} side="right" />
          </div>

          {/* Announcement */}
          {arena.announcement && arena.phase === "live" && (
            <p style={S.announcement}>{arena.announcement}</p>
          )}

          {/* Result card */}
          {arena.phase === "result" && arena.winner && (
            <div style={S.resultCard}>
              <div style={S.resultTitle}>
                {(arena.winner === "A" ? arena.resultBallA : arena.resultBallB)?.name} WINS
              </div>
              <div style={S.resultMeta}>
                {(arena.ticks / 30).toFixed(1)}s · {countdown === -1 ? "starting soon" : countdown > 0 ? `${fmtCountdown(countdown)} until next` : "next match soon"}
              </div>
              {arena.commentary && <p style={S.commentary}>{arena.commentary}</p>}
            </div>
          )}
        </div>

        {/* ── Leaderboard + Admin sidebar ──────────────────────────────── */}
        <aside style={S.sidebar} className="worbz-sidebar">
          <div style={S.sideCard}>
            <button style={S.panelToggle} onClick={() => setShowLB(v => !v)}>
              <span>LEADERBOARD</span>
              <span style={S.chevron}>{showLeaderboard ? "▲" : "▼"}</span>
            </button>
            <div style={{ overflow: "hidden", maxHeight: showLeaderboard ? 1200 : 0, transition: "max-height 0.3s ease" }}>
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
          </div>

          {/* Admin panel — only visible when VITE_ADMIN_MODE=true */}
          {ADMIN_MODE && (
            <AdminPanel
              recordNextMatch={recordNextMatch}
              recordAllMatches={recordAllMatches}
              isRecording={isRecording}
              recordings={recordings}
              onToggleNextMatch={setRecordNextMatch}
              onToggleAllMatches={setRecordAllMatches}
              onRecordingsChange={setRecordings}
            />
          )}
        </aside>
      </div>

      {/* ── Recent results ──────────────────────────────────────────────── */}
      <section style={S.resultsSection}>
        <button style={S.panelToggle} onClick={() => setShowResults(v => !v)}>
          <span>RECENT RESULTS</span>
          <span style={S.chevron}>{showResults ? "▲" : "▼"}</span>
        </button>
        <div style={{ overflow: "hidden", maxHeight: showResults ? 400 : 0, transition: "max-height 0.3s ease" }}>
        <div style={S.resultsScroll} className="worbz-results-grid">
          {matches.slice(0, 30).map(m => {
            const isAWin     = m.winner === "A";
            const winnerName = isAWin ? m.ball_a_name : m.ball_b_name;
            const loserName  = isAWin ? m.ball_b_name : m.ball_a_name;
            const winnerWeap = isAWin ? m.ball_a_weapon : m.ball_b_weapon;
            const loserWeap  = isAWin ? m.ball_b_weapon : m.ball_a_weapon;
            const dur = `${(m.ticks / 30).toFixed(0)}s`;
            const ago = timeAgo(m.timestamp);
            return (
              <Link key={m.id} to={`/match/${m.id}`} style={S.resultCard2}>
                <div style={S.resultCardTop}>
                  <span style={S.matchId}>#{m.id}</span>
                  <span style={S.resultMeta2}>{ago}</span>
                </div>
                <div style={S.resultCardBody}>
                  <span style={S.winnerText}>W {winnerName}</span>
                  <span style={S.weaponBadge}>{winnerWeap}</span>
                </div>
                <div style={S.resultCardBody}>
                  <span style={S.loserText}>L {loserName}</span>
                  <span style={S.weaponBadge}>{loserWeap}</span>
                </div>
                <div style={S.resultCardFooter}>
                  <span style={S.durText}>{dur}</span>
                  <span style={S.viewReplay}>▶ replay →</span>
                </div>
              </Link>
            );
          })}
        </div>
        </div>{/* end collapse wrapper */}
      </section>

      {/* ── Hidden 1080×1890 Phaser instance for high-resolution recording ── */}
      {/* Dimensions preserve the simulation's 4:7 aspect ratio (400×700 arena) */}
      {/* so scaleX === scaleY (2.7×) — no distortion, faithful to live render. */}
      {showHiddenArena && (
        <div ref={hiddenContainerRef} style={S.hiddenArenaWrap}>
          <PhaserArena
            frame={arena.currentFrame}
            ballAName={ballA?.name ?? "Fighter A"}
            ballBName={ballB?.name ?? "Fighter B"}
            ballAColor={ballA?.color ?? "#4fc3f7"}
            ballBColor={ballB?.color ?? "#ef5350"}
            ballAHp={ballA?.baseHp ?? 500}
            ballBHp={ballB?.baseHp ?? 500}
            ballARadius={ballA?.radius ?? 42}
            ballBRadius={ballB?.radius ?? 42}
            weaponA={arena.weaponA}
            weaponB={arena.weaponB}
            ballAWins={ballA?.wins}
            ballALosses={ballA?.losses}
            ballBWins={ballB?.wins}
            ballBLosses={ballB?.losses}
            width={1080}
            height={1890}
            recordingMode={true}
            winner={arena.phase === "result" ? (arena.winner as "A" | "B" | null) : null}
            preserveDrawingBuffer={true}
            onCanvasReady={canvas => {
              console.log(`[REC] onCanvasReady — ${canvas.width}×${canvas.height}`);
              setHiddenCanvasReady(true);
            }}
          />
        </div>
      )}
    </div>
  );
}

// ─── FighterCard ──────────────────────────────────────────────────────────────

const WEAPON_TYPE_ICON: Record<string, string> = {
  blade: "⚔️",
  point: "🗡️",
  blunt: "🔨",
};

function CardRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={FC.row}>
      <span style={FC.rowLabel}>{label}</span>
      <span style={FC.rowValue}>{value}</span>
    </div>
  );
}

function FighterCard({ f, weapon, side }: { f: LiveFighter | null; weapon: WeaponDef | null; side: "left" | "right" }) {
  if (!f) return <div style={FC.placeholder} />;

  const total = f.wins + f.losses;
  const wr    = total > 0 ? Math.round((f.wins / total) * 100) : 0;

  const streak = f.currentStreak > 2
    ? `🔥 ${f.currentStreak}W`
    : f.currentStreak < -2
    ? `❄️ ${Math.abs(f.currentStreak)}L`
    : f.currentStreak > 0
    ? `+${f.currentStreak}W`
    : f.currentStreak < 0
    ? `${f.currentStreak}L`
    : "—";

  const accentBorder = side === "left"
    ? { borderLeft: `3px solid ${f.color}` }
    : { borderRight: `3px solid ${f.color}` };

  const weaponName = f.weaponId.replace(/_/g, " ");
  const weaponIcon = weapon ? (WEAPON_TYPE_ICON[weapon.type] ?? "❓") : "❓";

  return (
    <Link to={`/fighter/${f.id}`} style={{ ...FC.card, ...accentBorder, textDecoration: "none" }}>

      {/* Header: color dot + name */}
      <div style={FC.header}>
        <span style={{ ...FC.colorDot, background: f.color }} />
        <span style={FC.name}>{f.name}</span>
      </div>

      {/* Win / Loss record */}
      <div style={FC.section}>
        <div style={FC.sectionTitle}>RECORD</div>
        <div style={FC.wlRow}>
          <span style={FC.wins}>{f.wins}W</span>
          <span style={FC.losses}>{f.losses}L</span>
          <span style={FC.winRate}>{wr}%</span>
        </div>
        <div style={FC.streakRow}>
          <span style={FC.streakLabel}>Streak</span>
          <span style={FC.streakValue}>{streak}</span>
        </div>
        {(f.longestWinStreak ?? 0) > 0 && (
          <div style={FC.streakRow}>
            <span style={FC.streakLabel}>Best</span>
            <span style={FC.streakValue}>🏅 {f.longestWinStreak}W</span>
          </div>
        )}
      </div>

      {/* Ball stats */}
      <div style={FC.section}>
        <div style={FC.sectionTitle}>BALL</div>
        <CardRow label="HP" value={f.baseHp} />
        <CardRow label="Size" value={f.radius} />
        {(f.totalDamageDealt ?? 0) > 0 && (
          <CardRow label="Dealt" value={f.totalDamageDealt.toLocaleString()} />
        )}
        {(f.totalDamageTaken ?? 0) > 0 && (
          <CardRow label="Taken" value={f.totalDamageTaken.toLocaleString()} />
        )}
      </div>

      {/* Weapon stats */}
      <div style={FC.section}>
        <div style={FC.sectionTitle}>WEAPON</div>
        <div style={FC.weaponName}>{weaponIcon} {weaponName}</div>
        {weapon && (
          <>
            <CardRow label="Type" value={weapon.type} />
            {weapon.baseDamage !== undefined && <CardRow label="DMG" value={weapon.baseDamage} />}
            <CardRow label="Reach" value={weapon.reach} />
            {weapon.omega !== undefined && (
              <CardRow label="Spin" value={`${Math.round(weapon.omega / 100) / 10}k`} />
            )}
            {weapon.weight !== undefined && (
              <CardRow label="Weight" value={weapon.weight} />
            )}
          </>
        )}
      </div>
    </Link>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const C = {
  bg:      "#000000",
  panel:   "#0a0f0b",
  border:  "#0d2a1c",
  text:    "#4DFF91",
  muted:   "#1a5530",
  accent:  "#FF3D00",
  win:     "#4DFF91",
};

/** Fighter card styles */
const FC: Record<string, React.CSSProperties> = {
  card: {
    width: 148,
    flexShrink: 0,
    background: C.panel,
    border: `1px solid ${C.border}`,
    padding: "10px 8px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    alignSelf: "flex-start",
    color: C.text,
  },
  placeholder: {
    width: 148,
    flexShrink: 0,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    borderBottom: `1px solid ${C.border}`,
    paddingBottom: 7,
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    flexShrink: 0,
  },
  name: {
    fontSize: 11,
    fontWeight: "bold",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    color: C.text,
  },
  section: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 3,
  },
  sectionTitle: {
    fontSize: 8,
    letterSpacing: 2,
    color: C.muted,
    marginBottom: 1,
    textTransform: "uppercase" as const,
  },
  // W/L record row
  wlRow: {
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  wins: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#4DFF91",
  },
  losses: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#FF3D00",
  },
  winRate: {
    fontSize: 10,
    color: "#4a5a4e",
    marginLeft: "auto",
  },
  streakRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  streakLabel: {
    fontSize: 9,
    color: C.muted,
  },
  streakValue: {
    fontSize: 10,
    color: C.text,
  },
  // Generic stat row
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rowLabel: {
    fontSize: 9,
    color: C.muted,
  },
  rowValue: {
    fontSize: 10,
    color: C.text,
    textAlign: "right" as const,
  },
  weaponName: {
    fontSize: 10,
    fontWeight: "bold",
    color: "#4DFF91",
    whiteSpace: "nowrap" as const,
    overflow: "hidden",
    textOverflow: "ellipsis",
    marginBottom: 2,
  },
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
    height: 24,
    flexShrink: 0,
  },
  arenaLabel: {
    flex: 1,
    textAlign: "center" as const,
    fontFamily: "'Orbitron', sans-serif",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.2em",
    color: "#4DFF91",
    minWidth: 120,
  },
  liveChip: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    fontSize: 11,
    fontFamily: "'Courier New', Courier, monospace",
    color: "#4a5a4e",
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

  // Arena panel — column, centered
  arenaPanel: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    padding: "16px 12px",
    borderRight: `1px solid ${C.border}`,
    gap: 10,
  },

  // Horizontal row: left-card | center-col | right-card
  canvasRow: {
    display: "flex",
    flexDirection: "row" as const,
    alignItems: "flex-start",
    gap: 10,
    width: "100%",
    justifyContent: "center",
  },

  // Center column: VS strip + canvas
  centerCol: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },

  // VS strip above canvas
  vsStrip: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    gap: 6,
  },
  vsName: {
    fontSize: 10,
    fontWeight: "bold",
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  vsText: {
    fontSize: 11,
    fontFamily: "'Orbitron', sans-serif",
    fontWeight: 700,
    color: "#FF3D00",
    flexShrink: 0,
  },

  canvasWrap: {
    overflow: "hidden",
    border: `1px solid ${C.border}`,
  },
  announcement: {
    fontSize: 11,
    color: "#4a5a4e",
    fontStyle: "italic",
    textAlign: "center" as const,
    maxWidth: 660,
    lineHeight: 1.6,
    margin: 0,
  },
  resultCard: {
    background: C.panel,
    border: `1px solid #1a5530`,
    padding: "12px 16px",
    width: "100%",
    maxWidth: 660,
    textAlign: "center" as const,
  },
  resultTitle: {
    fontSize: 16,
    fontWeight: "bold",
    fontFamily: "'Orbitron', sans-serif",
    color: "#4DFF91",
    textShadow: "0 0 8px rgba(77,255,145,0.30)",
    marginBottom: 4,
  },
  resultMeta: {
    fontSize: 11,
    color: "#4a5a4e",
    marginBottom: 8,
  },
  commentary: {
    fontSize: 11,
    color: "#4a5a4e",
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
    padding: "12px 10px",
  },
  panelToggle: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    background: "none",
    border: "none",
    borderBottom: `1px solid ${C.border}`,
    padding: "0 0 8px 0",
    marginBottom: 10,
    cursor: "pointer",
    color: "#4DFF91",
    fontSize: 10,
    letterSpacing: "0.2em",
    textTransform: "uppercase" as const,
    fontFamily: "'Orbitron', sans-serif",
    fontWeight: 700,
  },
  chevron: {
    fontSize: 9,
    color: C.muted,
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
  rank: { color: C.muted, width: 22, textAlign: "right" as const, flexShrink: 0 },
  colorDot: {
    display: "inline-block",
    width: 10,
    height: 10,
    borderRadius: "50%",
    flexShrink: 0,
  },
  leaderName: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, fontSize: 11 },
  leaderStats: { fontSize: 10, color: "#4a5a4e", flexShrink: 0, whiteSpace: "nowrap" as const },
  wr: { color: "#4DFF91" },
  streak: { fontSize: 10, color: "#FF3D00", flexShrink: 0 },

  // Recent results — full-width scrollable card strip below main grid
  resultsSection: {
    borderTop: `1px solid ${C.border}`,
    padding: "14px 16px 0",
    background: C.panel,
  },
  resultsScroll: {
    display: "flex",
    flexDirection: "row" as const,
    gap: 10,
    overflowX: "auto" as const,
    paddingBottom: 14,
    scrollbarWidth: "thin" as const,
  },
  resultCard2: {
    flex: "0 0 200px",
    background: C.bg,
    border: `1px solid ${C.border}`,
    padding: "10px 12px",
    textDecoration: "none",
    color: C.text,
    display: "flex",
    flexDirection: "column" as const,
    gap: 5,
    transition: "border-color 0.15s",
    cursor: "pointer",
  },
  resultCardTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  resultCardBody: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 6,
  },
  resultCardFooter: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 2,
    borderTop: `1px solid ${C.border}`,
    paddingTop: 5,
  },
  matchId:     { color: C.muted, fontSize: 10 },
  winnerText:  { fontSize: 12, fontWeight: "bold" as const, color: "#4DFF91", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, flex: 1 },
  loserText:   { fontSize: 11, color: "#4a5a4e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, flex: 1 },
  weaponBadge: { fontSize: 9, color: "#4a5a4e", background: "#111a12", padding: "1px 4px", flexShrink: 0, whiteSpace: "nowrap" as const },
  durText:     { fontSize: 10, color: "#4a5a4e" },
  viewReplay:  { fontSize: 10, color: "#FF3D00" },
  resultMeta2: { fontSize: 10, color: "#4a5a4e" },

  // Hidden arena — offscreen 1080×1890 canvas for recording (4:7 portrait).
  // IMPORTANT: do NOT use opacity:0 or z-index:-1 — Chrome's compositor skips
  // rendering layers with those properties, producing blank captureStream() frames.
  // transform:translateX(-9999px) keeps the element fully off-screen while
  // remaining in the normal compositor render path.
  hiddenArenaWrap: {
    position: "fixed" as const,
    top: 0,
    left: 0,
    transform: "translateX(-9999px)",
    width: 1080,
    height: 1890,
    pointerEvents: "none" as const,
  },
};
