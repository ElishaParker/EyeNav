import {
  FaceLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0";

const video  = document.getElementById("videoFeed");
const dot    = document.getElementById("dot");
const status = document.getElementById("status");

let faceLandmarker;

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
const smoothFactor = 0.08;

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

  // Offsets: normalized differences (centered around 0)
  const offsetX = (irisAvg.x - faceCenter.x);
  const offsetY = (irisAvg.y - faceCenter.y);

  // Apply nonlinear gain to expand small eye movements
  const gainX = 12.5;   // boost horizontal motion
  const gainY = 33.3;   // boost vertical motion
  const correctedX = offsetX * gainX;
  const correctedY = offsetY * gainY;

  // Map to screen space (invert X)
  let x = window.innerWidth  * (0.482 - correctedX * 1.161);
  let y = window.innerHeight * (0.507 + correctedY * 1.3);


  // --- 🔧 Global amplification multiplier ---
const scaleBoost = 3.455; // increase if still confined; try 3–5
x = window.innerWidth  / 2 + (x - window.innerWidth  / 2) * scaleBoost;
y = window.innerHeight / 2 + (y - window.innerHeight / 2) * scaleBoost;

  // Smooth + clamp
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
