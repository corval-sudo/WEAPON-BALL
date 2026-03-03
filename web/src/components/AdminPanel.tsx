// web/src/components/AdminPanel.tsx
// Admin-only recording control panel.
// Rendered only when VITE_ADMIN_MODE=true.
//
// Features:
//   - "Record Next Match" toggle — arms the recorder for the next match only
//   - "Record All Matches" toggle — records every subsequent match
//   - Session recordings list (matchId, timestamp, fighter names, winner)
//   - Download button — triggers local WebM download
//   - Upload button — POST to /recordings/upload, awaits ffmpeg→mp4 conversion
//   - Replaces Download+Upload with a direct mp4 URL link on successful upload

import { useState } from "react";
import { MatchRecorder } from "../recorder/MatchRecorder";
import type { RuntimeRecording } from "../recorder/MatchRecorder";

const API = import.meta.env["VITE_API_URL"] ?? "http://localhost:3001";

// ─── Props ────────────────────────────────────────────────────────────────────

interface AdminPanelProps {
  recordNextMatch:    boolean;
  recordAllMatches:   boolean;
  isRecording:        boolean;
  recordings:         RuntimeRecording[];
  onToggleNextMatch:  (v: boolean) => void;
  onToggleAllMatches: (v: boolean) => void;
  onRecordingsChange: (recordings: RuntimeRecording[]) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AdminPanel({
  recordNextMatch,
  recordAllMatches,
  isRecording,
  recordings,
  onToggleNextMatch,
  onToggleAllMatches,
  onRecordingsChange,
}: AdminPanelProps) {
  const [uploading, setUploading] = useState<Set<string>>(new Set());

  function recKey(r: RuntimeRecording): string {
    return `${r.matchId}-${r.timestamp}`;
  }

  function handleDownload(r: RuntimeRecording): void {
    MatchRecorder.download(r);
  }

  async function handleUpload(r: RuntimeRecording): Promise<void> {
    if (!r.blob) {
      alert("No blob available — page may have been refreshed since recording.");
      return;
    }
    const key = recKey(r);
    setUploading(prev => new Set(prev).add(key));

    try {
      const formData = new FormData();
      formData.append("recording", r.blob, r.localFilename);
      formData.append("matchId",   String(r.matchId));
      formData.append("nameA",     r.nameA);
      formData.append("nameB",     r.nameB);
      formData.append("winner",    r.winner);

      const res = await fetch(`${API}/recordings/upload`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? res.statusText);
      }

      const { mp4Url } = await res.json() as { mp4Url: string };
      // mp4Url is a relative path ("/recordings/...") — prepend the API origin
      // so the link points at the backend, not the Vite dev server.
      const fullMp4Url = `${API}${mp4Url}`;

      const updated = recordings.map(rec =>
        recKey(rec) === key ? { ...rec, mp4Url: fullMp4Url } : rec
      );
      onRecordingsChange(updated);
    } catch (e: any) {
      alert(`Upload failed: ${e.message}`);
    } finally {
      setUploading(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  const isUploadingAny = uploading.size > 0;

  return (
    <div style={P.panel}>
      {/* Header */}
      <div style={P.header}>
        <span style={P.title}>🎬 ADMIN</span>
        {isRecording && <span style={P.recDot}>● REC</span>}
      </div>

      {/* Recording toggles */}
      <div style={P.toggleSection}>
        <label style={P.toggleLabel}>
          <input
            type="checkbox"
            checked={recordNextMatch}
            disabled={recordAllMatches}
            onChange={e => onToggleNextMatch(e.target.checked)}
          />
          <span style={{ marginLeft: 6 }}>Record Next Match</span>
        </label>
        <label style={P.toggleLabel}>
          <input
            type="checkbox"
            checked={recordAllMatches}
            onChange={e => onToggleAllMatches(e.target.checked)}
          />
          <span style={{ marginLeft: 6 }}>Record All Matches</span>
        </label>
      </div>

      {/* Session recordings list */}
      <div style={P.listHeader}>
        RECORDINGS ({recordings.length})
        {isUploadingAny && <span style={P.uploadingText}> ↑ uploading…</span>}
      </div>

      <div style={P.list}>
        {recordings.length === 0 && (
          <div style={P.empty}>No recordings yet.</div>
        )}
        {recordings.map((r, i) => {
          const key       = recKey(r);
          const isUp      = uploading.has(key);
          const winnerName = r.winner === "A" ? r.nameA : r.nameB;
          return (
            <div key={i} style={P.item}>
              <div style={P.itemMeta}>
                <span style={P.itemId}>#{r.matchId}</span>
                <span style={P.itemTime}>
                  {new Date(r.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <div style={P.itemNames}>{r.nameA} vs {r.nameB}</div>
              <div style={P.itemWinner}>🏆 {winnerName}</div>
              <div style={P.itemActions}>
                {r.mp4Url ? (
                  <a href={r.mp4Url} target="_blank" rel="noreferrer" style={P.mp4Link}>
                    ▶ mp4
                  </a>
                ) : (
                  <>
                    <button style={P.btn} onClick={() => handleDownload(r)} disabled={isUp}>
                      ↓ webm
                    </button>
                    {r.blob && (
                      <button
                        style={{ ...P.btn, ...P.btnUpload }}
                        onClick={() => handleUpload(r)}
                        disabled={isUp}
                      >
                        {isUp ? "↑ …" : "↑ upload"}
                      </button>
                    )}
                    {!r.blob && (
                      <span style={P.noBlobNote}>no blob</span>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const C = {
  bg:     "#07070f",
  panel:  "#0e0e1a",
  border: "#1c1c2e",
  text:   "#e0e0ff",
  muted:  "#555588",
  red:    "#f44336",
  accent: "#7c4dff",
};

const P: Record<string, React.CSSProperties> = {
  panel: {
    background: C.panel,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: "12px 10px",
    marginTop: 10,
    fontFamily: "'Courier New', Courier, monospace",
    color: C.text,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottom: `1px solid ${C.border}`,
    paddingBottom: 8,
    marginBottom: 10,
  },
  title: {
    fontSize: 11,
    fontWeight: "bold",
    letterSpacing: 2,
    color: "#666688",
    textTransform: "uppercase" as const,
  },
  recDot: {
    fontSize: 10,
    color: C.red,
    fontWeight: "bold",
    animation: "pulse 1s infinite",
  },
  toggleSection: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
    marginBottom: 10,
  },
  toggleLabel: {
    display: "flex",
    alignItems: "center",
    fontSize: 11,
    color: C.text,
    cursor: "pointer",
  },
  listHeader: {
    fontSize: 9,
    letterSpacing: 2,
    color: C.muted,
    textTransform: "uppercase" as const,
    marginBottom: 6,
  },
  uploadingText: {
    color: "#ff9800",
  },
  list: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
    maxHeight: 300,
    overflowY: "auto" as const,
  },
  empty: {
    fontSize: 10,
    color: C.muted,
    fontStyle: "italic",
    padding: "4px 0",
  },
  item: {
    background: C.bg,
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    padding: "7px 8px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 3,
  },
  itemMeta: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  itemId: {
    fontSize: 9,
    color: C.muted,
  },
  itemTime: {
    fontSize: 9,
    color: C.muted,
  },
  itemNames: {
    fontSize: 10,
    color: C.text,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  itemWinner: {
    fontSize: 10,
    color: "#ffd700",
  },
  itemActions: {
    display: "flex",
    gap: 5,
    marginTop: 2,
  },
  btn: {
    fontSize: 9,
    padding: "2px 7px",
    background: "#1c1c2e",
    border: `1px solid ${C.border}`,
    borderRadius: 4,
    color: C.text,
    cursor: "pointer",
    fontFamily: "'Courier New', Courier, monospace",
  },
  btnUpload: {
    color: "#7c4dff",
    borderColor: "#3a2a6e",
  },
  mp4Link: {
    fontSize: 9,
    color: "#4caf50",
    textDecoration: "none",
    border: `1px solid #1e3a1e`,
    borderRadius: 4,
    padding: "2px 7px",
    background: "#0a1a0a",
  },
  noBlobNote: {
    fontSize: 9,
    color: C.muted,
    fontStyle: "italic",
  },
};
