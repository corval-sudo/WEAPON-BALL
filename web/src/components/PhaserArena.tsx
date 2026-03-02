// web/src/components/PhaserArena.tsx
// React wrapper that mounts a Phaser 3 Game instance for the arena visualizer.
//
// Replaces the HTML5 Canvas ArenaCanvas component.
// Key advantages over the Canvas renderer:
//   - Smooth 60fps interpolation between 30fps tick frames
//   - Phaser's scene graph (no manual pixel pushing)
//   - Easy to extend with particles / tweens for hit effects
//
// The Phaser Game is created once in useEffect and destroyed on unmount.
// Frame updates are pushed directly into the running scene via scene.updateFrame().

import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { ArenaScene } from "../phaser/ArenaScene";
import type { ArenaSceneConfig } from "../phaser/ArenaScene";
import type { TickFrame, WeaponDef } from "../hooks/useArenaSocket";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert a CSS hex string like "#4fc3f7" to a Phaser number 0x4fc3f7 */
function cssHexToNum(hex: string): number {
  return parseInt(hex.replace("#", ""), 16);
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface PhaserArenaProps {
  frame: TickFrame | null;
  ballAName: string;
  ballBName: string;
  ballAColor?: string;
  ballBColor?: string;
  ballAHp: number;
  ballBHp: number;
  ballARadius?: number;
  ballBRadius?: number;
  weaponA?: WeaponDef | null;
  weaponB?: WeaponDef | null;
  width?: number;
  height?: number;
  /** Called once after Phaser creates its canvas element (synchronous with game init). */
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PhaserArena({
  frame,
  ballAName,
  ballBName,
  ballAColor = "#4fc3f7",
  ballBColor = "#ef5350",
  ballAHp,
  ballBHp,
  ballARadius = 42,
  ballBRadius = 42,
  weaponA,
  weaponB,
  width = 380,
  height = 620,
  onCanvasReady,
}: PhaserArenaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef      = useRef<Phaser.Game | null>(null);
  const sceneRef     = useRef<ArenaScene | null>(null);

  // ── Build config object (recomputed each render) ───────────────────────────
  const cfg: ArenaSceneConfig = {
    ballAName,
    ballBName,
    ballAColor: cssHexToNum(ballAColor),
    ballBColor: cssHexToNum(ballBColor),
    ballAHp,
    ballBHp,
    ballARadius,
    ballBRadius,
    weaponA: weaponA ?? null,
    weaponB: weaponB ?? null,
    canvasW: width,
    canvasH: height,
  };

  // ── Mount Phaser once ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new ArenaScene();
    scene.updateConfig(cfg);
    sceneRef.current = scene;

    const game = new Phaser.Game({
      type: Phaser.AUTO,         // lets Phaser pick WebGL or Canvas per context
      width,
      height,
      backgroundColor: "#0a0a0f",
      parent: containerRef.current,
      scene: [scene],
      scale: {
        mode: Phaser.Scale.NONE, // We control sizing via CSS
        autoCenter: Phaser.Scale.NO_CENTER,
      },
      // Disable Phaser's default banner in console
      banner: false,
    });

    gameRef.current = game;

    // Phaser creates its <canvas> synchronously inside new Phaser.Game().
    // Notify the parent so it can start a MediaRecorder against the canvas.
    if (onCanvasReady) {
      const canvas = containerRef.current?.querySelector("canvas") as HTMLCanvasElement | null;
      if (canvas) onCanvasReady(canvas);
    }

    return () => {
      game.destroy(true);
      gameRef.current = null;
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]); // Only remount if canvas size changes

  // ── Push config updates into running scene ────────────────────────────────
  useEffect(() => {
    sceneRef.current?.updateConfig(cfg);
  });

  // ── Push new frame into scene ─────────────────────────────────────────────
  useEffect(() => {
    if (frame) {
      sceneRef.current?.updateFrame(frame);
    }
  }, [frame]);

  return (
    <div
      ref={containerRef}
      style={{ width, height, display: "block", borderRadius: 4, overflow: "hidden" }}
    />
  );
}
