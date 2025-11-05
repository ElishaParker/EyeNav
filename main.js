import {
  FaceLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0";

const video   = document.getElementById("videoFeed");
const dot     = document.getElementById("dot");
const status  = document.getElementById("status");
const eyeMode = document.getElementById("eyeToggle");

let faceLandmarker;
let baselineDepth = null;

// -------------------------------- INIT --------------------------------------
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

    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;
    await new Promise(r => video.onloadedmetadata = () => { video.play(); r(); });

    status.textContent = "Tracking active 👁️";
    runTracking();
  } catch(e) {
    console.error(e);
    status.textContent = "Initialization error.";
  }
}

// -------------------------------- TRACK LOOP --------------------------------
const smooth = {x: innerWidth/2, y: innerHeight/2};
const smoothFactor = 0.18;

async function runTracking() {
  if(!faceLandmarker){requestAnimationFrame(runTracking);return;}

  const res = await faceLandmarker.detectForVideo(video, performance.now());
  if(!res.faceLandmarks.length){requestAnimationFrame(runTracking);return;}

  const lm = res.faceLandmarks[0];
  const leftEyeOuter = lm[33];
  const rightEyeOuter = lm[263];
  const leftIris = lm[468];
  const rightIris = lm[473];
  const noseTip = lm[1];

  // --- select eye(s) --------------------------------------------------------
  const eyeChoice = eyeMode.value;
  let eyeCenter, irisCenter;
  if(eyeChoice === "left"){
    eyeCenter = leftEyeOuter;
    irisCenter = leftIris;
  } else if(eyeChoice === "right"){
    eyeCenter = rightEyeOuter;
    irisCenter = rightIris;
  } else {
    eyeCenter = {
      x:(leftEyeOuter.x+rightEyeOuter.x)/2,
      y:(leftEyeOuter.y+rightEyeOuter.y)/2,
      z:(leftEyeOuter.z+rightEyeOuter.z)/2
    };
    irisCenter = {
      x:(leftIris.x+rightIris.x)/2,
      y:(leftIris.y+rightIris.y)/2,
      z:(leftIris.z+rightIris.z)/2
    };
  }

  // --- establish baseline depth --------------------------------------------
  if(!baselineDepth) baselineDepth = Math.abs(noseTip.z);

  // --- 3D vectors -----------------------------------------------------------
  const gazeVec = {
    x: irisCenter.x - eyeCenter.x,
    y: irisCenter.y - eyeCenter.y,
    z: irisCenter.z - eyeCenter.z
  };
  // normalize
  const len = Math.hypot(gazeVec.x, gazeVec.y, gazeVec.z) || 1;
  gazeVec.x/=len; gazeVec.y/=len; gazeVec.z/=len;

  // --- head position (approx center) ---------------------------------------
  const faceCenter = {
    x:(leftEyeOuter.x+rightEyeOuter.x)/2,
    y:(leftEyeOuter.y+rightEyeOuter.y)/2,
    z:(leftEyeOuter.z+rightEyeOuter.z)/2
  };

  // --- depth compensation ---------------------------------------------------
  const depthScale = baselineDepth / Math.abs(faceCenter.z || 1);

  // --- screen-plane intersection -------------------------------------------
  // simple pinhole-camera projection model:
  const FOV = 60 * Math.PI/180;  // ~60° horizontal webcam FOV
  const focalLength = 0.5 / Math.tan(FOV/2); // normalized focal length

  // project gaze vector from eyeCenter toward z=0 (screen plane)
  const t = faceCenter.z / Math.abs(gazeVec.z || 1e-6);
  const hitX = (eyeCenter.x + gazeVec.x * t) * depthScale;
  const hitY = (eyeCenter.y + gazeVec.y * t) * depthScale;

  // --- convert normalized (0–1) → screen px -------------------------------
  const rect = video.getBoundingClientRect();
  const mirroredX = rect.left + (rect.right - hitX*rect.width);
  const screenX = (mirroredX - rect.left) / rect.width;
  const screenY = hitY;

  let x = innerWidth  * screenX;
  let y = innerHeight * screenY;

  // --- smoothing ------------------------------------------------------------
  smooth.x = smooth.x*(1-smoothFactor)+x*smoothFactor;
  smooth.y = smooth.y*(1-smoothFactor)+y*smoothFactor;
  smooth.x = Math.max(0,Math.min(innerWidth ,smooth.x));
  smooth.y = Math.max(0,Math.min(innerHeight,smooth.y));

  dot.style.left = `${smooth.x-9}px`;
  dot.style.top  = `${smooth.y-9}px`;

  requestAnimationFrame(runTracking);
}

// -------------------------------- EVENTS ------------------------------------
addEventListener("resize",()=>{smooth.x=innerWidth/2;smooth.y=innerHeight/2;});
init();

