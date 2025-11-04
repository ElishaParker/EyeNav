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
    status.textContent = "Loading MediaPipe model...";

    // Load WASM and create FaceLandmarker instance
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
    );

    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "./face_landmarker.task", // local file in same folder
      },
      outputFaceBlendshapes: false,
      runningMode: "VIDEO",
      numFaces: 1
    });

    // Start webcam
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;

    status.textContent = "Tracking active — look around 👁️";
    runTracking();
  } catch (err) {
    console.error("Initialization error:", err);
    status.textContent = "Error loading model or webcam access.";
  }
}

// --- Tracking loop -----------------------------------------------------------
const smooth = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
const smoothFactor = 0.2; // lower = smoother

async function runTracking() {
  if (!faceLandmarker) return;

  const results = await faceLandmarker.detectForVideo(video, performance.now());

  if (results.faceLandmarks.length) {
    const lm = results.faceLandmarks[0];
    const leftIris  = lm[468];
    const rightIris = lm[473];

    if (leftIris && rightIris) {
      // Average the two pupils
      const cx = (leftIris.x + rightIris.x) / 2;
      const cy = (leftIris.y + rightIris.y) / 2;

      // Convert normalized 0–1 → pixels (mirrored horizontally)
      let x = (1 - cx) * window.innerWidth;
      let y = cy * window.innerHeight;

      // Smooth and clamp
      smooth.x = smooth.x * (1 - smoothFactor) + x * smoothFactor;
      smooth.y = smooth.y * (1 - smoothFactor) + y * smoothFactor;
      smooth.x = Math.max(0, Math.min(window.innerWidth,  smooth.x));
      smooth.y = Math.max(0, Math.min(window.innerHeight, smooth.y));

      dot.style.left = `${smooth.x}px`;
      dot.style.top  = `${smooth.y}px`;
    }
  }

  requestAnimationFrame(runTracking);
}

// --- Resize handler ----------------------------------------------------------
window.addEventListener("resize", () => {
  smooth.x = window.innerWidth / 2;
  smooth.y = window.innerHeight / 2;
});

// --- Launch ------------------------------------------------------------------
async function init() {
  try {
    status.textContent = "Loading MediaPipe model...";

    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
    );

    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: "./face_landmarker.task" },
      outputFaceBlendshapes: false,
      runningMode: "VIDEO",
      numFaces: 1
    });

    // Start webcam
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;

    // 🟢 Wait for camera to actually have dimensions before processing
    await new Promise((resolve) => {
      video.onloadedmetadata = () => {
        video.play();
        resolve();
      };
    });

    status.textContent = "Tracking active — look around 👁️";
    runTracking();
  } catch (err) {
    console.error("Initialization error:", err);
    status.textContent = "Error loading model or webcam access.";
  }
}

init();
