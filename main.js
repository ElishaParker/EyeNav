/*********************************************************************
 * EyeNav3D — Annotated Core
 * ---------------------------------------------------------------
 * This script uses MediaPipe FaceLandmarker to locate eye & iris
 * landmarks and converts them to screen coordinates.
 *********************************************************************/

import {
  FaceLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0";

const video  = document.getElementById("videoFeed");
const dot    = document.getElementById("dot");
const status = document.getElementById("status");

let faceLandmarker;
let baselineDepth = null;   // used for distance normalization

/*********************************************************************
 *  SECTION 1: Initialization
 *  - Sets up webcam stream
 *  - Loads MediaPipe model
 *********************************************************************/
async function init() {
  try {
    status.textContent = "Loading model…";

    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
    );

    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: "./face_landmarker.task" },
      runningMode: "VIDEO",
      numFaces: 1
    });

    // 🎥 Start camera
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;
    await new Promise(r => video.onloadedmetadata = () => { video.play(); r(); });

    status.textContent = "Tracking active 👁️";
    runTracking();
  } catch (err) {
    console.error(err);
    status.textContent = "Error initializing camera/model.";
  }
}

/*********************************************************************
 *  SECTION 2: Adjustable Parameters
 *  - Change these to tune responsiveness and range.
 *********************************************************************/
const params = {
  smoothFactor: 0.18,   // 0 → instant, 1 → frozen
  gainX: 6.0,           // sensitivity horizontally
  gainY: 6.0,           // sensitivity vertically
  scaleBoost: 3.4,      // enlarges entire motion field
  baseFOV: 60,          // assumed webcam field of view (deg)
};

const smooth = { x: innerWidth/2, y: innerHeight/2 };

/*********************************************************************
 *  SECTION 3: Main Tracking Loop
 *********************************************************************/
async function runTracking() {
  if (!faceLandmarker) { requestAnimationFrame(runTracking); return; }

  const res = await faceLandmarker.detectForVideo(video, performance.now());
  if (!res.faceLandmarks.length) { requestAnimationFrame(runTracking); return; }

  // --- Landmark extraction ---
  const lm = res.faceLandmarks[0];
  const leftEye   = lm[33];
  const rightEye  = lm[263];
  const leftIris  = lm[468];
  const rightIris = lm[473];
  const noseTip   = lm[1];

  // --- Calculate centers ---
  const faceCenter = {
    x: (leftEye.x + rightEye.x) / 2,
    y: (leftEye.y + rightEye.y) / 2,
    z: (leftEye.z + rightEye.z) / 2,
  };
  const irisAvg = {
    x: (leftIris.x + rightIris.x) / 2,
    y: (leftIris.y + rightIris.y) / 2,
    z: (leftIris.z + rightIris.z) / 2,
  };

  // --- Distance normalization ---
  if (!baselineDepth) baselineDepth = Math.abs(faceCenter.z);
  const depthScale = baselineDepth / Math.abs(faceCenter.z || 1);

  /*******************************************************************
   *  STEP A: Compute relative eye offset
   *  offset = iris - faceCenter
   *******************************************************************/
  const offset = {
    x: (irisAvg.x - faceCenter.x) * params.gainX * depthScale,
    y: (irisAvg.y - faceCenter.y) * params.gainY * depthScale
  };

  /*******************************************************************
   *  STEP B: Convert normalized coordinates (0–1) → screen px
   *  0.5 = center of screen.
   *******************************************************************/
  let x = innerWidth  * (0.5 - offset.x * 2.0);
  let y = innerHeight * (0.5 + offset.y * 2.0);

  // Apply global amplification
  x = innerWidth  /2 + (x - innerWidth /2) * params.scaleBoost;
  y = innerHeight /2 + (y - innerHeight/2) * params.scaleBoost;

  /*******************************************************************
   *  STEP C: Smoothing and Clamping
   *******************************************************************/
  smooth.x = smooth.x*(1-params.smoothFactor) + x*params.smoothFactor;
  smooth.y = smooth.y*(1-params.smoothFactor) + y*params.smoothFactor;
  smooth.x = Math.max(0, Math.min(innerWidth , smooth.x));
  smooth.y = Math.max(0, Math.min(innerHeight, smooth.y));

  /*******************************************************************
   *  STEP D: Draw cursor dot
   *******************************************************************/
  dot.style.left = `${smooth.x-10}px`;
  dot.style.top  = `${smooth.y-10}px`;

  /*******************************************************************
   *  (Optional) Diagnostic Overlay in console
   *******************************************************************/
  // console.log({offset, depthScale, smooth});

  requestAnimationFrame(runTracking);
}

/*********************************************************************
 *  SECTION 4: Utility Events
 *********************************************************************/
addEventListener("resize", () => {
  smooth.x = innerWidth / 2;
  smooth.y = innerHeight / 2;
});

init();
