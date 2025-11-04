import {
  FaceLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0";

const video = document.getElementById("videoFeed");
const dot   = document.getElementById("dot");

// 1. Load the FaceMesh + Iris model
const vision = await FilesetResolver.forVisionTasks(
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
);

const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
  baseOptions: {
    modelAssetPath:
      modelAssetPath:
       "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/face_landmarker.task"

  },
  outputFaceBlendshapes: false,
  runningMode: "VIDEO",
  numFaces: 1
});

// 2. Start webcam
const stream = await navigator.mediaDevices.getUserMedia({ video: true });
video.srcObject = stream;

// 3. Tracking loop
const smooth = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
const smoothFactor = 0.2; // adjust for speed vs stability

async function processFrame() {
  const res = await faceLandmarker.detectForVideo(video, performance.now());
  if (res.faceLandmarks.length) {
    const lm = res.faceLandmarks[0];
    const leftIris  = lm[468];
    const rightIris = lm[473];

    if (leftIris && rightIris) {
      const cx = (leftIris.x + rightIris.x) / 2;
      const cy = (leftIris.y + rightIris.y) / 2;

      // convert normalized 0–1 → pixels, mirror horizontally
      let x = (1 - cx) * window.innerWidth;
      let y = cy * window.innerHeight;

      // smooth and clamp
      smooth.x = smooth.x * (1 - smoothFactor) + x * smoothFactor;
      smooth.y = smooth.y * (1 - smoothFactor) + y * smoothFactor;
      smooth.x = Math.max(0, Math.min(window.innerWidth,  smooth.x));
      smooth.y = Math.max(0, Math.min(window.innerHeight, smooth.y));

      dot.style.left = `${smooth.x}px`;
      dot.style.top  = `${smooth.y}px`;
    }
  }
  requestAnimationFrame(processFrame);
}
processFrame();

// 4. Keep centered on resize
window.addEventListener("resize", () => {
  smooth.x = window.innerWidth / 2;
  smooth.y = window.innerHeight / 2;
});
