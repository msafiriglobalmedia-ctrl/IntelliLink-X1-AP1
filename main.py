"""IntelliLink X1 - FastAPI backend and PWA shell."""
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, Query
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"

app = FastAPI(
    title="IntelliLink X1 API",
    description="Network measurement and quality-scoring API for the IntelliLink X1 PWA.",
    version="1.0.0",
)
app.mount("/assets", StaticFiles(directory=str(ASSETS)), name="assets")


@app.get("/", include_in_schema=False)
async def home():
    return FileResponse(ROOT / "index.html")


@app.get("/manifest.webmanifest", include_in_schema=False)
async def manifest():
    return FileResponse(
        ROOT / "manifest.webmanifest",
        media_type="application/manifest+json",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/service-worker.js", include_in_schema=False)
async def service_worker():
    return FileResponse(
        ROOT / "service-worker.js",
        media_type="application/javascript",
        headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"},
    )


@app.get("/api/v1/health")
async def health():
    return {
        "service": "IntelliLink X1 API",
        "status": "operational",
        "version": app.version,
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/v1/ping")
async def ping(nonce: str = Query(default="", max_length=80)):
    # The browser times the complete HTTP round trip. This is not ICMP ping.
    return {
        "ok": True,
        "nonce": nonce,
        "server_time_utc": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/v1/speedtest/download")
async def speedtest_download(size_bytes: int = Query(default=524288, ge=65536, le=2097152)):
    # Small capped payload for a basic download-throughput estimate.
    payload = b"0" * size_bytes
    return Response(
        content=payload,
        media_type="application/octet-stream",
        headers={
            "Content-Length": str(size_bytes),
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "X-Content-Type-Options": "nosniff",
        },
    )


class Measurement(BaseModel):
    latency_ms: float = Field(ge=0, le=60000)
    jitter_ms: float = Field(ge=0, le=60000)
    download_mbps: float = Field(ge=0, le=100000)
    request_failure_percent: float = Field(ge=0, le=100)
    connection_type: str = Field(default="Unknown", max_length=40)


def lower_is_better(value: float, good: float, bad: float) -> float:
    if value <= good:
        return 100.0
    if value >= bad:
        return 0.0
    return 100.0 * (bad - value) / (bad - good)


def higher_is_better(value: float, bad: float, good: float) -> float:
    if value <= bad:
        return 0.0
    if value >= good:
        return 100.0
    return 100.0 * (value - bad) / (good - bad)


@app.post("/api/v1/evaluate")
async def evaluate(measurement: Measurement):
    latency_score = lower_is_better(measurement.latency_ms, 40, 400)
    jitter_score = lower_is_better(measurement.jitter_ms, 10, 100)
    speed_score = higher_is_better(measurement.download_mbps, 1, 50)
    reliability_score = 100.0 - measurement.request_failure_percent

    score = round(
        latency_score * 0.35
        + jitter_score * 0.25
        + speed_score * 0.30
        + reliability_score * 0.10
    )
    if score >= 85:
        grade = "Excellent"
        advice = "Your measured connection is performing very well."
    elif score >= 70:
        grade = "Good"
        advice = "Your connection looks suitable for most everyday online tasks."
    elif score >= 50:
        grade = "Fair"
        advice = "Some delays may be noticeable. Try testing again closer to your router or in a different location."
    else:
        grade = "Weak"
        advice = "The measured connection may struggle. Check coverage, congestion, or your Wi-Fi position."

    return {
        "score": score,
        "grade": grade,
        "advice": advice,
        "components": {
            "latency_score": round(latency_score),
            "jitter_score": round(jitter_score),
            "download_score": round(speed_score),
            "request_reliability_score": round(reliability_score),
        },
        "measurement": measurement.model_dump(),
        "note": "This is an indicative app-level score, not a carrier-certified network measurement.",
    }
