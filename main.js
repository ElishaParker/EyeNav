// main.js — diagnostic loader + original tracking logic
import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm";

const video = document.getElementById("videoFeed");
const dot = document.getElementById("dot");
const statusText = document.getElementById("statusText");
const debugEl = document.getElementById("debug") || (() => { const d = document.createElement('div'); d.id='debug'; d.style.display='none'; document.body.appendChild(d); return d; })();

const faceLandmarkerTaskPath = "./face_landmarker.task"; // must exist and be served by your HTTP server
const wasmBaseUrl = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"; // CDN (default)
const FETCH_TIMEOUT = 10000; // ms

function setStatus(msg) {
  statusText.textContent = msg;
  console.log("[EyeNav]", msg);
}

function timeoutFetch(url, ms = FETCH_TIMEOUT) {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), ms);
  return fetch(url, { signal: ac.signal }).finally(() => clearTimeout(id));
}

async function preflightChecks() {
  setStatus("Checking resources (preflight)...");
  // 1) Check wasm base reachable
  try {
    await timeoutFetch(wasmBaseUrl + "/package.json", 8000); // a small file on the CDN
    console.log("WASM CDN reachable.");
  } catch (err) {
    console.warn("WASM CDN unreachable:", err);
    throw new Error(`Cannot reach MediaPipe wasm CDN at:\n${wasmBaseUrl}\n\nNetwork/CORS or offline environment?`);
  }

  // 2) Check local face_landmarker.task
  try {
    const r = await timeoutFetch(faceLandmarkerTaskPath, 8000);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    console.log("Found local face_landmarker.task (OK).");
  } catch (err) {
    console.warn("face_landmarker.task fetch failed:", err);
    throw new Error(`Cannot fetch local model file: ${faceLandmarkerTaskPath}\nMake sure the file exists and you're serving via HTTP(S). Try running:\n  python3 -m http.server 8000\nand open http://localhost:8000/`);
  }
}

// Helpful UI Retry button injection
function showErrorUI(message) {
  setStatus("Error — see details");
  debugEl.style.display = "block";
  debugEl.innerHTML = `<div style="color: #ff8cbf; font-weight:600;">ERROR</div><pre style="white-space:pre-wrap;color:#fff">${message}</pre>
    <div style="margin-top:8px;"><button id="retryLoader">Retry</button></div>
    <div style="margin-top:6px;color:#9df7ef;font-size:12px">If you're using local files: run a simple server (python -m http.server), ensure face_landmarker.task is in the same folder, and allow camera access.</div>`;
  const btn = document.getElementById("retryLoader");
  btn.addEventListener("click", () => { debugEl.style.display = "none"; startLoader(); });
}

// Main loader that runs the model creation and then starts tracking
async function startLoader() {
  try {
    setStatus("Preflight: verifying network and model files...");
    await preflightChecks();

    setStatus("Loading MediaPipe vision wasm files...");
    // FilesetResolver.forVisionTasks expects the wasm base path (already set in wasmBaseUrl)
    const vision = await FilesetResolver.forVisionTasks(wasmBaseUrl);
    setStatus("Creating FaceLandmarker model (may take a few seconds)...");
    const fl = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: faceLandmarkerTaskPath },
      runningMode: "VIDEO",
      numFaces: 1
    });
    window._faceLandmarker = fl; // expose for console debugging
    setStatus("Model loaded — starting webcam");
    await startCameraAndRun(fl);
  } catch (err) {
    console.error("Loader error:", err);
    showErrorUI(err.stack || err.message || String(err));
  }
}

async function startCameraAndRun(faceLandmarker) {
  try {
    // start webcam
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
    video.srcObject = stream;
    await new Promise(resolve => { video.onloadedmetadata = () => { video.play(); resolve(); }; });

    setStatus("Tracking active — move only your eyes 👁️");
    runTracking(faceLandmarker);
  } catch (err) {
    console.error("Camera start error:", err);
    showErrorUI("Camera error: " + (err.message || String(err)) + "\nConfirm browser permissions and that a camera exists.");
  }
}

// A compact tracking loop (keeps your app behavior). Replace with your full mapping logic as needed.
let smooth = { x: window.innerWidth/2, y: window.innerHeight/2 };
const smoothFactor = 0.12;

async function runTracking(landmarker) {
  if (!landmarker) return;
  try {
    const res = await landmarker.detectForVideo(video, performance.now());
    if (!res || !res.faceLandmarks || !res.faceLandmarks.length) {
      requestAnimationFrame(() => runTracking(landmarker));
      return;
    }
    const lm = res.faceLandmarks[0];
    const leftEye = lm[33], rightEye = lm[263], leftIris = lm[468], rightIris = lm[473];
    if (!leftEye || !rightEye || !leftIris || !rightIris) {
      requestAnimationFrame(() => runTracking(landmarker));
      return;
    }

    // simple fallback mapping so you can at least see a response — this avoids hangs
    const faceCenter = { x:(leftEye.x+rightEye.x)/2, y:(leftEye.y+rightEye.y)/2 };
    const irisAvg = { x:(leftIris.x+rightIris.x)/2, y:(leftIris.y+rightIris.y)/2 };
    const offsetX = irisAvg.x - faceCenter.x;
    const offsetY = irisAvg.y - faceCenter.y;

    // fallback multiplier (small)
    const gain = 4.0;
    let rawX = 0.5 + offsetX * gain;
    let rawY = 0.5 + offsetY * gain;

    // mirror preview is set by CSS in your page; if mirrored visually we flip X mapping so movement matches preview
    const mirrored = (getComputedStyle(video).transform.indexOf('-1') !== -1);
    if (mirrored) rawX = 0.5 - offsetX * gain;

    let px = window.innerWidth * clamp(rawX, 0, 1);
    let py = window.innerHeight * clamp(rawY, 0, 1);

    smooth.x = smooth.x * (1 - smoothFactor) + px * smoothFactor;
    smooth.y = smooth.y * (1 - smoothFactor) + py * smoothFactor;

    dot.style.left = `${smooth.x}px`;
    dot.style.top  = `${smooth.y}px`;

    // debug (small)
    debugEl.style.display = "block";
    debugEl.innerText = `OK — running\nraw: ${rawX.toFixed(3)}, ${rawY.toFixed(3)}\npx: ${Math.round(px)}, ${Math.round(py)}`;

  } catch (err) {
    console.error("Tracking frame error:", err);
    debugEl.style.display = "block";
    debugEl.innerText = "Tracking frame error: " + (err.message || err);
  } finally {
    requestAnimationFrame(() => runTracking(landmarker));
  }
}

// small helper clamp
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

// start initial loader
startLoader();
