// web/src/pages/Dashboard.tsx
// C1 "Command Center" layout: left fighters panel | center arena | right stats panel
// Compact leaderboard on the left, match stats + admin on the right, feed ticker at bottom.

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useArenaSocket } from "../hooks/useArenaSocket";
// WeaponDef used by PhaserArena props (passed through from arena state)
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
  ballA: { id: string; name: string; weaponId: string; wins: number; losses: number; currentStreak: number; longestWinStreak: number; baseHp: number; radius: number; color: string; totalDamageDealt: number; totalDamageTaken: number };
  ballB: { id: string; name: string; weaponId: string; wins: number; losses: number; currentStreak: number; longestWinStreak: number; baseHp: number; radius: number; color: string; totalDamageDealt: number; totalDamageTaken: number };
  startsAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtCountdown(secs: number): string {
  if (secs <= 0) return "0s";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const arena = useArenaSocket();
  const [fighters, setFighters]       = useState<LeaderboardFighter[]>([]);
  const [matches, setMatches]         = useState<RecentMatch[]>([]);
  const [countdown, setCountdown]     = useState(0);
  const [nextMatch, setNextMatch]     = useState<NextMatchInfo | null>(null);

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

  // Keep recordAllRef in sync
  useEffect(() => { recordAllRef.current = recordAllMatches; }, [recordAllMatches]);

  // Mount hidden arena when recording is armed
  useEffect(() => {
    if (recordNextMatch || recordAllMatches) {
      console.log("[REC] Recording armed — mounting hidden arena");
      setShowHiddenArena(true);
    }
  }, [recordNextMatch, recordAllMatches]);

  // Reset canvas-ready flag when hidden arena torn down
  useEffect(() => {
    if (!showHiddenArena) setHiddenCanvasReady(false);
  }, [showHiddenArena]);

  // Start recording when match goes live AND hidden canvas is ready
  useEffect(() => {
    if (arena.phase !== "live") return;
    if (recordingActiveRef.current || recorderRef.current.isRecording) return;
    if (!hiddenCanvasReady) {
      console.warn("[REC] Phase is live but canvas not ready yet");
      return;
    }
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
    if (recordNextMatch && !recordAllMatches) setRecordNextMatch(false);
  }, [arena.phase, arena.matchNumber, hiddenCanvasReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop recording when match ends (delay 3s for winner overlay)
  useEffect(() => {
    if (arena.phase !== "result" || !recordingActiveRef.current) return;
    const timer = setTimeout(() => {
      recordingActiveRef.current = false;
      recorderRef.current.stop(arena.winner ?? "?").then(rec => {
        saveRecordingMeta(rec);
        setRecordings(prev => [rec, ...prev]);
        setIsRecording(false);
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

  // ── Derived values for C1 layout ────────────────────────────────────────────
  const elapsedSecs = arena.phase === "live" && arena.currentFrame
    ? Math.floor(arena.currentFrame.tick / 30)
    : 0;

  const timerLabel =
    arena.phase === "live"
      ? `T+${String(Math.floor(elapsedSecs / 60)).padStart(2, "0")}:${String(elapsedSecs % 60).padStart(2, "0")}`
      : arena.phase === "countdown"
      ? fmtCountdown(countdown)
      : arena.phase === "result"
      ? `MATCH #${arena.matchNumber}`
      : countdown === -1
      ? "STARTING SOON"
      : countdown > 0
      ? fmtCountdown(countdown)
      : "";

  const phaseLabel =
    arena.phase === "live" ? "LIVE" :
    arena.phase === "countdown" ? "STARTING" :
    arena.connected ? "IDLE" :
    "OFFLINE";

  return (
    <div style={S.page}>

      {/* ── C1 Top bar ────────────────────────────────────────────────── */}
      <header style={S.topbar} className="worbz-topbar">
        <div style={S.topbarBrand}>
          <img src="/brand/worbz-mark-final.svg" alt="" style={S.topbarMark} />
          <img src="/brand/worbz-wordmark-short.svg" alt="WORBZ" style={S.topbarWordmark} />
        </div>
        <div style={S.topbarCenter}>
          <span style={{ ...S.dot, background: arena.connected ? "#4DFF91" : "#FF3D00" }} />
          <span style={{
            ...S.topbarPhase,
            color: arena.phase === "live" ? "#FF3D00" : "#4DFF91",
          }}>{phaseLabel}</span>
        </div>
        <span style={S.topbarTimer}>{timerLabel}</span>
      </header>

      {/* ── C1 Body: left panel | arena | right panel ─────────────────── */}
      <div style={S.c1Body} className="worbz-c1-body">

        {/* ── Left panel: fighters leaderboard ──────────────────────── */}
        <aside style={S.c1Left} className="worbz-c1-left">
          <div style={S.panelLabel}>FIGHTERS</div>
          {fighters.slice(0, 15).map(f => {
            const isA = f.id === ballA?.id;
            const isB = f.id === ballB?.id;
            const isActive = isA || isB;
            let hpPercent: number | undefined;
            if (arena.phase === "live" && arena.currentFrame) {
              if (isA) hpPercent = Math.max(0, arena.currentFrame.a.hp) / (ballA?.baseHp ?? 500);
              if (isB) hpPercent = Math.max(0, arena.currentFrame.b.hp) / (ballB?.baseHp ?? 500);
            }
            return (
              <CompactFighter
                key={f.id}
                f={f}
                isActive={isActive}
                hpPercent={isActive ? hpPercent : undefined}
              />
            );
          })}
        </aside>

        {/* ── Center: arena ─────────────────────────────────────────── */}
        <div style={S.c1Arena} className="worbz-c1-arena">
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
                {(arena.ticks / 30).toFixed(1)}s
                {countdown === -1 ? " · starting soon" : countdown > 0 ? ` · ${fmtCountdown(countdown)} until next` : ""}
              </div>
              {arena.commentary && <p style={S.commentary}>{arena.commentary}</p>}
            </div>
          )}
        </div>

        {/* ── Right panel: match stats + admin ──────────────────────── */}
        <aside style={S.c1Right} className="worbz-c1-right">
          <StatBlock label="MATCH" value={arena.matchNumber ? `#${arena.matchNumber}` : "—"} />
          <StatBlock label="STATUS" value={phaseLabel} accent={arena.phase === "live"} />
          <div style={S.statDivider} />

          {arena.phase === "live" && arena.currentFrame && ballA && (
            <StatBlock
              label={ballA.name}
              value={`${Math.max(0, arena.currentFrame.a.hp)} HP`}
              accent={arena.currentFrame.a.hp < (ballA.baseHp ?? 500) * 0.25}
            />
          )}
          {arena.phase === "live" && arena.currentFrame && ballB && (
            <StatBlock
              label={ballB.name}
              value={`${Math.max(0, arena.currentFrame.b.hp)} HP`}
              accent={arena.currentFrame.b.hp < (ballB.baseHp ?? 500) * 0.25}
            />
          )}
          {arena.phase === "live" && arena.currentFrame && (
            <>
              <div style={S.statDivider} />
              <StatBlock label="TIME" value={`${elapsedSecs}s`} />
            </>
          )}

          {arena.phase !== "live" && countdown > 0 && (
            <StatBlock label="NEXT" value={fmtCountdown(countdown)} accent />
          )}
          {arena.phase !== "live" && countdown === -1 && (
            <StatBlock label="NEXT" value="SOON" accent />
          )}

          <div style={{ flex: 1 }} />

          {/* Admin panel */}
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

      {/* ── C1 Ticker: feed bar ───────────────────────────────────────── */}
      <div style={S.ticker} className="worbz-ticker">
        <span style={S.tickerLabel}>FEED</span>
        <span style={S.tickerArrow}>&#9656;</span>
        <div style={S.tickerScroll} className="worbz-ticker-scroll">
          {matches.slice(0, 12).map(m => {
            const winnerName = m.winner === "A" ? m.ball_a_name : m.ball_b_name;
            const loserName  = m.winner === "A" ? m.ball_b_name : m.ball_a_name;
            const dur = Math.floor(m.ticks / 30);
            return (
              <Link key={m.id} to={`/match/${m.id}`} style={S.tickerItem}>
                <span style={S.tickerName}>{winnerName}</span>
                {" KO'd "}
                <span style={S.tickerName}>{loserName}</span>
                {` · ${dur}s`}
              </Link>
            );
          })}
        </div>
      </div>

      {/* ── Hidden 1080×1890 Phaser instance for high-resolution recording ── */}
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

// ─── CompactFighter ──────────────────────────────────────────────────────────

function CompactFighter({
  f,
  isActive,
  hpPercent,
}: {
  f: LeaderboardFighter;
  isActive: boolean;
  hpPercent?: number;
}) {
  return (
    <Link
      to={`/fighter/${f.id}`}
      style={{
        ...S.fighterEntry,
        borderColor: isActive ? "#1a5530" : C.border,
        background: isActive ? C.panel : "transparent",
      }}
    >
      <div style={S.fighterTop}>
        <span style={{
          ...S.fighterName,
          color: isActive ? f.color : C.muted,
        }}>
          {f.name}
        </span>
        <span style={{
          ...S.fighterScore,
          color: isActive ? "#4DFF91" : C.muted,
        }}>
          {f.wins}
        </span>
      </div>
      <div style={S.hpBarBg}>
        <div style={{
          ...S.hpBarFill,
          width: `${((hpPercent ?? 1) * 100).toFixed(0)}%`,
          background: isActive
            ? (hpPercent !== undefined && hpPercent < 0.25 ? "#FF3D00" : "#4DFF91")
            : C.border,
        }} />
      </div>
    </Link>
  );
}

// ─── StatBlock ───────────────────────────────────────────────────────────────

function StatBlock({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div style={S.statBlock}>
      <div style={S.statLabel}>{label}</div>
      <div style={{
        ...S.statValue,
        color: accent ? "#FF3D00" : "#4DFF91",
      }}>
        {value}
      </div>
    </div>
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
};

const S: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: C.bg,
    color: C.text,
    fontFamily: "'Courier New', Courier, monospace",
    display: "flex",
    flexDirection: "column",
  },

  // ── C1 Topbar ──────────────────────────────────────────
  topbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 12px",
    borderBottom: `1px solid ${C.border}`,
    background: C.panel,
    flexShrink: 0,
  },
  topbarBrand: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  topbarMark: {
    height: 20,
  },
  topbarWordmark: {
    height: 14,
  },
  topbarCenter: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  topbarPhase: {
    fontFamily: "'Orbitron', sans-serif",
    fontSize: 10,
    letterSpacing: "0.15em",
    fontWeight: 700,
  },
  dot: {
    display: "inline-block",
    width: 8,
    height: 8,
    borderRadius: "50%",
  },
  topbarTimer: {
    fontFamily: "'Courier New', Courier, monospace",
    fontSize: 10,
    color: C.muted,
    letterSpacing: "0.1em",
    flexShrink: 0,
  },

  // ── C1 Body: 3-column flex ──────────────────────────────
  c1Body: {
    display: "flex",
    flexDirection: "row" as const,
    flex: 1,
    overflow: "hidden",
  },

  // ── Left panel: fighters ────────────────────────────────
  c1Left: {
    width: 160,
    flexShrink: 0,
    padding: "10px 8px",
    borderRight: `1px solid ${C.border}`,
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
    overflowY: "auto" as const,
    background: C.bg,
  },
  panelLabel: {
    fontSize: 8,
    fontFamily: "'Orbitron', sans-serif",
    fontWeight: 700,
    letterSpacing: "0.2em",
    color: C.muted,
    textTransform: "uppercase" as const,
    marginBottom: 2,
  },

  // Fighter entry
  fighterEntry: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 3,
    padding: "5px 6px",
    border: `1px solid ${C.border}`,
    textDecoration: "none",
    color: C.text,
    transition: "border-color 0.15s",
  },
  fighterTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  fighterName: {
    fontSize: 9,
    fontFamily: "'Courier New', Courier, monospace",
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    flex: 1,
  },
  fighterScore: {
    fontSize: 12,
    fontFamily: "'Orbitron', sans-serif",
    fontWeight: 700,
    flexShrink: 0,
    marginLeft: 4,
  },
  hpBarBg: {
    height: 2,
    background: C.border,
    width: "100%",
  },
  hpBarFill: {
    height: "100%",
    transition: "width 0.1s ease",
  },

  // ── Center: arena ───────────────────────────────────────
  c1Arena: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    padding: "12px 8px",
    overflow: "hidden",
    gap: 8,
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
    maxWidth: 400,
    lineHeight: 1.6,
    margin: 0,
  },
  resultCard: {
    background: C.panel,
    border: `1px solid #1a5530`,
    padding: "12px 16px",
    width: "100%",
    maxWidth: 400,
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

  // ── Right panel: stats + admin ──────────────────────────
  c1Right: {
    width: 160,
    flexShrink: 0,
    padding: "10px 8px",
    borderLeft: `1px solid ${C.border}`,
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
    overflowY: "auto" as const,
    background: C.bg,
  },
  statBlock: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 1,
  },
  statLabel: {
    fontSize: 8,
    fontFamily: "'Courier New', Courier, monospace",
    letterSpacing: "0.15em",
    color: C.muted,
    textTransform: "uppercase" as const,
  },
  statValue: {
    fontSize: 14,
    fontFamily: "'Orbitron', sans-serif",
    fontWeight: 700,
    color: "#4DFF91",
    lineHeight: 1,
  },
  statDivider: {
    height: 1,
    background: C.border,
    width: "100%",
  },

  // ── Ticker ──────────────────────────────────────────────
  ticker: {
    height: 28,
    borderTop: `1px solid ${C.border}`,
    display: "flex",
    flexDirection: "row" as const,
    alignItems: "center",
    gap: 10,
    padding: "0 12px",
    background: C.bg,
    flexShrink: 0,
    overflow: "hidden",
  },
  tickerLabel: {
    fontSize: 8,
    fontFamily: "'Orbitron', sans-serif",
    fontWeight: 700,
    letterSpacing: "0.2em",
    color: "#FF3D00",
    flexShrink: 0,
  },
  tickerArrow: {
    fontSize: 8,
    color: "#FF3D00",
    flexShrink: 0,
  },
  tickerScroll: {
    display: "flex",
    flexDirection: "row" as const,
    gap: 20,
    overflow: "hidden",
    whiteSpace: "nowrap" as const,
    flex: 1,
  },
  tickerItem: {
    fontSize: 9,
    fontFamily: "'Courier New', Courier, monospace",
    color: C.muted,
    textDecoration: "none",
    whiteSpace: "nowrap" as const,
    flexShrink: 0,
  },
  tickerName: {
    color: "#4DFF91",
  },

  // ── Hidden arena for recording ──────────────────────────
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
