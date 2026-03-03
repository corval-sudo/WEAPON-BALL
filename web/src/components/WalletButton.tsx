// web/src/components/WalletButton.tsx
// Wallet connect button styled to match the WORBZ dark monospace aesthetic.
// Uses wagmi hooks directly — no RainbowKit or ConnectKit.

import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";

// ── Design tokens (mirror Dashboard.tsx C palette) ────────────────────────────
const C = {
  panel:  "#0e0e1a",
  border: "#1c1c2e",
  accent: "#7c4dff",
  green:  "#4caf50",
  text:   "#e0e0ff",
  muted:  "#555588",
};
const FONT = "'Courier New', Courier, monospace";

// ── Helpers ────────────────────────────────────────────────────────────────────

function shortAddr(addr: string): string {
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

// ── Component ──────────────────────────────────────────────────────────────────

export function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Close dropdown after successful connection
  useEffect(() => {
    if (isConnected) setOpen(false);
  }, [isConnected]);

  const connected = isConnected && address;

  return (
    <div ref={wrapRef} style={S.wrap}>
      {/* ── Main trigger button ── */}
      <button
        style={{
          ...S.btn,
          borderColor: connected ? C.green : C.accent,
          color:       connected ? C.green : C.accent,
        }}
        onClick={() => setOpen(o => !o)}
      >
        {isPending
          ? "CONNECTING…"
          : connected
            ? shortAddr(address)
            : "CONNECT WALLET"}
      </button>

      {/* ── Dropdown ── */}
      {open && (
        <div style={S.dropdown}>
          {connected ? (
            // Connected state: show address + disconnect
            <>
              <div style={S.dropAddr}>{address}</div>
              <button
                style={{ ...S.dropBtn, color: "#f44336", borderColor: "#f44336" }}
                onClick={() => { disconnect(); setOpen(false); }}
              >
                DISCONNECT
              </button>
            </>
          ) : (
            // Disconnected state: list available connectors
            <>
              <div style={S.dropLabel}>SELECT WALLET</div>
              {connectors.map(connector => (
                <button
                  key={connector.uid}
                  style={S.dropBtn}
                  onClick={() => connect({ connector })}
                  disabled={isPending}
                >
                  {connector.name.toUpperCase()}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  wrap: {
    position: "relative",
    flexShrink: 0,
  },
  btn: {
    background: "transparent",
    border: "1px solid",
    borderRadius: 3,
    padding: "4px 10px",
    fontFamily: FONT,
    fontSize: 11,
    letterSpacing: 2,
    cursor: "pointer",
    flexShrink: 0,
    transition: "opacity 0.15s",
  },
  dropdown: {
    position: "absolute",
    top: "calc(100% + 6px)",
    right: 0,
    background: C.panel,
    border: `1px solid ${C.border}`,
    borderRadius: 4,
    padding: "8px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minWidth: 180,
    zIndex: 1000,
    boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
  },
  dropLabel: {
    fontSize: 9,
    letterSpacing: 2,
    color: C.muted,
    fontFamily: FONT,
    paddingBottom: 4,
    borderBottom: `1px solid ${C.border}`,
    marginBottom: 2,
  },
  dropAddr: {
    fontSize: 9,
    color: C.muted,
    fontFamily: FONT,
    wordBreak: "break-all",
    paddingBottom: 6,
    borderBottom: `1px solid ${C.border}`,
    marginBottom: 2,
  },
  dropBtn: {
    background: "transparent",
    border: `1px solid ${C.accent}`,
    borderRadius: 3,
    padding: "5px 10px",
    fontFamily: FONT,
    fontSize: 11,
    letterSpacing: 1,
    color: C.accent,
    cursor: "pointer",
    textAlign: "left",
    width: "100%",
  },
};
