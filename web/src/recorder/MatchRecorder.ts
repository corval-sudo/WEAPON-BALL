// web/src/recorder/MatchRecorder.ts
// Captures a hidden 1920×1080 Phaser canvas to a WebM blob via MediaRecorder.
// Used by the admin panel to produce social-ready match recordings.

const RECORDING_BITRATE = 1_000_000; // 1 Mbps — plenty for simple 2D procedural content

// ─── Types ────────────────────────────────────────────────────────────────────

/** Metadata stored in localStorage and in the session recordings list. */
export interface RecordingMeta {
  matchId: number;
  timestamp: string;        // ISO — also used to build the filename
  nameA: string;
  nameB: string;
  winner: string;           // "A" | "B"
  localFilename: string;    // worbz-match-{id}-{ts}.webm
  mp4Url?: string;          // set after a successful server upload
}

/** In-memory extension that carries the blob for the current session. */
export interface RuntimeRecording extends RecordingMeta {
  blob?: Blob;              // present until page refresh; not persisted
}

// ─── Class ────────────────────────────────────────────────────────────────────

export class MatchRecorder {
  private mr: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private activeMeta: Omit<RecordingMeta, "localFilename"> | null = null;

  // ── Canvas resolution guard ───────────────────────────────────────────────

  /**
   * Finds the Phaser canvas inside a container div.
   * Logs its actual pixel dimensions so you can verify it's 1920×1080 before
   * starting the recorder.
   */
  static resolveCanvas(container: HTMLElement): HTMLCanvasElement | null {
    const canvas = container.querySelector("canvas") as HTMLCanvasElement | null;
    if (canvas) {
      console.log(
        `[MatchRecorder] Canvas dimensions: ${canvas.width}×${canvas.height}`,
      );
      if (canvas.width !== 1080 || canvas.height !== 1890) {
        console.warn(
          `[MatchRecorder] ⚠ Canvas is ${canvas.width}×${canvas.height}, ` +
          `not 1080×1890 — recording may be distorted.`,
        );
      }
    }
    return canvas;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  start(canvas: HTMLCanvasElement, matchId: number, nameA: string, nameB: string): void {
    if (this.mr?.state === "recording") {
      console.warn("[MatchRecorder] Already recording — ignoring start()");
      return;
    }

    this.chunks = [];
    this.activeMeta = {
      matchId,
      timestamp: new Date().toISOString(),
      nameA,
      nameB,
      winner: "",
    };

    const stream = canvas.captureStream(30);

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";

    this.mr = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: RECORDING_BITRATE,
    });

    this.mr.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };

    this.mr.start(100); // flush data every 100 ms
    console.log(`[MatchRecorder] Started — ${mimeType} @ ${RECORDING_BITRATE / 1e6} Mbps`);
  }

  /** Stop recording and resolve with the completed RuntimeRecording. */
  stop(winner: string): Promise<RuntimeRecording> {
    return new Promise((resolve, reject) => {
      if (!this.mr || !this.activeMeta) {
        reject(new Error("[MatchRecorder] No active recording to stop"));
        return;
      }

      this.activeMeta.winner = winner;

      this.mr.onstop = () => {
        const blob = new Blob(this.chunks, { type: "video/webm" });
        const ts = this.activeMeta!.timestamp.replace(/[:.]/g, "-");
        const localFilename = `worbz-match-${this.activeMeta!.matchId}-${ts}.webm`;

        const result: RuntimeRecording = {
          ...this.activeMeta!,
          localFilename,
          blob,
        };

        console.log(
          `[MatchRecorder] Stopped — ${(blob.size / 1e6).toFixed(1)} MB → ${localFilename}`,
        );
        resolve(result);
      };

      this.mr.stop();
    });
  }

  // ── Download helper ───────────────────────────────────────────────────────

  static download(recording: RuntimeRecording): void {
    if (!recording.blob) {
      console.warn("[MatchRecorder] No blob available for download (page refreshed?)");
      return;
    }
    const url = URL.createObjectURL(recording.blob);
    const a   = Object.assign(document.createElement("a"), {
      href:     url,
      download: recording.localFilename,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  // ── State ─────────────────────────────────────────────────────────────────

  get isRecording(): boolean {
    return this.mr?.state === "recording";
  }
}

// ─── localStorage persistence ─────────────────────────────────────────────────

const LS_KEY = "worbz-recordings";

export function loadStoredRecordings(): RecordingMeta[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]") as RecordingMeta[];
  } catch {
    return [];
  }
}

export function saveRecordingMeta(meta: RecordingMeta): void {
  const existing = loadStoredRecordings();
  // Upsert by matchId + timestamp
  const idx = existing.findIndex(
    r => r.matchId === meta.matchId && r.timestamp === meta.timestamp,
  );
  if (idx >= 0) existing[idx] = meta;
  else existing.unshift(meta);            // newest first
  localStorage.setItem(LS_KEY, JSON.stringify(existing.slice(0, 50)));  // cap at 50
}
