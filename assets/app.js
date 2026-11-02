"use strict";
const $ = (id) => document.getElementById(id);
const networkInfo = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
const SAMPLE_BYTES = 131072; // 128 KiB: a small measurement, about once per minute.
const SAMPLE_INTERVAL_MS = 60000;
let installPrompt = null;
let autoMonitor = true;
let monitorTimer = null;
let speedHistory = [];
let lastMeasuredMbps = null;
let runTestSound = null;
let networkChangeTime = Date.now();

function playRunTestSound() {
  try {
    if (!runTestSound) {
      runTestSound = new Audio("/assets/sirius-notification.mp3?v=3");
      runTestSound.preload = "auto";
      runTestSound.volume = 0.9;
      runTestSound.setAttribute("playsinline", "");
    }
    runTestSound.pause();
    runTestSound.currentTime = 0;
    const result = runTestSound.play();
    if (result && typeof result.catch === "function") result.catch((error) => {
      console.warn("IntelliLink X1 sound could not play:", error);
      $("test-status").textContent = "Notification sound was blocked by the browser. Check media volume and reload.";
    });
  } catch (error) {
    console.warn("IntelliLink X1 sound error:", error);
  }
}

function safeText(id, value) { const element = $(id); if (element) element.textContent = value; }
function getNetworkLabel() {
  if (!navigator.onLine) return "OFFLINE";
  if (networkInfo?.type && networkInfo.type !== "unknown") {
    const type = String(networkInfo.type).toLowerCase();
    if (type === "cellular") return networkInfo.effectiveType ? `CELLULAR · ${networkInfo.effectiveType.toUpperCase()}` : "CELLULAR";
    return type.toUpperCase();
  }
  if (networkInfo?.effectiveType) return networkInfo.effectiveType.toUpperCase() + " (EST.)";
  return "ONLINE · TYPE UNKNOWN";
}
function formatMbps(value) {
  if (!Number.isFinite(value) || value < 0) return "--";
  if (value >= 1000) return (value / 1000).toFixed(2) + " Gbps";
  return value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2) + " Mbps";
}
function updateConnectionInfo() {
  const online = navigator.onLine;
  safeText("connection-state", online ? "ONLINE" : "OFFLINE");
  safeText("online-chip", online ? "Online" : "Offline");
  if ($("online-chip")) $("online-chip").style.color = online ? "#4de0b0" : "#ffb36b";
  const label = getNetworkLabel();
  safeText("network-label", `NETWORK: ${label}`);
  safeText("connection-kind", networkInfo?.type ? String(networkInfo.type).toUpperCase() : "Not exposed by browser");
  safeText("connection-type", networkInfo?.effectiveType ? networkInfo.effectiveType.toUpperCase() : "Not exposed by browser");
  safeText("browser-downlink", Number.isFinite(networkInfo?.downlink) ? formatMbps(networkInfo.downlink) : "Not exposed by browser");
  safeText("browser-rtt", Number.isFinite(networkInfo?.rtt) ? `${networkInfo.rtt} ms (estimate)` : "Not exposed by browser");
  safeText("data-saver", typeof networkInfo?.saveData === "boolean" ? (networkInfo.saveData ? "Enabled" : "Disabled") : "Not exposed");
  const cellular = networkInfo?.type === "cellular";
  safeText("cellular-detected", cellular ? "Yes · cellular link reported" : "Not confirmed by browser");
  safeText("sim-network-state", cellular ? "Cellular connection reported" : online ? "SIM status not exposed" : "Device is offline");
  safeText("sim-network-hint", cellular ? "The browser reports a cellular connection, but cannot identify the SIM or carrier." : "The browser does not provide SIM-level status to this app.");
  safeText("network-changed", new Date(networkChangeTime).toLocaleTimeString());
  if (networkInfo?.downlink != null && lastMeasuredMbps == null) {
    safeText("live-speed-value", Number(networkInfo.downlink).toFixed(2));
    safeText("speed-source", "Browser-provided connection estimate · not a direct speed test");
  }
}
function average(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function renderSpeedChart() {
  const width = 340, height = 62, pad = 3;
  const values = speedHistory.slice(-18);
  if (!values.length) return;
  const max = Math.max(...values, 0.1);
  const points = values.map((value, index) => {
    const x = values.length === 1 ? width : (index / (values.length - 1)) * width;
    const y = height - pad - (value / max) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const firstX = values.length === 1 ? 0 : 0;
  const lastX = width;
  const line = points.join(" ");
  const area = `M${firstX} ${height} L${line.replaceAll(" ", " L")} L${lastX} ${height} Z`;
  if ($("speed-line")) $("speed-line").setAttribute("points", line);
  if ($("speed-area")) $("speed-area").setAttribute("d", area);
}
async function runQuickSpeedSample() {
  if (!navigator.onLine || document.visibilityState === "hidden") return;
  const started = performance.now();
  try {
    const response = await fetch(`/api/v1/speedtest/download?size_bytes=${SAMPLE_BYTES}&nonce=${Date.now()}`, { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error(`Speed sample failed (HTTP ${response.status}).`);
    const payload = await response.arrayBuffer();
    const seconds = Math.max((performance.now() - started) / 1000, 0.01);
    const mbps = (payload.byteLength * 8) / seconds / 1000000;
    if (!Number.isFinite(mbps)) throw new Error("Invalid speed sample.");
    lastMeasuredMbps = mbps;
    speedHistory.push(mbps);
    speedHistory = speedHistory.slice(-18);
    safeText("live-speed-value", mbps.toFixed(mbps >= 100 ? 0 : 2));
    safeText("speed-source", `Active download sample · 128 KiB · ${formatMbps(mbps)}`);
    safeText("speed-updated", `Updated ${new Date().toLocaleTimeString()}`);
    renderSpeedChart();
  } catch (error) {
    console.warn("Auto speed monitor:", error);
    if (lastMeasuredMbps == null) {
      safeText("live-speed-value", "--");
      safeText("speed-source", "Automatic sample unavailable · check server connection");
    } else {
      safeText("speed-source", "Showing last successful sample · latest refresh failed");
    }
  }
}
function scheduleNextSample() {
  clearTimeout(monitorTimer);
  if (!autoMonitor) return;
  monitorTimer = setTimeout(async () => {
    if (document.visibilityState === "visible") await runQuickSpeedSample();
    scheduleNextSample();
  }, SAMPLE_INTERVAL_MS);
}
function startMonitor() {
  autoMonitor = true;
  safeText("monitor-state", "AUTO MONITOR ON");
  safeText("monitor-toggle", "Pause monitor");
  runQuickSpeedSample();
  scheduleNextSample();
}
function pauseMonitor() {
  autoMonitor = false;
  clearTimeout(monitorTimer);
  safeText("monitor-state", "MONITOR PAUSED");
  safeText("monitor-toggle", "Resume monitor");
}

function showResult(result, metrics) {
  safeText("score-value", result.score);
  safeText("score-grade", result.grade);
  safeText("score-advice", result.advice);
  $("latency-value").innerHTML = `${metrics.latency_ms.toFixed(0)}<small> ms</small>`;
  $("jitter-value").innerHTML = `${metrics.jitter_ms.toFixed(1)}<small> ms</small>`;
  $("download-value").innerHTML = `${metrics.download_mbps.toFixed(2)}<small> Mbps</small>`;
  $("failure-value").innerHTML = `${metrics.request_failure_percent.toFixed(0)}<small> %</small>`;
  const degrees = Math.round(result.score * 3.6);
  $("score-ring").style.background = `conic-gradient(#30d8ff 0deg,#1b75ff ${degrees}deg,#203653 ${degrees}deg 360deg)`;
  safeText("last-test", new Date().toLocaleString());
  lastMeasuredMbps = metrics.download_mbps;
  safeText("live-speed-value", metrics.download_mbps.toFixed(metrics.download_mbps >= 100 ? 0 : 2));
  safeText("speed-source", "Last full diagnostic download measurement");
}

window.addEventListener("online", () => { networkChangeTime = Date.now(); updateConnectionInfo(); if (autoMonitor) runQuickSpeedSample(); });
window.addEventListener("offline", () => { networkChangeTime = Date.now(); updateConnectionInfo(); safeText("speed-source", "Device is offline"); });
if (networkInfo?.addEventListener) networkInfo.addEventListener("change", () => { networkChangeTime = Date.now(); updateConnectionInfo(); });
updateConnectionInfo();

window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); installPrompt = event; $("install-button").hidden = false; });
$("install-button").addEventListener("click", async () => {
  if (!installPrompt) { alert("Open the browser menu and choose Install app or Add to Home screen."); return; }
  installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $("install-button").hidden = true;
});
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/service-worker.js", { updateViaCache: "none" }).catch(console.warn));

$("monitor-toggle").addEventListener("click", () => autoMonitor ? pauseMonitor() : startMonitor());
$("run-test").addEventListener("click", async () => {
  playRunTestSound(); // Mobile browsers require playback to begin from the user's tap.
  const button = $("run-test"), status = $("test-status");
  button.disabled = true; button.innerHTML = "◌ Running diagnostics…"; status.textContent = "Measuring response time…";
  const latencies = []; let failures = 0; const totalRequests = 5;
  try {
    for (let i = 0; i < totalRequests; i++) {
      const started = performance.now();
      try {
        const response = await fetch(`/api/v1/ping?nonce=${Date.now()}-${i}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await response.json(); latencies.push(performance.now() - started);
      } catch (_) { failures++; }
    }
    if (!latencies.length) throw new Error("The IntelliLink API could not be reached.");
    status.textContent = "Measuring download throughput…";
    const downloadStarted = performance.now();
    const downloadResponse = await fetch(`/api/v1/speedtest/download?size_bytes=524288&nonce=${Date.now()}`, { cache: "no-store" });
    if (!downloadResponse.ok) throw new Error("Download test failed.");
    const data = await downloadResponse.arrayBuffer();
    const seconds = Math.max((performance.now() - downloadStarted) / 1000, 0.001);
    const downloadMbps = (data.byteLength * 8) / seconds / 1000000;
    const latency = average(latencies);
    const jitter = latencies.length > 1 ? average(latencies.slice(1).map((value, index) => Math.abs(value - latencies[index]))) : 0;
    const metrics = { latency_ms: Number(latency.toFixed(2)), jitter_ms: Number(jitter.toFixed(2)), download_mbps: Number(downloadMbps.toFixed(3)), request_failure_percent: Number((failures / totalRequests * 100).toFixed(2)), connection_type: getNetworkLabel() };
    status.textContent = "Calculating network quality index…";
    const evaluationResponse = await fetch("/api/v1/evaluate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(metrics) });
    if (!evaluationResponse.ok) throw new Error("The API could not evaluate this test.");
    const result = await evaluationResponse.json(); showResult(result, metrics);
    status.textContent = `Full test complete · ${latencies.length}/${totalRequests} response checks succeeded.`;
  } catch (error) {
    status.textContent = error.message || "Test could not be completed. Check your internet and try again.";
  } finally {
    button.disabled = false; button.innerHTML = "<span>↗</span> Run full network check";
  }
});

safeText("device-platform", /Android/i.test(navigator.userAgent) ? "Android device" : /iPhone|iPad/i.test(navigator.userAgent) ? "Apple mobile device" : "Web browser device");
safeText("connection-api", networkInfo ? "Available · partial network data" : "Not supported by this browser");
safeText("app-mode", (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone ? "Installed PWA" : "Browser tab");

function revealApp() {
  const splash = $("splash-screen"), shell = $("app-shell");
  if (splash) splash.classList.add("is-hidden");
  if (shell) { shell.classList.add("is-ready"); shell.setAttribute("aria-hidden", "false"); }
}
window.addEventListener("load", () => {
  startMonitor();
  setTimeout(revealApp, window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 150 : 1900);
});
document.addEventListener("visibilitychange", () => {
  clearTimeout(monitorTimer);
  if (document.visibilityState === "visible" && autoMonitor) { runQuickSpeedSample(); scheduleNextSample(); }
});
