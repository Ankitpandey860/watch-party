// MOCK-PAGE END-TO-END TESTS (category: "extension integration against a mock Netflix page").
// Real: Chromium x2 (independent profiles), the real built extension, the real Watch Party backend
// (REST + Socket.IO + auth + DB). Mock: the Netflix page and its player API. This does NOT test netflix.com.
//
//   npm run build:test && xvfb-run -a node e2e/run.mjs
import { chromium } from "playwright-core";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, createRoomWithHost, joinAsParticipant } from "../../backend/tests/_helpers/harness.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(here, "..", process.env.WP_OUT_DIR || "dist-test");
const MOCK_PORT = 4101;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const TITLE = "80100172", OTHER = "80100999";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, note = "") => { results.push({ name, ok: !!ok, note }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? "  — " + note : ""}`); };
async function until(fn, ms = 8000, step = 150) { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* keep polling */ } await sleep(step); } return false; }

// ---- mock Netflix origin ---------------------------------------------------------------------------
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, MOCK);
  if (u.pathname === "/clip.webm") {
    const data = fs.readFileSync(path.join(here, "mock/clip.webm"));
    const range = req.headers.range;
    if (range) { const [s, e] = range.replace("bytes=", "").split("-"); const start = +s, end = e ? +e : data.length - 1; res.writeHead(206, { "content-type": "video/webm", "content-range": `bytes ${start}-${end}/${data.length}`, "accept-ranges": "bytes", "content-length": end - start + 1 }); return res.end(data.subarray(start, end + 1)); }
    res.writeHead(200, { "content-type": "video/webm", "accept-ranges": "bytes", "content-length": data.length }); return res.end(data);
  }
  if (/^\/(?:[a-z]{2}\/)?watch\/\d+$/.test(u.pathname)) { res.writeHead(200, { "content-type": "text/html" }); return res.end(fs.readFileSync(path.join(here, "mock/watch.html"))); }
  res.writeHead(404); res.end();
});
await new Promise((r) => mock.listen(MOCK_PORT, "127.0.0.1", r));

const server = await startServer();
const profiles = [];
async function launch(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wp-e2e-${name}-`));
  const ctx = await chromium.launchPersistentContext(dir, {
    executablePath: "/opt/pw-browsers/chromium", headless: false,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
  });
  let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
  const p = { name, ctx, dir, extId: new URL(sw.url()).host, sw };
  profiles.push(p);
  return p;
}
const popup = async (p) => { const page = await p.ctx.newPage(); await page.goto(`chrome-extension://${p.extId}/popup.html`); return page; };
const popupText = (pg, id) => pg.textContent(`#${id}`);
const vid = (pg) => pg.evaluate(() => { const v = document.getElementById("main"); return { paused: v.paused, t: v.currentTime, crash: window.__directSeekCrash }; });
const user = (pg, op, arg) => pg.evaluate(([o, a]) => window.__user[o](a), [op, arg]);
const room = () => server.roomManager.getRoom(roomId).currentVideo;
let roomId;

async function pair(p, actor, label) {
  const code = (await actor.rest("POST", "/extension/pairing", { roomId })).body.code;
  const pu = await popup(p);
  await pu.fill("#server", server.url);
  await pu.fill("#code", code);
  await pu.click("#pair");
  const ok = await until(async () => (await popupText(pu, "sConn")).startsWith("Connected"), 10_000);
  const why = ok ? "" : `conn="${await popupText(pu, "sConn").catch(() => "?")}" pairError="${await popupText(pu, "pairError").catch(() => "?")}" err="${await popupText(pu, "err").catch(() => "?")}"`;
  check(`${label}: paired through the popup UI and connected to the real backend`, ok, why);
  return pu;
}

try {
  // ---- room with a host (web seat) and a viewer (web seat) -----------------------------------------
  const r = await createRoomWithHost(server, "Alice");
  roomId = r.roomId;
  const hostWeb = r.host, hostActor = r.hostActor;
  const bob = await joinAsParticipant(server, roomId, "Bob");
  await hostWeb.request("change_video", { url: `https://www.netflix.com/watch/${TITLE}` }, "sync_state");

  const A = await launch("A"), B = await launch("B");
  check("two independent Chromium profiles loaded the extension (different extension ids not required)", !!A.extId && !!B.extId && A.dir !== B.dir);
  const puA = await pair(A, hostActor, "host profile");
  const puB = await pair(B, bob.actor, "viewer profile");
  check("host extension shows role host / can control", (await popupText(puA, "sRole")).startsWith("host"));
  check("viewer extension shows watch-only", (await popupText(puB, "sRole")).includes("watch only"));
  check("server sees two live companion sockets", server.ctx.companions.size === 2);

  // ---- both open the same (mock) title --------------------------------------------------------------
  const pa = await A.ctx.newPage(); await pa.goto(`${MOCK}/watch/${TITLE}`);
  const pb = await B.ctx.newPage(); await pb.goto(`${MOCK}/watch/${TITLE}`);
  const roster = () => server.roomManager.getRoom(roomId).listParticipants();
  check("both participants are reported 'ready' on the right title (player_status)", await until(() => roster().every((p) => p.playerStatus === "ready")), roster().map((p) => `${p.username}=${p.playerStatus}`).join());
  check("the real extension used the full player API adapter (netflix-cadmium) in both", await until(async () => (await popupText(puA, "sTab")) !== "" && (await puA.evaluate(() => chrome.runtime.sendMessage({ kind: "getStatus" }))).tab.adapter === "netflix-cadmium"));

  // ---- play / pause / seek: host drives, viewer follows ---------------------------------------------
  const seq0 = room().seq;
  await user(pa, "play");
  check("viewer starts playing after the host plays", await until(async () => !(await vid(pb)).paused, 8000));
  check("server state is playing", room().playing === true);
  await sleep(3000);
  const [a1, b1] = [await vid(pa), await vid(pb)];
  check("positions within 2.5 s while playing", Math.abs(a1.t - b1.t) < 2.5, `A=${a1.t.toFixed(2)} B=${b1.t.toFixed(2)}`);

  await user(pa, "pause");
  check("viewer pauses after the host pauses", await until(async () => (await vid(pb)).paused, 8000));
  await sleep(800);
  const [a2, b2] = [await vid(pa), await vid(pb)];
  check("paused positions within 1.2 s", Math.abs(a2.t - b2.t) < 1.2, `A=${a2.t.toFixed(2)} B=${b2.t.toFixed(2)}`);

  await user(pa, "seek", 1.5); // clip is short: seek within it
  check("viewer follows the host's seek", await until(async () => Math.abs((await vid(pb)).t - 1.5) < 1.2, 8000));
  await sleep(2500);
  // The host's extension also sends periodic position reports (reason "periodic", by design, same as the YouTube
  // player), which bump seq. An echo loop would show up as EXTRA explicit commands, so count those only.
  const cmds = hostWeb.events("sync_state").filter((e) => e.seq > seq0 && e.reason !== "periodic").map((e) => e.reason);
  check("no echo loop: exactly play, pause, seek reach the server (no extra explicit commands)", JSON.stringify(cmds) === JSON.stringify(["play", "pause", "seek"]), `commands=${cmds.join(",")}`);

  // ---- viewer cannot steer the room ------------------------------------------------------------------
  await user(pa, "play");
  await until(async () => !(await vid(pb)).paused);
  const seqBefore = room().seq;
  await user(pb, "pause"); // the viewer fights the room
  check("viewer's local pause is reverted (room keeps playing)", await until(async () => !(await vid(pb)).paused, 8000));
  check("the server never received a command from the viewer's extension", room().seq === seqBefore && room().playing === true);
  check("direct video.currentTime was never written (both tabs)", !(await vid(pa)).crash && !(await vid(pb)).crash);

  // ---- reconnect: drop the viewer's companion socket; room moves on; it must catch up ----------------
  await user(pa, "pause");
  await until(async () => (await vid(pb)).paused);
  const viewerCred = [...server.ctx.companions.entries()].find(([, s]) => s.data.userId === bob.userId);
  viewerCred[1].disconnect(true); // simulated network drop
  check("viewer's extension notices the drop", await until(async () => !(await popupText(puB, "sConn")).startsWith("Connected"), 5000));
  await hostWeb.request("seek", { time: 0.5, ref: { provider: "netflix", mediaId: TITLE } }, "sync_state");
  await hostWeb.request("play", {}, "sync_state");
  check("viewer reconnects by itself (new ticket) and re-syncs to the room's state", await until(async () => !(await vid(pb)).paused && (await popupText(puB, "sConn")).startsWith("Connected"), 20_000));
  await hostWeb.request("pause", {}, "sync_state");
  await until(async () => (await vid(pb)).paused);

  // ---- late joiner: close the viewer tab, room advances, viewer opens the title again ------------------
  await pb.close();
  await hostWeb.request("seek", { time: 1.0, ref: { provider: "netflix", mediaId: TITLE } }, "sync_state");
  await hostWeb.request("play", {}, "sync_state");
  await sleep(1500);
  const pb2 = await B.ctx.newPage(); await pb2.goto(`${MOCK}/watch/${TITLE}`);
  check("late joiner starts playing on opening the title", await until(async () => !(await vid(pb2)).paused, 10_000));
  const lj = await vid(pb2);
  const expected = room().currentTime; // server projects the position
  const clipLen = await pb2.evaluate(() => document.getElementById("main").duration);
  const modDiff = Math.abs((lj.t % clipLen) - (expected % clipLen));
  check("late joiner lands near the room's projected position", Math.min(modDiff, clipLen - modDiff) < 3, `joiner=${lj.t.toFixed(2)} room=${expected.toFixed(2)}`);
  await hostWeb.request("pause", {}, "sync_state");
  await until(async () => (await vid(pb2)).paused);

  // ---- multiple tabs: only ONE tab per browser is controlled ---------------------------------------------
  const pb3 = await B.ctx.newPage(); await pb3.goto(`${MOCK}/watch/${TITLE}`);
  await pb3.bringToFront();
  await sleep(2500);
  await hostWeb.request("play", {}, "sync_state");
  await sleep(2500);
  const [t2, t3] = [await vid(pb2), await vid(pb3)];
  check("with two tabs on the same title exactly one is controlled", Number(!t2.paused) + Number(!t3.paused) === 1, `tab2 paused=${t2.paused} tab3 paused=${t3.paused}`);
  await pb3.close();
  await hostWeb.request("pause", {}, "sync_state");

  // ---- wrong title ------------------------------------------------------------------------------------
  await pb2.goto(`${MOCK}/watch/${OTHER}`);
  check("viewer on a different title is reported as wrong_title", await until(() => roster().find((p) => p.username === "Bob")?.playerStatus === "wrong_title", 10_000), String(roster().find((p) => p.username === "Bob")?.playerStatus));
  await hostWeb.request("play", {}, "sync_state");
  await sleep(2500);
  check("the wrong-title tab is NOT controlled by room commands", (await vid(pb2)).paused === true);
  check("popup tells the viewer why", (await popupText(puB, "sTab")).includes("different title"));
  await hostWeb.request("pause", {}, "sync_state");
  await pb2.goto(`${MOCK}/watch/${TITLE}`); // SPA-style navigation back to the right title
  check("navigating back to the right title restores 'ready'", await until(() => roster().find((p) => p.username === "Bob")?.playerStatus === "ready", 10_000));

  // ---- title change in the room ----------------------------------------------------------------------------
  await hostWeb.request("change_video", { url: `https://www.netflix.com/watch/${OTHER}` }, "sync_state");
  await pa.goto(`${MOCK}/watch/${OTHER}`); await pb2.goto(`${MOCK}/watch/${OTHER}`);
  check("after the host switches title and both open it, both are 'ready' again", await until(() => roster().every((p) => p.playerStatus === "ready"), 10_000));
  await hostWeb.request("change_video", { url: `https://www.netflix.com/watch/${TITLE}` }, "sync_state");
  await pa.goto(`${MOCK}/watch/${TITLE}`); await pb2.goto(`${MOCK}/watch/${TITLE}`);
  await until(() => roster().every((p) => p.playerStatus === "ready"), 10_000);

  // ---- buffering must not cause 'corrections' or phantom commands ----------------------------------------------
  await hostWeb.request("play", {}, "sync_state");
  await until(async () => !(await vid(pb2)).paused);
  const seqBuf = room().seq, markBuf = hostWeb.mark();
  await pb2.evaluate(() => window.__stall(true));
  await sleep(4000);
  await pb2.evaluate(() => window.__stall(false));
  await sleep(2500);
  const bufCmds = hostWeb.events("sync_state", markBuf).filter((e) => e.reason !== "periodic").map((e) => e.reason);
  check("a buffering viewer causes no server commands (periodic host reports excluded)", bufCmds.length === 0 && room().playing === true, `explicit=${bufCmds.join(",") || "none"} seq ${seqBuf}->${room().seq}`);
  check("viewer still playing after the stall", !(await vid(pb2)).paused);
  await hostWeb.request("pause", {}, "sync_state");

  // ---- limited fallback: Netflix removes its internal API ----------------------------------------------------------
  const pbL = await B.ctx.newPage(); await pbL.goto(`${MOCK}/watch/${TITLE}?api=none`);
  await pb2.close();
  const stLimited = await until(async () => { const s = await puB.evaluate(() => chrome.runtime.sendMessage({ kind: "getStatus" })); return s.tab.adapter === "netflix-dom" ? s : null; }, 20_000);
  check("API missing => extension falls back to the limited DOM adapter (diagnosed, not silent)", !!stLimited, stLimited ? "" : "adapter never switched");
  await hostWeb.request("seek", { time: 2.0, ref: { provider: "netflix", mediaId: TITLE } }, "sync_state");
  await hostWeb.request("play", {}, "sync_state");
  check("limited mode still syncs play", await until(async () => !(await vid(pbL)).paused, 10_000));
  const limited = await vid(pbL);
  check("limited mode never seeks and never writes video.currentTime", !limited.crash);
  check("limited mode is surfaced to the user", await until(async () => (await popupText(puB, "sTab")).includes("Limited"), 8000), await popupText(puB, "sTab"));
  await hostWeb.request("pause", {}, "sync_state");

  // ---- revocation ------------------------------------------------------------------------------------------------------
  const rv = await bob.actor.rest("POST", "/extension/revoke", { roomId });
  check("web app revokes the viewer's pairing", rv.body.revoked === 1);
  check("viewer's extension drops to 'Not paired' immediately", await until(async () => (await puB.evaluate(() => chrome.runtime.sendMessage({ kind: "getStatus" }))).paired === false, 8000));
  await hostWeb.request("play", {}, "sync_state");
  await sleep(2500);
  check("after revocation room commands no longer reach that browser", (await vid(pbL)).paused === true);
  check("revoked credential cannot mint a ticket any more", server.ctx.companions.size === 1);
  await hostWeb.request("pause", {}, "sync_state");

  // ---- secrets ----------------------------------------------------------------------------------------------------------------
  const rows = (await server.db.query("SELECT * FROM extension_credentials")).rows;
  check("no Netflix cookie/credential data exists anywhere in the extension tables", !JSON.stringify(rows).toLowerCase().includes("netflixid"));
} catch (e) {
  check("e2e harness completed without an unexpected error", false, String(e?.stack || e).slice(0, 400));
} finally {
  for (const p of profiles) await p.ctx.close().catch(() => {});
  await server.close().catch(() => {});
  mock.close();
  const failed = results.filter((x) => !x.ok);
  fs.writeFileSync(path.join(here, "last-run.json"), JSON.stringify({ category: "mock-netflix-page e2e (real Chromium x2 + real extension + real backend)", date: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
