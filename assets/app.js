const $ = (id) => document.getElementById(id);
let installPrompt = null;
// Notification audio is created/started from the actual tap event.
// The query string also bypasses older browser and service-worker cache entries.
let runTestSound = null;
function playRunTestSound() {
  try {
    if (!runTestSound) {
      runTestSound = new Audio("/assets/sirius-notification.mp3?v=2");
      runTestSound.preload = "auto";
      runTestSound.volume = 0.9;
      runTestSound.setAttribute("playsinline", "");
    }
    runTestSound.pause();
    runTestSound.currentTime = 0;
    const playRequest = runTestSound.play();
    if (playRequest && typeof playRequest.catch === "function") {
      playRequest.catch((error) => {
        console.warn("IntelliLink X1 notification audio could not play:", error);
        const status = $("test-status");
        if (status) status.textContent = `Sound could not play (${error.name || "browser restriction"}). Check media volume and reload the app.`;
      });
    }
  } catch (error) {
    console.warn("IntelliLink X1 notification audio error:", error);
    const status = $("test-status");
    if (status) status.textContent = "Sound could not start. Reload the app and check media volume.";
  }
}
function getConnectionLabel() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (connection?.type && connection.type !== "unknown") return connection.type.toUpperCase();
  if (connection?.effectiveType) return `${connection.effectiveType.toUpperCase()} (EST.)`;
  return "UNKNOWN";
}
function updateConnectionInfo() {
  const online = navigator.onLine;
  $("connection-state").textContent = online ? "ONLINE" : "OFFLINE";
  $("online-chip").textContent = online ? "Online" : "Offline";
  $("online-chip").style.color = online ? "#4de0b0" : "#ffb36b";
  const label = getConnectionLabel();
  $("connection-type").textContent = label === "UNKNOWN" ? "Not exposed by browser" : label;
  $("network-label").textContent = `NETWORK: ${label}`;
}
window.addEventListener("online", updateConnectionInfo);
window.addEventListener("offline", updateConnectionInfo);
updateConnectionInfo();
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault(); installPrompt = event; $("install-button").hidden = false;
});
$("install-button").addEventListener("click", async () => {
  if (!installPrompt) { alert("To install: open your browser menu and choose Install app or Add to Home screen."); return; }
  installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $("install-button").hidden = true;
});
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/service-worker.js").catch(console.warn));
function average(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function showResult(result, metrics) {
  $("score-value").textContent = result.score;
  $("score-grade").textContent = result.grade;
  $("score-advice").textContent = result.advice;
  $("latency-value").innerHTML = `${metrics.latency_ms.toFixed(0)}<small> ms</small>`;
  $("jitter-value").innerHTML = `${metrics.jitter_ms.toFixed(1)}<small> ms</small>`;
  $("download-value").innerHTML = `${metrics.download_mbps.toFixed(2)}<small> Mbps</small>`;
  $("failure-value").innerHTML = `${metrics.request_failure_percent.toFixed(0)}<small> %</small>`;
  const degrees = Math.round(result.score * 3.6);
  $("score-ring").style.background = `conic-gradient(#30d8ff 0deg,#1b75ff ${degrees}deg,#203653 ${degrees}deg 360deg)`;
  $("last-test").textContent = new Date().toLocaleTimeString();
}
$("run-test").addEventListener("click", async () => {
  // Start audio synchronously from the user's tap (mobile autoplay requirement).
  playRunTestSound();
  const button = $("run-test"), status = $("test-status");
  button.disabled = true; button.innerHTML = "◌ Testing connection…"; status.textContent = "Measuring response time…";
  const latencies = []; let failures = 0; const totalRequests = 5;
  try {
    for (let i = 0; i < totalRequests; i++) {
      const started = performance.now();
      try {
        const response = await fetch(`/api/v1/ping?nonce=${Date.now()}-${i}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await response.json(); latencies.push(performance.now() - started);
      } catch (error) { failures++; }
    }
    if (!latencies.length) throw new Error("The IntelliLink API could not be reached.");
    status.textContent = "Measuring download throughput…";
    const downloadStarted = performance.now();
    const downloadResponse = await fetch(`/api/v1/speedtest/download?size_bytes=524288&nonce=${Date.now()}`, { cache: "no-store" });
    if (!downloadResponse.ok) throw new Error("Download test failed.");
    const data = await downloadResponse.arrayBuffer();
    const seconds = Math.max((performance.now() - downloadStarted) / 1000, 0.001);
    const downloadMbps = (data.byteLength * 8) / seconds / 1_000_000;
    const latency = average(latencies);
    const jitter = latencies.length > 1 ? average(latencies.slice(1).map((value, index) => Math.abs(value - latencies[index]))) : 0;
    const metrics = { latency_ms: Number(latency.toFixed(2)), jitter_ms: Number(jitter.toFixed(2)), download_mbps: Number(downloadMbps.toFixed(3)), request_failure_percent: Number((failures / totalRequests * 100).toFixed(2)), connection_type: getConnectionLabel() };
    status.textContent = "Calculating your network quality index…";
    const evaluationResponse = await fetch("/api/v1/evaluate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(metrics) });
    if (!evaluationResponse.ok) throw new Error("The API could not evaluate this test.");
    const result = await evaluationResponse.json(); showResult(result, metrics);
    status.textContent = `Test complete · ${latencies.length}/${totalRequests} response checks succeeded.`;
  } catch (error) { status.textContent = error.message || "Test could not be completed. Check your internet connection and try again."; }
  finally { button.disabled = false; button.innerHTML = "<span>↗</span> Run network check"; }
});
