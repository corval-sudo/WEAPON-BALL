// web/src/pages/Record.tsx
// Headless recording page: /record?matchId=X
// Fetches replay data from the API, replays through PhaserArena at 1080x1890,
// captures via MediaRecorder, auto-uploads to /recordings/upload,
// and signals completion via window.__recordingComplete for Puppeteer.
//
// This page is designed to be opened by Puppeteer in headless mode.
// It has no UI controls — everything is automated.

import { useEffect, useRef, useState } from "react";
import { PhaserArena } from "../components/PhaserArena";
import { MatchRecorder } from "../recorder/MatchRecorder";
import type { TickFrame, WeaponDef } from "../hooks/useArenaSocket";

const API = import.meta.env["VITE_API_URL"] ?? "http://localhost:3001";

// Frame playback rate — 30fps (33ms per frame)
const FRAME_INTERVAL_MS = 33;
// Hold on winner overlay for 3 seconds after last frame
const WINNER_HOLD_MS = 3000;

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
  winner: "A" | "B";
  frames: TickFrame[];
}

type Status = "loading" | "playing" | "uploading" | "done" | "error";

declare global {
  interface Window {
    __recordingComplete?: boolean;
    __recordingMp4Url?: string;
  }
}

export default function RecordPage() {
  const params = new URLSearchParams(window.location.search);
  const matchId = params.get("matchId");

  const [status, setStatus] = useState<Status>("loading");
  const [replay, setReplay] = useState<ReplayData | null>(null);
  const [currentFrame, setCurrentFrame] = useState<TickFrame | null>(null);
  const [winner, setWinner] = useState<"A" | "B" | null>(null);

  const recorderRef = useRef(new MatchRecorder());
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasReadyRef = useRef(false);
  const recordingStartedRef = useRef(false);

  // Step 1: Fetch replay data
  useEffect(() => {
    if (!matchId) {
      setStatus("error");
      return;
    }

    fetch(`${API}/api/matches/${matchId}/replay`)
      .then(r => {
        if (!r.ok) throw new Error(`Replay fetch failed: ${r.status}`);
        return r.json();
      })
      .then((data: ReplayData) => {
        setReplay(data);
      })
      .catch(err => {
        console.error("[Record] Failed to fetch replay:", err);
        setStatus("error");
      });
  }, [matchId]);

  // Step 2: When canvas is ready and replay loaded, start recording and playback
  const onCanvasReady = (canvas: HTMLCanvasElement) => {
    canvasReadyRef.current = true;
    console.log(`[Record] Canvas ready: ${canvas.width}x${canvas.height}`);
  };

  useEffect(() => {
    if (!replay || !canvasReadyRef.current || recordingStartedRef.current) return;

    // Find the canvas in the container
    const canvas = containerRef.current?.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canvas) return;

    recordingStartedRef.current = true;
    setStatus("playing");

    // Start recording
    recorderRef.current.start(canvas, replay.matchId, replay.ballAName, replay.ballBName);
    console.log("[Record] Recording started, beginning frame playback");

    // Play frames at 30fps
    let frameIdx = 0;
    const playTimer = setInterval(() => {
      if (frameIdx >= replay.frames.length) {
        clearInterval(playTimer);

        // Show winner overlay
        setWinner(replay.winner);
        console.log(`[Record] Playback complete, holding winner for ${WINNER_HOLD_MS}ms`);

        // Hold for winner banner, then stop recording and upload
        setTimeout(async () => {
          try {
            const recording = await recorderRef.current.stop(replay.winner);
            setStatus("uploading");
            console.log(`[Record] Recording stopped: ${(recording.blob?.size ?? 0) / 1e6}MB`);

            // Upload WebM to server
            if (recording.blob) {
              const formData = new FormData();
              formData.append("recording", recording.blob, recording.localFilename);
              formData.append("matchId", String(replay.matchId));
              formData.append("nameA", replay.ballAName);
              formData.append("nameB", replay.ballBName);
              formData.append("winner", replay.winner);

              const uploadRes = await fetch(`${API}/recordings/upload`, {
                method: "POST",
                body: formData,
              });

              if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);
              const { mp4Url } = await uploadRes.json();

              console.log(`[Record] Upload complete: ${mp4Url}`);
              window.__recordingMp4Url = mp4Url;
            }

            setStatus("done");
            window.__recordingComplete = true;
            console.log("[Record] Done — signaling Puppeteer");
          } catch (err) {
            console.error("[Record] Upload error:", err);
            setStatus("error");
            // Still signal completion on error so Puppeteer doesn't hang
            window.__recordingComplete = true;
          }
        }, WINNER_HOLD_MS);

        return;
      }

      setCurrentFrame(replay.frames[frameIdx]);
      frameIdx++;
    }, FRAME_INTERVAL_MS);

    return () => clearInterval(playTimer);
  }, [replay, canvasReadyRef.current]);

  if (status === "error") {
    return <div style={{ color: "red", padding: 20 }}>Recording failed. matchId={matchId}</div>;
  }

  return (
    <div ref={containerRef} style={{ width: 1080, height: 1890, background: "#000" }}>
      {replay && (
        <PhaserArena
          frame={currentFrame}
          ballAName={replay.ballAName}
          ballBName={replay.ballBName}
          ballAColor={replay.ballAColor}
          ballBColor={replay.ballBColor}
          ballAHp={replay.ballAHp}
          ballBHp={replay.ballBHp}
          ballARadius={replay.ballARadius}
          ballBRadius={replay.ballBRadius}
          weaponA={replay.weaponA}
          weaponB={replay.weaponB}
          width={1080}
          height={1890}
          recordingMode={true}
          preserveDrawingBuffer={true}
          winner={winner}
          onCanvasReady={onCanvasReady}
        />
      )}
      <div id="recording-status" style={{ position: "absolute", top: 0, left: 0, color: "#fff", fontSize: 12, opacity: 0.3 }}>
        {status}
      </div>
    </div>
  );
}
