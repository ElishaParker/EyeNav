import {
  FaceLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0";

const video  = document.getElementById("videoFeed");
const dot    = document.getElementById("dot");
const status = document.getElementById("status");

let faceLandmarker;
let baselineFaceCenter = null;
let baselineIrisAvg = null;

// --- Initialize --------------------------------------------------------------
async function init() {
  try {
    status.textContent = "Loading model...";

    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
    );

    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: "./face_landmarker.task" },
      runningMode: "VIDEO",
      numFaces: 1
    });

    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;

    await new Promise(resolve => {
      video.onloadedmetadata = () => { video.play(); resolve(); };
    });

    status.textContent = "Tracking active — move only your eyes 👁️";
    runTracking();
  } catch (err) {
    console.error(err);
    status.textContent = "Initialization error — see console";
  }
}

// --- Tracking loop -----------------------------------------------------------
const smooth = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
const smoothFactor = 0.2;

async function runTracking() {
  if (!faceLandmarker) return;

  const res = await faceLandmarker.detectForVideo(video, performance.now());
  if (!res.faceLandmarks.length) {
    requestAnimationFrame(runTracking);
    return;
  }

  const lm = res.faceLandmarks[0];
  const noseTip   = lm[1];
  const leftEye   = lm[33];
  const rightEye  = lm[263];
  const leftIris  = lm[468];
  const rightIris = lm[473];

  const faceCenter = {
    x: (leftEye.x + rightEye.x) / 2,
    y: (leftEye.y + rightEye.y) / 2,
  };
  const irisAvg = {
    x: (leftIris.x + rightIris.x) / 2,
    y: (leftIris.y + rightIris.y) / 2,
  };

  // --- capture baseline once when neutral ---
  if (!baselineFaceCenter) {
    baselineFaceCenter = { ...faceCenter };
    baselineIrisAvg    = { ...irisAvg };
    console.log("Baseline captured");
  }

  // --- compute relative deltas vs baseline ---
  const relFace = {
    x: faceCenter.x - baselineFaceCenter.x,
    y: faceCenter.y - baselineFaceCenter.y
  };
  const relIris = {
    x: irisAvg.x - baselineIrisAvg.x,
    y: irisAvg.y - baselineIrisAvg.y
  };

  // --- eye offset relative to neutral head ---
  const offsetX = relIris.x - relFace.x;
  const offsetY = relIris.y - relFace.y;

  // --- same calibration values as before ---
  const gainX = 6.0;
  const gainY = 6.0;
  const correctedX = offsetX * gainX;
  const correctedY = offsetY * gainY;

  let x = window.innerWidth  * (0.4809 - correctedX * 2.18);
  let y = window.innerHeight * (0.56 + correctedY * 7);

  const scaleBoost = 3.452;
  x = window.innerWidth  / 2 + (x - window.innerWidth  / 2) * scaleBoost;
  y = window.innerHeight / 2 + (y - window.innerHeight / 2) * scaleBoost;

  smooth.x = smooth.x * (1 - smoothFactor) + x * smoothFactor;
  smooth.y = smooth.y * (1 - smoothFactor) + y * smoothFactor;
  smooth.x = Math.max(0, Math.min(window.innerWidth,  smooth.x));
  smooth.y = Math.max(0, Math.min(window.innerHeight, smooth.y));

  dot.style.left = `${smooth.x}px`;
  dot.style.top  = `${smooth.y}px`;

  requestAnimationFrame(runTracking);
}

// --- Resize handler ----------------------------------------------------------
window.addEventListener("resize", () => {
  smooth.x = window.innerWidth / 2;
  smooth.y = window.innerHeight / 2;
});

// --- Launch ------------------------------------------------------------------
init();
