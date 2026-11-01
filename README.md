# IntelliLink X1 — PWA + REST API (MVP 1.0)

A mobile-first Progressive Web App served by a FastAPI backend. It can be installed from a supported browser without publishing it in an app store.

## Included
- Mobile dashboard, branding and generated app icon.
- PWA manifest and service worker for installation and app-shell caching.
- FastAPI endpoints: `/api/v1/health`, `/api/v1/ping`, `/api/v1/speedtest/download`, `/api/v1/evaluate`.
- First-pass network score using HTTP response time, jitter between HTTP requests, download throughput and failed requests.
- Interactive API docs at `/docs`.

## Run locally
1. Install Python 3.10 or newer.
2. In this folder run `pip install -r requirements.txt`.
3. Run `uvicorn main:app --host 0.0.0.0 --port 8000`.
4. Open `http://127.0.0.1:8000`; API docs are at `http://127.0.0.1:8000/docs`.
5. For a phone-only local test, run the server on the phone and open the local address in its browser. Test public installation after HTTPS deployment.

## Deploy to Render
Create a Git repository with this project and connect it as a Render **Web Service**.
- Runtime: `Python 3`
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Optional health check: `/api/v1/health`

See https://render.com/docs/deploy-fastapi.

## Install on Android
1. Deploy the project and open its HTTPS URL in Chrome.
2. Open Chrome's menu and choose **Install app** or **Add to Home screen** (wording can vary).
3. Confirm. The IntelliLink X1 icon and app name should appear on the home screen.

The shell can be cached for repeat opening, but live network tests require internet access and a reachable API.

## Measurement limitations
This is an initial browser-based MVP, not a carrier-certified analyzer.
- Latency is browser-to-API HTTP round-trip time, not ICMP ping to a carrier gateway.
- Jitter is the variation between those HTTP response times.
- Request failures are failed test requests, not definitive IP packet loss.
- Download speed is estimated from a small 512 KiB test and depends on server location, hosting limits and traffic.
- Browsers do not consistently expose cellular dBm, Wi-Fi RSSI, radio band, tower identity or all network types. These values are not fabricated when unavailable.
- A production-grade service needs distributed test servers, repeatable larger tests, abuse controls, rate limits and a defined methodology.

## Privacy and security
No account, precise location, phone number, SSID or personal profile is collected. This version does not save test values to a database. Do not place secrets/API keys in frontend JavaScript. Add authentication, rate limiting, monitoring and a privacy notice before public scale-up.

## Important: repository folder structure
`main.py` and the `assets/` folder must be siblings at the repository root:

```text
repository-root/
  main.py
  index.html
  requirements.txt
  manifest.webmanifest
  service-worker.js
  assets/
    app.js
    styles.css
    icons/
      icon-192.png
      icon-512.png
```

On Render, leave **Root Directory** blank only when this exact structure is at
GitHub repository root. The `assets` directory name is lowercase and case-sensitive.
