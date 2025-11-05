// main.js (module) — replacement
// Requires: face_landmarker.task present in same folder
import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0";

const video = document.getElementById("videoFeed");
const dot   = document.getElementById("dot");
const statusText = document.getElementById("statusText");
const debugEl = document.getElementById("debug");

// UI controls
const eyeMode = document.getElementById("eyeMode");
const mirrorToggle = document.getElementById("mirrorToggle");
const invertYBox = document.getElementById("invertY");
const gainXSlider = document.getElementById("gainX");
const gainYSlider = document.getElementById("gainY");
const scaleBoostSlider = document.getElementById("scaleBoost");
const smoothSlider = document.getElementById("smoothFactor");
const refFaceSizeSlider = document.getElementById("refFaceSize");
const zeroCenterBtn = document.getElementById("zeroCenter");
const toggleControlsBtn = document.getElementById("toggleControls");
const controlsPane = document.getElementById("controls");
const appRoot = document.getElementById("app");

// value displays
const gainXval = document.getElementById("gainXval");
const gainYval = document.getElementById("gainYval");
const scaleVal = document.getElementById("scaleVal");
const smoothVal = document.getElementById("smoothVal");
const refSizeVal = document.getElementById("refSizeVal");

let faceLandmarker = null;

// smoothing state
const smooth = { x: window.innerWidth/2, y: window.innerHeight/2 };
let smoothFactor = parseFloat(smoothSlider.value);

// reference face size for distance normalization
let referenceFaceSize = parseFloat(refFaceSizeSlider.value);

// recenter baseline (gazeRel baseline). When recentered we store gazeRel (eyes relative to face) and subtract it later
let baselineGaze = { x: 0, y: 0 };
let hasBaseline = false;

function updateDisplays() {
  gainXval.textContent = parseFloat(gainXSlider.value).toFixed(2);
  gainYval.textContent = parseFloat(gainYSlider.value).toFixed(2);
  scaleVal.textContent = parseFloat(scaleBoostSlider.value).toFixed(2);
  smoothVal.textContent = parseFloat(smoothSlider.value).toFixed(3);
  refSizeVal.textContent = parseFloat(refFaceSizeSlider.value).toFixed(3);
}
updateDisplays();

[gainXSlider, gainYSlider, scaleBoostSlider, smoothSlider, refFaceSizeSlider].forEach(el => {
  el.addEventListener("input", () => {
    updateDisplays();
    smoothFactor = parseFloat(smoothSlider.value);
    referenceFaceSize = parseFloat(refFaceSizeSlider.value);
  });
});

mirrorToggle.addEventListener("change", () => {
  // toggle visual mirror (JS controls transform so style & logic align)
  video.style.transform = mirrorToggle.checked ? "scaleX(-1)" : "scaleX(1)";
});

toggleControlsBtn.addEventListener("click", () => {
  appRoot.classList.toggle("controls-collapsed");
  // change button label
  toggleControlsBtn.textContent = appRoot.classList.contains("controls-collapsed") ? "Show" : "Collapse";
});

// zero center calibration: capture current gazeRel on next frame
zeroCenterBtn.addEventListener("click", () => {
  // set flag so next tracking frame stores baseline
  requestBaselineOnce = true;
  statusText.textContent = "Recentered — move eyes to center and continue";
});

// helper: clamp
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

let requestBaselineOnce = false;

// --- Initialization ----------------------------------------------------------
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

    // start webcam at reasonable size; model expects typical sizes
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

// --- Tracking loop ----------------------------------------------------------
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

    // landmarks used (MediaPipe indexing)
    const leftEye   = lm[33];
    const rightEye  = lm[263];
    const leftIris  = lm[468];
    const rightIris = lm[473];

    if (!leftEye || !rightEye || !leftIris || !rightIris) {
      requestAnimationFrame(runTracking);
      return;
    }

    // face center (outer eye anchors)
    const faceCenter = {
      x: (leftEye.x + rightEye.x) / 2,
      y: (leftEye.y + rightEye.y) / 2,
      z: (leftEye.z + rightEye.z) / 2
    };

    // face size (normalized inter-eye distance)
    const faceSize = Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y);

    // choose which iris we use
    const mode = eyeMode.value || "both";
    const irisAvg = (mode === "left")
      ? { x: leftIris.x, y: leftIris.y }
      : (mode === "right")
        ? { x: rightIris.x, y: rightIris.y }
        : { x: (leftIris.x + rightIris.x)/2, y: (leftIris.y + rightIris.y)/2 };

    // gaze relative to face center -> this cancels head translation automatically
    const gazeRel = { x: irisAvg.x - faceCenter.x, y: irisAvg.y - faceCenter.y };

    // If user clicked recenter, capture baseline gazeRel once
    if (requestBaselineOnce) {
      baselineGaze.x = gazeRel.x;
      baselineGaze.y = gazeRel.y;
      hasBaseline = true;
      requestBaselineOnce = false;
      // show debug briefly
      statusText.textContent = "Recentered — neutral captured";
      setTimeout(()=> statusText.textContent = "Tracking active — move only your eyes 👁️", 1400);
    }

    // compute centered gaze = gazeRel minus baseline (if available)
    const centered = {
      x: gazeRel.x - (hasBaseline ? baselineGaze.x : 0),
      y: gazeRel.y - (hasBaseline ? baselineGaze.y : 0)
    };

    // Depth/size normalization: boost when face is small (far) so movement is consistent
    const small = 1e-6;
    const depthScale = clamp(referenceFaceSize / (faceSize + small), 0.6, 4.0);

    // Gains from UI
    const gainX = parseFloat(gainXSlider.value);
    const gainY = parseFloat(gainYSlider.value);

    // Apply gains and depth normalization
    let correctedX = centered.x * gainX * depthScale;
    let correctedY = centered.y * gainY * depthScale;

    // invert Y if requested
    if (invertYBox.checked) correctedY = -correctedY;

    // Map to normalized screen coords (0..1), center = 0.5
    // If preview is mirrored we flip X mapping so visual + cursor directions match mental model
    let rawX = 0.5 + correctedX;
    let rawY = 0.5 + correctedY;
    if (mirrorToggle.checked) rawX = 0.5 - correctedX;

    // optional small fine offsets (tweak here if camera is angled)
    const fineOffsetX = 0.0;
    const fineOffsetY = 0.0;

    // Map normalized to pixel coordinates
    let px = window.innerWidth  * clamp(rawX + fineOffsetX, 0, 1);
    let py = window.innerHeight * clamp(rawY + fineOffsetY, 0, 1);

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

    // set dot (dot is centered via translate(-50%,-50%))
    dot.style.left = `${smooth.x}px`;
    dot.style.top  = `${smooth.y}px`;

    // debug overlay (toggle automatically visible while tuning)
    if (debugEl) {
      debugEl.style.display = "block";
      debugEl.innerHTML = `
        <div><b>gazeRel</b> ${gazeRel.x.toFixed(4)}, ${gazeRel.y.toFixed(4)}</div>
        <div><b>centered</b> ${centered.x.toFixed(4)}, ${centered.y.toFixed(4)}</div>
        <div><b>corrected</b> ${correctedX.toFixed(4)}, ${correctedY.toFixed(4)}</div>
        <div><b>faceSize</b> ${faceSize.toFixed(4)} depthScale:${depthScale.toFixed(3)}</div>
        <div><b>raw</b> ${rawX.toFixed(3)}, ${rawY.toFixed(3)}</div>
        <div><b>px</b> ${px.toFixed(1)}, ${py.toFixed(1)}</div>
        <div style="opacity:.7; margin-top:6px;">Mirror:${mirrorToggle.checked}  InvertY:${invertYBox.checked}</div>
      `;
    }

  } catch (err) {
    console.warn("Tracking frame error:", err);
  } finally {
    requestAnimationFrame(runTracking);
  }
}

// resize reaction
window.addEventListener("resize", () => {
  smooth.x = window.innerWidth/2;
  smooth.y = window.innerHeight/2;
});

// start
init();
