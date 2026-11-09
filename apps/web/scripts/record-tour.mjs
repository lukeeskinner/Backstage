// Records the guided demo end to end as a high-quality MP4 with a spoken voiceover.
// Usage: node scripts/record-tour.mjs [baseUrl] [outDir]
//
// Video: Chrome screencast frames at 2x pixel density, encoded to 2560x1440, 30 fps, H.264 CRF 16.
// Voice: TTS=kokoro (default) runs scripts/kokoro_tts.py with KOKORO_PYTHON (default python3), voice KOKORO_VOICE
//        (default af_heart). TTS=say uses macOS `say` with VOICE (default Samantha). TTS=none records silent.
// Needs system Chrome and ffmpeg on PATH.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const base = process.argv[2] ?? "http://localhost:5200";
const outDir = resolve(process.argv[3] ?? "recordings");
const tts = process.env.TTS ?? "kokoro";
const viewport = { width: 1440, height: 810 };
const output = { width: 2560, height: 1440, fps: 30 };
const SPEAK_AFTER_S = 0.4;
const framesDir = join(outDir, "frames");
const voiceDir = join(outDir, "voice");
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });
mkdirSync(voiceDir, { recursive: true });

const seconds = (file) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required", "--hide-scrollbars"] });

const probe = await browser.newPage();
await probe.goto(`${base}/#/`, { waitUntil: "networkidle" });
const narration = await probe.evaluate(() => window.__TOUR_NARRATION ?? []);
await probe.close();

const clips = {};
const holds = {};
if (tts === "kokoro") {
  const list = join(voiceDir, "narration.json");
  writeFileSync(list, JSON.stringify(narration));
  execFileSync(process.env.KOKORO_PYTHON ?? "python3", [join(here, "kokoro_tts.py"), list, voiceDir, process.env.KOKORO_VOICE ?? "af_heart", process.env.KOKORO_SPEED ?? "1.0"], { stdio: "inherit" });
  for (const { id } of narration) clips[id] = join(voiceDir, `${id}.wav`);
} else if (tts === "say") {
  for (const { id, text } of narration) {
    clips[id] = join(voiceDir, `${id}.aiff`);
    execFileSync("say", ["-v", process.env.VOICE ?? "Samantha", "-r", "182", "-o", clips[id], text]);
  }
}
for (const [id, file] of Object.entries(clips)) holds[id] = Math.round((seconds(file) + SPEAK_AFTER_S + 1.1) * 1000);
console.log(`voiceover: ${Object.keys(clips).length} clips (${tts})`);

const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
await context.addInitScript((value) => { window.__TOUR_HOLDS = value; }, holds);
const page = await context.newPage();
page.on("pageerror", (error) => console.error("page error:", error.message));

const frames = [];
const cdp = await context.newCDPSession(page);
cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
  const file = join(framesDir, `${String(frames.length).padStart(6, "0")}.jpg`);
  writeFileSync(file, Buffer.from(data, "base64"));
  frames.push({ file, at: metadata.timestamp });
  await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: viewport.width * 2, maxHeight: viewport.height * 2, everyNthFrame: 1 });

await page.goto(`${base}/?tour=1#/`, { waitUntil: "networkidle" });
const starts = [];
const deadline = Date.now() + 12 * 60_000;
while (Date.now() < deadline) {
  const state = await page.evaluate(() => ({ step: document.documentElement.dataset.tourStep ?? "", done: document.documentElement.dataset.tourDone === "true" }));
  if (state.step && state.step !== starts.at(-1)?.id) {
    starts.push({ id: state.step, at: Date.now() / 1000 });
    console.log(`${state.step}`);
  }
  if (state.done) break;
  await page.waitForTimeout(100);
}
await page.waitForTimeout(3000);
await cdp.send("Page.stopScreencast");
const end = Date.now() / 1000;
await browser.close();

// Frames arrive only when the page changes, so each one lasts until the next.
const t0 = frames[0].at;
const concat = frames.map((frame, i) => `file '${frame.file}'\nduration ${((frames[i + 1]?.at ?? end) - frame.at).toFixed(4)}`);
concat.push(`file '${frames.at(-1).file}'`);
const list = join(framesDir, "frames.txt");
writeFileSync(list, concat.join("\n"));
console.log(`${frames.length} frames over ${(end - t0).toFixed(1)}s`);

const mp4 = join(outDir, "backstage-demo.mp4");
const scale = `scale=${output.width}:${output.height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${output.width}:${output.height}:(ow-iw)/2:(oh-ih)/2:color=0xf6f5f2,fps=${output.fps},format=yuv420p`;
const voiced = starts.filter((start) => clips[start.id]);
const args = ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list];
for (const start of voiced) args.push("-i", clips[start.id]);
const filters = [`[0:v]${scale}[v]`];
if (voiced.length) {
  voiced.forEach((start, i) => {
    const ms = Math.max(0, Math.round((start.at - t0 + SPEAK_AFTER_S) * 1000));
    filters.push(`[${i + 1}:a]aresample=48000,adelay=${ms}|${ms}[a${i}]`);
  });
  filters.push(`${voiced.map((_, i) => `[a${i}]`).join("")}amix=inputs=${voiced.length}:normalize=0,apad[a]`);
}
args.push("-filter_complex", filters.join(";"), "-map", "[v]");
if (voiced.length) args.push("-map", "[a]", "-c:a", "aac", "-b:a", "192k", "-shortest");
args.push("-c:v", "libx264", "-preset", "slow", "-crf", "16", "-profile:v", "high", "-movflags", "+faststart", mp4);
execFileSync("ffmpeg", args);
rmSync(framesDir, { recursive: true, force: true });
console.log(`saved ${mp4}`);
console.log(readdirSync(outDir).join(" "));
