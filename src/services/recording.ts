// src/services/recording.ts
// Headless recording service using Puppeteer.
// Launches Chrome, navigates to /record?matchId=X, waits for the page to
// replay the match, record it via MediaRecorder, and upload the WebM.
// Returns the converted MP4 path.
//
// Used by the post-tournament pipeline to record tournament finals for X posts.

import * as path from "node:path";

export class RecordingService {
  private frontendUrl: string;

  constructor(frontendUrl: string) {
    this.frontendUrl = frontendUrl;
  }

  /**
   * Record a match by launching headless Chrome.
   * Returns the absolute path to the converted MP4 file.
   * Throws on failure (caller handles gracefully).
   */
  async recordMatch(matchId: number): Promise<string> {
    // Dynamic import — puppeteer is an optional dependency
    const puppeteer = await import("puppeteer");

    // Use PUPPETEER_EXECUTABLE_PATH if set (e.g. Railway: /usr/bin/chromium).
    // Falls back to Puppeteer's own bundled Chromium when running locally.
    const executablePath = process.env["PUPPETEER_EXECUTABLE_PATH"] || undefined;

    const browser = await puppeteer.default.launch({
      headless: true,
      ...(executablePath && { executablePath }),
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--use-gl=swiftshader",
        "--disable-gpu-sandbox",
        "--enable-webgl",
        "--window-size=1080,1890",
      ],
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1080, height: 1890 });

      const url = `${this.frontendUrl}/record?matchId=${matchId}`;
      console.log(`[Recording] Navigating to ${url}`);

      await page.goto(url, { waitUntil: "networkidle0", timeout: 30_000 });

      // Wait for recording to complete (the page sets window.__recordingComplete)
      // Timeout after 5 minutes for long matches
      await page.waitForFunction(
        "window.__recordingComplete === true",
        { timeout: 300_000 },
      );

      // Read the mp4Url from the page
      const mp4Url = await page.evaluate(() => {
        return (window as any).__recordingMp4Url as string;
      });

      if (!mp4Url) throw new Error("Recording completed but no mp4Url returned");

      // Convert relative URL to absolute file path
      const mp4Path = path.resolve(process.cwd(), "recordings", path.basename(mp4Url));
      console.log(`[Recording] Match #${matchId} recorded: ${mp4Path}`);
      return mp4Path;
    } finally {
      await browser.close();
    }
  }
}
