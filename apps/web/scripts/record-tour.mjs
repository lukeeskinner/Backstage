// Records the guided demo end to end with a spoken voiceover.
// Usage: node scripts/record-tour.mjs [baseUrl] [outDir]
// Needs system Chrome (so the H.264 clip plays), ffmpeg on PATH, and macOS `say` for the voice.
// VOICE=<name> picks another `say` voice; VOICE=none records without narration.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";

const base = process.argv[2] ?? "http://localhost:5200";
const outDir = resolve(process.argv[3] ?? "recordings");
const voice = process.env.VOICE ?? "Samantha";
const size = { width: 1440, height: 900 };
const SPEAK_AFTER_S = 0.4;
mkdirSync(join(outDir, "voice"), { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

const probe = await browser.newPage();
await probe.goto(`${base}/#/`, { waitUntil: "networkidle" });
const narration = await probe.evaluate(() => window.__TOUR_NARRATION ?? []);
await probe.close();

const clips = {};
const holds = {};
if (voice !== "none") {
  for (const { id, text } of narration) {
    const file = join(outDir, "voice", `${id}.aiff`);
    execFileSync("say", ["-v", voice, "-r", "182", "-o", file, text]);
    const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());
    clips[id] = file;
    holds[id] = Math.round((seconds + SPEAK_AFTER_S + 1.1) * 1000);
  }
  console.log(`voiceover: ${Object.keys(clips).length} clips with ${voice}`);
}

const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1, recordVideo: { dir: outDir, size } });
await context.addInitScript((value) => { window.__TOUR_HOLDS = value; }, holds);
const page = await context.newPage();
const t0 = Date.now();
page.on("pageerror", (error) => console.error("page error:", error.message));

await page.goto(`${base}/?tour=1#/`, { waitUntil: "networkidle" });
const starts = [];
const deadline = Date.now() + 10 * 60_000;
while (Date.now() < deadline) {
  const state = await page.evaluate(() => ({ step: document.documentElement.dataset.tourStep ?? "", done: document.documentElement.dataset.tourDone === "true" }));
  if (state.step && state.step !== starts.at(-1)?.id) {
    const at = (Date.now() - t0) / 1000;
    starts.push({ id: state.step, at });
    console.log(`${at.toFixed(1).padStart(6)}s  ${state.step}`);
  }
  if (state.done) break;
  await page.waitForTimeout(100);
}
await page.waitForTimeout(2500);
const video = page.video();
await context.close();
await browser.close();

const webm = join(outDir, "backstage-demo.webm");
renameSync(await video.path(), webm);
const mp4 = join(outDir, "backstage-demo.mp4");
const voiced = starts.filter((start) => clips[start.id]);
const args = ["-y", "-loglevel", "error", "-i", webm];
for (const start of voiced) args.push("-i", clips[start.id]);
if (voiced.length) {
  const delays = voiced.map((start, i) => {
    const ms = Math.round((start.at + SPEAK_AFTER_S) * 1000);
    return `[${i + 1}:a]aresample=48000,adelay=${ms}|${ms}[v${i}]`;
  });
  const mix = `${voiced.map((_, i) => `[v${i}]`).join("")}amix=inputs=${voiced.length}:normalize=0,apad[a]`;
  args.push("-filter_complex", [...delays, mix].join(";"), "-map", "0:v", "-map", "[a]", "-shortest", "-c:a", "aac", "-b:a", "160k");
}
args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", mp4);
execFileSync("ffmpeg", args);
console.log(`saved ${mp4}`);
