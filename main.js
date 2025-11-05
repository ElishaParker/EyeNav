// main.js — calibration mapping version (no H/V gain sliders)
// Requires face_landmarker.task in same folder
import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm";

const video = document.getElementById("videoFeed");
const dot = document.getElementById("dot");
const statusText = document.getElementById("statusText");
const debugEl = document.getElementById("debug");

// controls
const eyeMode = document.getElementById("eyeMode");
const mirrorToggle = document.getElementById("mirrorToggle");
const invertYBox = document.getElementById("invertY");
const smoothSlider = document.getElementById("smoothFactor");
const refFaceSizeSlider = document.getElementById("refFaceSize");
const startCalBtn = document.getElementById("startCal");
const calInstr = document.getElementById("calInstr");
const recenterBtn = document.getElementById("recenterBtn");
const smoothVal = document.getElementById("smoothVal");
const refSizeVal = document.getElementById("refSizeVal");

let faceLandmarker = null;
let smoothFactor = parseFloat(smoothSlider.value);
let referenceFaceSize = parseFloat(refFaceSizeSlider.value);

// smoothing state
const smooth = { x: window.innerWidth/2, y: window.innerHeight/2 };

// calibration storage
const calTargets = ['center','left','right','top','bottom'];
let calIndex = -1;
let calAccum = []; // collect frames for current target
const calSamples = 30; // average N frames per target
const calData = {}; // store averaged gazeRel per target

// mapping linear coefficients (after calibration)
let mapA = { x: 0, y: 0 };
let mapB = { x: 0, y: 0 };
let calibrated = false;

// baseline neutral quick recenter
let baselineGaze = { x: 0, y: 0 };
let hasBaseline = false;

// debug toggle (show by default during tuning)
debugEl.style.display = "block";

// update displays
function updateDisplays(){
  smoothVal.textContent = parseFloat(smoothSlider.value).toFixed(3);
  refSizeVal.textContent = parseFloat(refFaceSizeSlider.value).toFixed(3);
}
updateDisplays();
[smoothSlider, refFaceSizeSlider].forEach(el => el.addEventListener('input', ()=>{ updateDisplays(); smoothFactor = parseFloat(smoothSlider.value); referenceFaceSize = parseFloat(refFaceSizeSlider.value); }));

// mirror toggle visually via JS so logic and preview align
mirrorToggle.addEventListener('change', ()=> {
  video.style.transform = mirrorToggle.checked ? 'scaleX(-1)' : 'scaleX(1)';
});

// quick neutral recenter (capture current gazeRel baseline)
recenterBtn.addEventListener('click', ()=> {
  requestBaselineOnce = true;
  statusText.textContent = "Quick recenter captured";
  setTimeout(()=> statusText.textContent = "Tracking active — move only your eyes 👁️", 1200);
});

// Calibration flow handlers
startCalBtn.addEventListener('click', ()=> {
  if (!faceLandmarker) return;
  calIndex = 0;
  calAccum = [];
  calData.center = calData.left = calData.right = calData.top = calData.bottom = null;
  calibrated = false;
  mapA = {x:0,y:0}; mapB = {x:0,y:0};
  calInstr.textContent = `Calibration step: look at CENTER then click Start Calibration again to capture.`;
  startCalBtn.textContent = "Capture Current Target";
});

// When user clicks again we capture current target average (or if calIndex already running we allow collecting)
startCalBtn.addEventListener('click', ()=>{ /* handled in runTracking loop by reading request to capture frames */ });

// We'll use a flag to capture frame-average when user clicks 'Capture Current Target'
let captureRequested = false;
startCalBtn.addEventListener('click', ()=> {
  if (calIndex === -1) return; // not in flow
  // first click set up capture phase; actual accumulation happens inside runTracking
  captureRequested = true;
});

// helper clamp
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));

// baseline capture via button
let requestBaselineOnce = false;

// initialize MediaPipe
async function init(){
  try {
    statusText.textContent = "Loading model...";
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm");

    faceLandmarker = await FaceLandmarker.createFromOptions(vision,{
      baseOptions: { modelAssetPath: "./face_landmarker.task" },
      runningMode: "VIDEO",
      numFaces: 1
    });

    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }});
    video.srcObject = stream;
    await new Promise(r => video.onloadedmetadata = ()=> { video.play(); r(); });

    video.style.transform = mirrorToggle.checked ? 'scaleX(-1)' : 'scaleX(1)';
    statusText.textContent = "Tracking active — move only your eyes 👁️";
    requestAnimationFrame(runTracking);
  } catch(err){
    console.error("Init err",err);
    statusText.textContent = "Initialization error — see console";
  }
}

// compute mapping from calibration data:
// for X: we want rawX = a_x * centeredX + b_x  such that centeredX(left) => rawX=0, centeredX(right) => rawX=1
// therefore a_x = 1/(right-left), b_x = -a_x * left
function computeMappingFromCal(){
  if (!calData.left || !calData.right || !calData.top || !calData.bottom) return false;
  const left = calData.left.x, right = calData.right.x;
  const top = calData.top.y, bottom = calData.bottom.y;
  const small = 1e-6;
  if (Math.abs(right - left) < small || Math.abs(bottom - top) < small) return false;

  mapA.x = 1 / (right - left);
  mapB.x = - mapA.x * left;

  mapA.y = 1 / (bottom - top);
  mapB.y = - mapA.y * top;

  calibrated = true;
  statusText.textContent = "Calibration complete — mapped to screen edges";
  return true;
}

// utility: average an array of gazeRel samples
function averageSamples(arr){
  if (!arr.length) return {x:0,y:0};
  const s = arr.reduce((acc,v)=> ({x:acc.x+v.x, y:acc.y+v.y}), {x:0,y:0});
  return { x: s.x/arr.length, y: s.y/arr.length };
}

// --- tracking loop ----------------------------------------------------------
async function runTracking(){
  if (!faceLandmarker) { requestAnimationFrame(runTracking); return; }

  try {
    const res = await faceLandmarker.detectForVideo(video, performance.now());
    if (!res || !res.faceLandmarks || !res.faceLandmarks.length) { requestAnimationFrame(runTracking); return; }

    const lm = res.faceLandmarks[0];
    const leftEye = lm[33], rightEye = lm[263], leftIris = lm[468], rightIris = lm[473];
    if (!leftEye || !rightEye || !leftIris || !rightIris) { requestAnimationFrame(runTracking); return; }

    const faceCenter = { x: (leftEye.x + rightEye.x)/2, y: (leftEye.y + rightEye.y)/2 };
    const faceSize = Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y);

    // choose iris
    const mode = eyeMode.value || "both";
    const irisAvg = (mode === "left") ? {x:leftIris.x, y:leftIris.y} :
                    (mode === "right")? {x:rightIris.x, y:rightIris.y} :
                    { x: (leftIris.x + rightIris.x)/2, y: (leftIris.y + rightIris.y)/2 };

    // gaze relative to face center (cancels head translation)
    const gazeRel = { x: irisAvg.x - faceCenter.x, y: irisAvg.y - faceCenter.y };

    // baseline quick recenter capture
    if (requestBaselineOnce) {
      baselineGaze.x = gazeRel.x;
      baselineGaze.y = gazeRel.y;
      hasBaseline = true;
      requestBaselineOnce = false;
      statusText.textContent = "Neutral baseline set";
      setTimeout(()=> statusText.textContent = "Tracking active — move only your eyes 👁️", 1200);
    }

    // calibration capture logic
    if (calIndex >= 0) {
      // If user clicked Capture: begin packet accumulation for current target
      if (captureRequested) {
        // start/continue accumulation
        calAccum.push({x:gazeRel.x, y:gazeRel.y});
        // show progress
        calInstr.textContent = `Capturing ${calTargets[calIndex]} — ${calAccum.length}/${calSamples}`;
        if (calAccum.length >= calSamples) {
          // average and store
          calData[calTargets[calIndex]] = averageSamples(calAccum.map(v=>({x:v.x, y:v.y})));
          calAccum = [];
          captureRequested = false;
          calIndex++;
          if (calIndex >= calTargets.length) {
            // finish calibration -> compute mapping
            const ok = computeMappingFromCal();
            if (!ok) {
              statusText.textContent = "Calibration failed (degenerate samples). Try again.";
              calInstr.textContent = "Calibration failed — please retry.";
              calIndex = -1;
            } else {
              calInstr.textContent = "Calibration done.";
              calIndex = -1;
            }
          } else {
            calInstr.textContent = `Captured. Now look at: ${calTargets[calIndex].toUpperCase()} and press Capture.`;
          }
        }
      } else {
        // waiting for user to click Capture
        calInstr.textContent = `Ready to capture ${calTargets[calIndex]}. Press Capture to collect ${calSamples} samples.`;
      }
    }

    // compute centered (subtract baseline if exists)
    const centered = {
      x: gazeRel.x - (hasBaseline ? baselineGaze.x : 0),
      y: gazeRel.y - (hasBaseline ? baselineGaze.y : 0)
    };

    // depth normalization
    const small = 1e-6;
    const depthScale = clamp(referenceFaceSize / (faceSize + small), 0.6, 4.0);

    // If calibrated: apply learned linear mapping (per-axis) -> normalized screen coords [0..1]
    let rawX = 0.5;
    let rawY = 0.5;
    if (calibrated) {
      // apply mapping, with depthScale applied before mapping
      const cx = centered.x * depthScale;
      const cy = centered.y * depthScale;
      rawX = mapA.x * cx + mapB.x;
      rawY = mapA.y * cy + mapB.y;
      // if preview mirrored, flip X mapping to match the visual
      if (mirrorToggle.checked) rawX = 1 - rawX;
      // invert Y if user wants inverse vertical
      if (invertYBox.checked) rawY = 1 - rawY;
    } else {
      // fallback behavior (small multiplier so cursor is usable before calibration)
      const fallbackGain = 3.5;
      rawX = mirrorToggle.checked ? 0.5 - (centered.x * fallbackGain) : 0.5 + (centered.x * fallbackGain);
      rawY = 0.5 + (centered.y * fallbackGain) * (invertYBox.checked ? -1 : 1);
    }

    // map to pixels and clamp
    let px = window.innerWidth * clamp(rawX, 0, 1);
    let py = window.innerHeight * clamp(rawY, 0, 1);

    // smoothing
    smooth.x = smooth.x * (1 - smoothFactor) + px * smoothFactor;
    smooth.y = smooth.y * (1 - smoothFactor) + py * smoothFactor;

    dot.style.left = `${smooth.x}px`;
    dot.style.top = `${smooth.y}px`;

    // debug output (useful for screenshots)
    if (debugEl){
      debugEl.style.display = "block";
      debugEl.innerHTML = `
        <div><b>calibrated:</b> ${calibrated}</div>
        <div><b>gazeRel:</b> ${gazeRel.x.toFixed(4)}, ${gazeRel.y.toFixed(4)}</div>
        <div><b>centered:</b> ${centered.x.toFixed(4)}, ${centered.y.toFixed(4)}</div>
        <div><b>depthScale:</b> ${depthScale.toFixed(3)} faceSize:${faceSize.toFixed(4)}</div>
        <div><b>raw:</b> ${rawX.toFixed(3)}, ${rawY.toFixed(3)}</div>
        <div><b>px:</b> ${Math.round(px)}, ${Math.round(py)}</div>
        <div style="opacity:.8; margin-top:6px;">Targets: ${Object.keys(calData).filter(k=>calData[k]).join(', ')}</div>
      `;
    }

  } catch(err){
    console.warn("frame error",err);
  } finally {
    requestAnimationFrame(runTracking);
  }
}

window.addEventListener('resize', ()=> {
  smooth.x = window.innerWidth/2;
  smooth.y = window.innerHeight/2;
});

// start
init();
