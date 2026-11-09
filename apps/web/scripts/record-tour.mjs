// Records the guided demo end to end.
// Usage: node scripts/record-tour.mjs [baseUrl] [outDir]
// Uses system Chrome so the H.264 conference clip plays. Needs ffmpeg on PATH for the MP4.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:5200";
const outDir = resolve(process.argv[3] ?? "recordings");
const size = { width: 1440, height: 900 };
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, recordVideo: { dir: outDir, size } });
const page = await context.newPage();
page.on("pageerror", (error) => console.error("page error:", error.message));

await page.goto(`${base}/?tour=1#/`, { waitUntil: "networkidle" });
let last = "";
const deadline = Date.now() + 8 * 60_000;
while (Date.now() < deadline) {
  const state = await page.evaluate(() => ({ step: document.documentElement.dataset.tourStep ?? "", done: document.documentElement.dataset.tourDone === "true" }));
  if (state.step && state.step !== last) {
    console.log(`${new Date().toISOString().slice(11, 19)} step ${state.step}`);
    last = state.step;
  }
  if (state.done) break;
  await page.waitForTimeout(500);
}
await page.waitForTimeout(2500);
const video = page.video();
await context.close();
await browser.close();

const webm = await video.path();
const finalWebm = join(outDir, "backstage-demo.webm");
renameSync(webm, finalWebm);
const mp4 = join(outDir, "backstage-demo.mp4");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", finalWebm, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", mp4]);
console.log(`saved ${mp4}`);
console.log(readdirSync(outDir).join("\n"));
