"""IntelliLink X1 - FastAPI backend and PWA shell.

Static asset path resolution is deliberately tolerant of a common GitHub upload
mistake: assets may be placed in a nested IntelliLink-X1/assets directory.
"""
from datetime import datetime, timezone
from pathlib import Path
from fastapi import FastAPI, Query
from fastapi.responses import FileResponse, Response, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent

# Render's working directory is the folder containing main.py. Prefer the
# expected sibling assets/ folder, but also support a nested project folder.
ASSET_CANDIDATES = [
    ROOT / "assets",
    ROOT / "IntelliLink-X1" / "assets",
    ROOT / "intellilink-x1" / "assets",
    ROOT / "app" / "assets",
]
ASSETS = next((p for p in ASSET_CANDIDATES if p.is_dir() and any(p.iterdir())), None)
if ASSETS is None:
    # Do not crash the API at import time. The warning makes the missing frontend
    # assets obvious in Render logs; upload assets/ beside main.py to restore UI files.
    ASSETS = ROOT / "assets"
    ASSETS.mkdir(parents=True, exist_ok=True)
    (ASSETS / "icons").mkdir(parents=True, exist_ok=True)
    print("WARNING: IntelliLink X1 assets folder was not found. API will start, but frontend assets must be uploaded to assets/ beside main.py.")

app = FastAPI(
    title="IntelliLink X1 API",
    description="Network measurement and quality-scoring API for the IntelliLink X1 PWA.",
    version="1.0.2",
)
# Serve the notification MP3 explicitly before mounting the general assets folder.
# This also gives the audio file a stable MIME type and disables stale caching.
@app.get("/assets/sirius-notification.mp3", include_in_schema=False)
async def notification_sound():
    audio_file = ASSETS / "sirius-notification.mp3"
    if not audio_file.is_file():
        return JSONResponse(
            {"status": "missing", "detail": "Upload sirius-notification.mp3 into the assets/ folder."},
            status_code=404,
        )
    return FileResponse(
        audio_file,
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate"},
    )


app.mount("/assets", StaticFiles(directory=str(ASSETS), check_dir=True), name="assets")


@app.get("/", include_in_schema=False)
async def home():
    page = ROOT / "index.html"
    if not page.is_file():
        return JSONResponse({"service": "IntelliLink X1", "status": "running", "warning": "index.html is missing"})
    return FileResponse(page)


@app.get("/manifest.webmanifest", include_in_schema=False)
async def manifest():
    file = ROOT / "manifest.webmanifest"
    if not file.is_file():
        return JSONResponse({"name": "IntelliLink X1", "short_name": "IntelliLink X1", "start_url": "/", "display": "standalone"})
    return FileResponse(file, media_type="application/manifest+json", headers={"Cache-Control": "no-cache"})


@app.get("/service-worker.js", include_in_schema=False)
async def service_worker():
    file = ROOT / "service-worker.js"
    if not file.is_file():
        return Response("self.addEventListener('fetch', () => {});", media_type="application/javascript", headers={"Service-Worker-Allowed": "/"})
    return FileResponse(file, media_type="application/javascript", headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"})


@app.get("/api/v1/health")
async def health():
    return {
        "service": "IntelliLink X1 API",
        "status": "operational",
        "version": app.version,
        "assets_directory": str(ASSETS.relative_to(ROOT)) if ASSETS.is_relative_to(ROOT) else str(ASSETS),
        "assets_present": (ASSETS / "app.js").is_file() and (ASSETS / "styles.css").is_file(),
        "audio_file_present": (ASSETS / "sirius-notification.mp3").is_file(),
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/v1/ping")
async def ping(nonce: str = Query(default="", max_length=80)):
    # Browser-measured HTTP round trip; this is not ICMP ping.
    return {"ok": True, "nonce": nonce, "server_time_utc": datetime.now(timezone.utc).isoformat()}


@app.get("/api/v1/speedtest/download")
async def speedtest_download(size_bytes: int = Query(default=524288, ge=65536, le=2097152)):
    payload = b"0" * size_bytes
    return Response(content=payload, media_type="application/octet-stream", headers={
        "Content-Length": str(size_bytes),
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Content-Type-Options": "nosniff",
    })


class Measurement(BaseModel):
    latency_ms: float = Field(ge=0, le=60000)
    jitter_ms: float = Field(ge=0, le=60000)
    download_mbps: float = Field(ge=0, le=100000)
    request_failure_percent: float = Field(ge=0, le=100)
    connection_type: str = Field(default="Unknown", max_length=40)


def lower_is_better(value: float, good: float, bad: float) -> float:
    if value <= good: return 100.0
    if value >= bad: return 0.0
    return 100.0 * (bad - value) / (bad - good)


def higher_is_better(value: float, bad: float, good: float) -> float:
    if value <= bad: return 0.0
    if value >= good: return 100.0
    return 100.0 * (value - bad) / (good - bad)


@app.post("/api/v1/evaluate")
async def evaluate(measurement: Measurement):
    latency_score = lower_is_better(measurement.latency_ms, 40, 400)
    jitter_score = lower_is_better(measurement.jitter_ms, 10, 100)
    speed_score = higher_is_better(measurement.download_mbps, 1, 50)
    reliability_score = 100.0 - measurement.request_failure_percent
    score = round(latency_score * 0.35 + jitter_score * 0.25 + speed_score * 0.30 + reliability_score * 0.10)
    if score >= 85:
        grade, advice = "Excellent", "Your measured connection is performing very well."
    elif score >= 70:
        grade, advice = "Good", "Your connection looks suitable for most everyday online tasks."
    elif score >= 50:
        grade, advice = "Fair", "Some delays may be noticeable. Try testing again closer to your router or in a different location."
    else:
        grade, advice = "Weak", "The measured connection may struggle. Check coverage, congestion, or your Wi-Fi position."
    return {
        "score": score, "grade": grade, "advice": advice,
        "components": {
            "latency_score": round(latency_score), "jitter_score": round(jitter_score),
            "download_score": round(speed_score), "request_reliability_score": round(reliability_score),
        },
        "measurement": measurement.model_dump(),
        "note": "This is an indicative app-level score, not a carrier-certified network measurement.",
    }
