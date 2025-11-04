import {
  FaceLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0";

const video  = document.getElementById("videoFeed");
const dot    = document.getElementById("dot");
const status = document.getElementById("status");

let faceLandmarker;

// -----------------------------------------------------------------------------
// INIT
// -----------------------------------------------------------------------------
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

    // wait for valid frame dimensions
    await new Promise((resolve) => {
      video.onloadedmetadata = () => { video.play(); resolve(); };
    });

    status.textContent = "Tracking active — move your eyes 👁️";
    runTracking();
  } catch (err) {
    console.error(err);
    status.textContent = "Initialization error — see console";
  }
}

// -----------------------------------------------------------------------------
// TRACKING LOOP
// -----------------------------------------------------------------------------
const smooth = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
const smoothFactor = 0.25;

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

  // --- 1. Compute head pose (face normal)
  const faceCenter = {
    x: (leftEye.x + rightEye.x) / 2,
    y: (leftEye.y + rightEye.y) / 2,
    z: (leftEye.z + rightEye.z) / 2
  };
  const faceDir = {
    x: noseTip.x - faceCenter.x,
    y: noseTip.y - faceCenter.y,
    z: noseTip.z - faceCenter.z
  };

  // --- 2. Compute average iris offset
  const irisAvg = {
    x: (leftIris.x + rightIris.x) / 2,
    y: (leftIris.y + rightIris.y) / 2,
    z: (leftIris.z + rightIris.z) / 2
  };
  const eyeOffset = {
    x: irisAvg.x - faceCenter.x,
    y: irisAvg.y - faceCenter.y,
    z: irisAvg.z - faceCenter.z
  };

  // --- 3. Combine head direction and eye offset to approximate gaze vector
  const gazeVec = {
    x: faceDir.x + eyeOffset.x * 3.0,
    y: faceDir.y + eyeOffset.y * 3.0,
    z: faceDir.z + eyeOffset.z * 3.0
  };

  // --- 4. Map to screen coordinates
  let x = (0.5 - gazeVec.x) * window.innerWidth;
  let y = (0.5 + gazeVec.y) * window.innerHeight;

  // --- 5. Smooth and clamp
  smooth.x = smooth.x * (1 - smoothFactor) + x * smoothFactor;
  smooth.y = smooth.y * (1 - smoothFactor) + y * smoothFactor;
  smooth.x = Math.max(0, Math.min(window.innerWidth,  smooth.x));
  smooth.y = Math.max(0, Math.min(window.innerHeight, smooth.y));

  dot.style.left = `${smooth.x}px`;
  dot.style.top  = `${smooth.y}px`;

  requestAnimationFrame(runTracking);
}

// -----------------------------------------------------------------------------
// UTILITIES
// -----------------------------------------------------------------------------
window.addEventListener("resize", () => {
  smooth.x = window.innerWidth / 2;
  smooth.y = window.innerHeight / 2;
});

// Launch
init();
