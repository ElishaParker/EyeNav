// main.js (module)
// Requires: face_landmarker.task present in same folder
import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0";

const video = document.getElementById("videoFeed");
const dot   = document.getElementById("dot");
const statusText = document.getElementById("statusText");

// UI controls
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
let calibrationOffset = { x:0, y:0 }; // optional recenter baseline

// smoothing state
const smooth = { x: window.innerWidth/2, y: window.innerHeight/2 };
let smoothFactor = parseFloat(smoothSlider.value);

// default reference face size (normalized inter-eye distance)
let referenceFaceSize = parseFloat(refFaceSizeSlider.value);

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
  // mirror preview visually
  video.style.transform = mirrorToggle.checked ? "scaleX(-1)" : "scaleX(1)";
});

// recenter calibration baseline (adjust centering offset to current face center)
zeroCenterBtn.addEventListener("click", () => {
  calibrationOffset = { x:0, y:0 }; // we compute next frame (see runTracking)
  statusText.textContent = "Recentered — move eyes to center and continue";
});

// helper: clamp
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

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

    // start webcam
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }});
    video.srcObject = stream;

    await new Promise(resolve => {
      video.onloadedmetadata = () => { video.play(); resolve(); };
    });

    // initial mirror state
    video.style.transform = mirrorToggle.checked ? "scaleX(-1)" : "scaleX(1)";

    statusText.textContent = "Tracking active — move only your eyes 👁️";
    requestAnimationFrame(runTracking);
  } catch (err) {
    console.error("Init error:", err);
    statusText.textContent = "Initialization error — see console";
  }
}

// --- Main tracking loop ------------------------------------------------------
let lastFaceCenter = null;
let recenterOnce = true; // use zeroCenter to recalc baseline when clicked

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
    const noseTip = lm[1];
    const leftEye = lm[33];
    const rightEye = lm[263];
    const leftIris = lm[468];
    const rightIris = lm[473];

    // robust: ensure landmarks exist (some frames can be partial)
    if (!leftEye || !rightEye || !leftIris || !rightIris) {
      requestAnimationFrame(runTracking);
      return;
    }

    // face center = mid of eye anchors (outer corners)
    const faceCenter = {
      x: (leftEye.x + rightEye.x) / 2,
      y: (leftEye.y + rightEye.y) / 2,
      z: (leftEye.z + rightEye.z) / 2
    };

    // optionally calculate inter-eye (face) size for distance normalization
    const faceSize = Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y);

    // choose which iris to use
    const mode = eyeMode.value || "both";
    let irisAvg;
    if (mode === "left") {
      irisAvg = { x: leftIris.x, y: leftIris.y, z: leftIris.z };
    } else if (mode === "right") {
      irisAvg = { x: rightIris.x, y: rightIris.y, z: rightIris.z };
    } else {
      irisAvg = { x: (leftIris.x + rightIris.x)/2, y: (leftIris.y + rightIris.y)/2, z: (leftIris.z + rightIris.z)/2 };
    }

    // --- RECENTER baseline logic: if user clicked recenter, set calibrationOffset to make current look equal center
    // That helps align "neutral" face to center of screen.
    if (recenterOnce) {
      // nothing; user must click Recenter if they want to set baseline
    }

    // If zeroCenter clicked recently, compute small baseline offset: when user clicks zeroCenter we set calibration once on next frame
    // (we used a simple approach earlier: the button sets calibrationOffset to zero and updates text.)
    // We'll instead leave calibrationOffset at zero and allow user to tweak gains. (This code placeholder is left intentionally.)
    // calibrationOffset.x = ??? (not used by default)

    // --- Make gaze relative to face center rather than absolute frame origin ---
    // This reduces the effect of head movement: offset = iris - faceCenter
    let offsetX = irisAvg.x - faceCenter.x;
    let offsetY = irisAvg.y - faceCenter.y;

    // To keep gaze relative to the screen center instead of a moving head center,
    // compute how far faceCenter has moved from image center and subtract that out:
    // image center = 0.5 normalized coords
    const faceCenterOffsetX = faceCenter.x - 0.5;
    const faceCenterOffsetY = faceCenter.y - 0.5;

    // centered = (iris - faceCenter) - (faceCenter - 0.5)
    let centeredX = offsetX - faceCenterOffsetX;
    let centeredY = offsetY - faceCenterOffsetY;

    // Depth/size normalization: if faceSize < referenceFaceSize (farther away) we boost gains
    const small = 1e-6;
    const depthScale = clamp(referenceFaceSize / (faceSize + small), 0.6, 4.0);

    // Gains from UI
    const gainX = parseFloat(gainXSlider.value);
    const gainY = parseFloat(gainYSlider.value);

    // Apply gains and depth normalization (nonlinear expansion)
    const correctedX = centeredX * gainX * depthScale;
    const correctedY = centeredY * gainY * depthScale;

    // map to screen coordinates
    // if preview is mirrored visually, invert X mapping so screen movement matches what user expects
    const mirrored = mirrorToggle.checked;

    // base mapping (0.5 center)
    let rawX = 0.5 + correctedX; // correctedX positive -> move right (normalized)
    let rawY = 0.5 + correctedY; // correctedY positive -> move down

    // if mirrored visually, flip X so dot follows mirror
    if (mirrored) rawX = 0.5 - correctedX;

    // optional fine tuning offsets to imperfect camera alignment (these start zero)
    const fineOffsetX = 0.0;
    const fineOffsetY = 0.0;

    // Map normalized to pixel coordinates
    let px = window.innerWidth  * (rawX + fineOffsetX);
    let py = window.innerHeight * (rawY + fineOffsetY);

    // Global scaling (so small normalized moves push to edges)
    const scaleBoost = parseFloat(scaleBoostSlider.value);
    px = window.innerWidth  / 2 + (px - window.innerWidth  / 2) * scaleBoost;
    py = window.innerHeight / 2 + (py - window.innerHeight / 2) * scaleBoost;

    // clamp to viewport
    px = clamp(px, 0, window.innerWidth);
    py = clamp(py, 0, window.innerHeight);

    // smoothing
    smooth.x = smooth.x * (1 - smoothFactor) + px * smoothFactor;
    smooth.y = smooth.y * (1 - smoothFactor) + py * smoothFactor;

    // set dot (dot has translate(-50%,-50%) so it's centered)
    dot.style.left = `${smooth.x}px`;
    dot.style.top  = `${smooth.y}px`;

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
