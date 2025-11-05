// main.js (module)
// Requires: face_landmarker.task present in same folder
import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0";

const video = document.getElementById("videoFeed");
const dot   = document.getElementById("dot");
const statusText = document.getElementById("statusText");

// UI controls (must exist in your HTML)
const eyeMode = document.getElementById("eyeMode");
const mirrorToggle = document.getElementById("mirrorToggle");
const gainXSlider = document.getElementById("gainX");
const gainYSlider = document.getElementById("gainY");
const scaleBoostSlider = document.getElementById("scaleBoost");
const smoothSlider = document.getElementById("smoothFactor");
const refFaceSizeSlider = document.getElementById("refFaceSize");
const zeroCenterBtn = document.getElementById("zeroCenter");
// value displays
const gainXval = document.getElementById("gainXval");
const gainYval = document.getElementById("gainYval");
const scaleVal = document.getElementById("scaleVal");
const smoothVal = document.getElementById("smoothVal");
const refSizeVal = document.getElementById("refSizeVal");

let faceLandmarker = null;

// --- Calibration state ---
let neutral = null;            // { faceCenter:{x,y}, irisAvg:{x,y}, faceSize }
let recenterRequested = false; // when true, next valid frame will set neutral
let lastSeenFace = null;       // last raw face values seen (for recenter or debugging)

// smoothing state
const smooth = { x: window.innerWidth/2, y: window.innerHeight/2 };
let smoothFactor = parseFloat(smoothSlider.value);

// default reference face size (normalized inter-eye distance)
let referenceFaceSize = parseFloat(refFaceSizeSlider.value);

// helper: clamp
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// update UI displays
function updateDisplays() {
  gainXval.textContent = parseFloat(gainXSlider.value).toFixed(2);
  gainYval.textContent = parseFloat(gainYSlider.value).toFixed(2);
  scaleVal.textContent = parseFloat(scaleBoostSlider.value).toFixed(2);
  smoothVal.textContent = parseFloat(smoothSlider.value).toFixed(3);
  refSizeVal.textContent = parseFloat(refFaceSizeSlider.value).toFixed(3);
}
updateDisplays();

// wire slider UI
[gainXSlider, gainYSlider, scaleBoostSlider, smoothSlider, refFaceSizeSlider].forEach(el => {
  el.addEventListener("input", () => {
    updateDisplays();
    smoothFactor = parseFloat(smoothSlider.value);
    referenceFaceSize = parseFloat(refFaceSizeSlider.value);
  });
});

mirrorToggle.addEventListener("change", () => {
  // visually mirror preview like a selfie if checked
  video.style.transform = mirrorToggle.checked ? "scaleX(-1)" : "scaleX(1)";
});

// recenter calibration baseline (user action)
zeroCenterBtn.addEventListener("click", () => {
  // request recenter; the next good frame will capture neutral values
  recenterRequested = true;
  statusText.textContent = "Recenter requested — hold eyes at center for one frame...";
});

// --- Initialization: MediaPipe face landmarker --------------------------------
async function init() {
  try {
    statusText.textContent = "Loading model...";
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
    );

    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: "./face_landmarker.task" },
      runningMode: "VIDEO",
      numFaces: 1
    });

    // start webcam with sensible resolution
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }});
    video.srcObject = stream;

    await new Promise(resolve => {
      video.onloadedmetadata = () => { video.play(); resolve(); };
    });

    // apply initial mirror state
    video.style.transform = mirrorToggle.checked ? "scaleX(-1)" : "scaleX(1)";

    statusText.textContent = "Tracking active — move only your eyes 👁️";
    requestAnimationFrame(runTracking);
  } catch (err) {
    console.error("Init error:", err);
    statusText.textContent = "Initialization error — see console";
  }
}

// --- Main tracking loop ------------------------------------------------------
async function runTracking() {
  if (!faceLandmarker) {
    requestAnimationFrame(runTracking);
    return;
  }

  try {
    const res = await faceLandmarker.detectForVideo(video, performance.now());
    if (!res || !res.faceLandmarks || !res.faceLandmarks.length) {
      requestAnimationFrame(runTracking);
      return;
    }

    const lm = res.faceLandmarks[0];

    // landmarks of interest (MediaPipe indexing)
    const leftEye  = lm[33];
    const rightEye = lm[263];
    const leftIris = lm[468];
    const rightIris= lm[473];

    // robust: ensure landmarks exist
    if (!leftEye || !rightEye || !leftIris || !rightIris) {
      requestAnimationFrame(runTracking);
      return;
    }

    // face center = mid of eye anchors (outer corners)
    const faceCenter = {
      x: (leftEye.x + rightEye.x) / 2,
      y: (leftEye.y + rightEye.y) / 2
    };

    // faceSize (inter-eye) for distance normalization
    const faceSize = Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y);

    // choose which iris to use (left/right/both)
    const mode = (eyeMode && eyeMode.value) ? eyeMode.value : "both";
    let irisAvg;
    if (mode === "left") {
      irisAvg = { x: leftIris.x, y: leftIris.y };
    } else if (mode === "right") {
      irisAvg = { x: rightIris.x, y: rightIris.y };
    } else {
      irisAvg = { x: (leftIris.x + rightIris.x)/2, y: (leftIris.y + rightIris.y)/2 };
    }

    // stash lastSeen for debugging/recenter capture
    lastSeenFace = { faceCenter, irisAvg, faceSize };

    // If recenter requested by user, capture neutral on this frame
    if (recenterRequested) {
      neutral = {
        faceCenter: { ...faceCenter },
        irisAvg:     { ...irisAvg },
        faceSize:    faceSize || referenceFaceSize
      };
      recenterRequested = false;
      statusText.textContent = "Recentered — neutral captured";
      // continue to mapping with new neutral
    }

    // If neutral not set yet (first run), auto-set neutral gently (so users don't have to click)
    // This avoids total drift on first run, but user can always Recenter explicitly.
    if (!neutral) {
      neutral = {
        faceCenter: { ...faceCenter },
        irisAvg: { ...irisAvg },
        faceSize: faceSize || referenceFaceSize
      };
      statusText.textContent = "Auto-neutral set — click Recenter to override";
    }

    // ---------------- Mapping logic (clear & single-scaling) ----------------
    // 1) compute relative iris displacement from neutral (decouples head translation)
    //    using: d = iris - neutral.iris
    let dX = irisAvg.x - neutral.irisAvg.x; // positive -> right in camera coords
    let dY = irisAvg.y - neutral.irisAvg.y; // positive -> down in camera coords

    // 2) normalize by face size (so camera distance changes don't change sensitivity)
    const small = 1e-6;
    const normFaceSize = (faceSize > small) ? faceSize : (neutral.faceSize || referenceFaceSize);
    const distanceNorm = referenceFaceSize || 0.06; // fallback (slider)
    // We normalize by either the measured face size or user reference. This keeps deltas stable.
    const normFactor = normFaceSize || distanceNorm;
    dX = dX / normFactor;
    dY = dY / normFactor;

    // 3) apply gain (from UI sliders). Gains are in "units per normalized eye movement"
    const gainX = parseFloat(gainXSlider.value);
    const gainY = parseFloat(gainYSlider.value);

    dX *= gainX;
    dY *= gainY;

    // 4) clamp extremes to avoid runaway when gains are large
    const CLAMP = 3.0; // normalized clamp (safe); you can increase to allow larger extremes
    dX = clamp(dX, -CLAMP, CLAMP);
    dY = clamp(dY, -CLAMP, CLAMP);

    // 5) convert dX/dY into pixel target relative to screen center
    //    We use a "screenRange" so full +/-1 normalized maps to a portion of screen (not necessarily entire)
    const screenRangeX = (window.innerWidth / 2) * 0.98; // how far horizontally from center we can go
    const screenRangeY = (window.innerHeight / 2) * 0.96; // vertical range

    // Mirroring: if the preview is mirrored visually, flip horizontal sign so movement matches user's view
    const mirrorFactor = mirrorToggle.checked ? -1 : 1;

    const centerX = window.innerWidth  * 0.5;
    const centerY = window.innerHeight * 0.5;

    let targetX = centerX + (dX * mirrorFactor) * screenRangeX;
    let targetY = centerY + (dY) * screenRangeY; // positive dY -> down

    // 6) user scaleBoost UI: this amplifies or compresses movement from center.
    //    This is a single extra multiply around the "distance from center" to allow pushing to edges.
    const scaleBoost = parseFloat(scaleBoostSlider.value);
    targetX = centerX + (targetX - centerX) * scaleBoost;
    targetY = centerY + (targetY - centerY) * scaleBoost;

    // 7) optional tiny fine offsets (keep zero unless you need micro-corrections)
    const fineOffsetX = 0.0;
    const fineOffsetY = 0.0;
    targetX = targetX + fineOffsetX * window.innerWidth;
    targetY = targetY + fineOffsetY * window.innerHeight;

    // 8) clamp to viewport
    let px = clamp(targetX, 0, window.innerWidth);
    let py = clamp(targetY, 0, window.innerHeight);

    // 9) smooth the final coordinates (exponential smoothing)
    smooth.x = smooth.x * (1 - smoothFactor) + px * smoothFactor;
    smooth.y = smooth.y * (1 - smoothFactor) + py * smoothFactor;

    // 10) apply to dot (dot is centered with translate(-50%,-50%) in CSS)
    dot.style.left = `${smooth.x}px`;
    dot.style.top  = `${smooth.y}px`;

    // end mapping-----------------------------------------------------------

  } catch (err) {
    console.warn("Tracking frame error:", err);
  } finally {
    requestAnimationFrame(runTracking);
  }
}

// react to resize
window.addEventListener("resize", () => {
  smooth.x = window.innerWidth/2;
  smooth.y = window.innerHeight/2;
});

// start
init();
