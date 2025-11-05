-// main.js — diagnostic loader + original tracking logic
+// main.js — calibrated gaze tracking with stable layout & debug panel
 import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm";
 
+// DOM references ------------------------------------------------------------
 const video = document.getElementById("videoFeed");
+const preview = document.getElementById("preview");
 const dot = document.getElementById("dot");
 const statusText = document.getElementById("statusText");
-const debugEl = document.getElementById("debug") || (() => { const d = document.createElement('div'); d.id='debug'; d.style.display='none'; document.body.appendChild(d); return d; })();
+const debugEl = document.getElementById("debug");
 
+// ensure the cursor begins centered on load
+dot.style.left = `${window.innerWidth / 2}px`;
+dot.style.top = `${window.innerHeight / 2}px`;
+debugEl.style.pointerEvents = "none";
+
+const eyeModeSelect = document.getElementById("eyeMode");
+const mirrorToggle = document.getElementById("mirrorToggle");
+const smoothSlider = document.getElementById("smoothFactor");
+const smoothVal = document.getElementById("smoothVal");
+const refFaceSlider = document.getElementById("refFaceSize");
+const refVal = document.getElementById("refSizeVal");
+const invertYToggle = document.getElementById("invertY");
+const startCalBtn = document.getElementById("startCal");
+const calInstr = document.getElementById("calInstr");
+const recenterBtn = document.getElementById("recenterBtn");
+
+// configuration -------------------------------------------------------------
 const faceLandmarkerTaskPath = "./face_landmarker.task"; // must exist and be served by your HTTP server
 const wasmBaseUrl = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"; // CDN (default)
 const FETCH_TIMEOUT = 10000; // ms
+const DEBUG_INTERVAL = 200; // throttle debug panel (5×/s)
+
+// state ---------------------------------------------------------------------
+let smoothPoint = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
+let smoothFactor = parseFloat(smoothSlider?.value || "0.04");
+let referenceFaceSize = parseFloat(refFaceSlider?.value || "0.13");
+let lastDebug = 0;
+let currentEyeMode = eyeModeSelect?.value || "both";
+let mirrored = mirrorToggle?.checked ?? true;
+let invertY = invertYToggle?.checked ?? false;
+
+// Baseline (neutral) and calibration bounds derived from samples
+const neutral = { x: 0, y: 0 };
+const calibration = {
+  active: false,
+  collecting: false,
+  stepIndex: -1,
+  collectStart: 0,
+  samples: { left: [], right: [], up: [], down: [] },
+  bounds: { minX: -0.28, maxX: 0.28, minY: -0.22, maxY: 0.22 }
+};
+
+const calibrationSteps = [
+  { key: "left", message: "Look to the far LEFT edge", duration: 1600 },
+  { key: "right", message: "Look to the far RIGHT edge", duration: 1600 },
+  { key: "up", message: "Look at the TOP edge", duration: 1600 },
+  { key: "down", message: "Look at the BOTTOM edge", duration: 1600 }
+];
 
+// UI helpers ----------------------------------------------------------------
 function setStatus(msg) {
   statusText.textContent = msg;
   console.log("[EyeNav]", msg);
 }
 
+function positionDebugPanel() {
+  if (!preview || !debugEl) return;
+  const rect = preview.getBoundingClientRect();
+  const width = debugEl.offsetWidth || 240;
+  const height = debugEl.offsetHeight || 110;
+  let left = rect.right + 20;
+  let top = rect.top;
+
+  if (left + width > window.innerWidth - 12) {
+    left = window.innerWidth - width - 12;
+  }
+  left = Math.max(12, left);
+
+  if (top + height > window.innerHeight - 12) {
+    top = window.innerHeight - height - 12;
+  }
+  top = Math.max(12, top);
+
+  debugEl.style.left = `${left}px`;
+  debugEl.style.top = `${top}px`;
+}
+
+window.addEventListener("resize", () => {
+  positionDebugPanel();
+  smoothPoint = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
+});
+
+if (smoothSlider) {
+  smoothVal.textContent = smoothSlider.value;
+  smoothSlider.addEventListener("input", () => {
+    smoothFactor = parseFloat(smoothSlider.value);
+    smoothVal.textContent = smoothSlider.value;
+  });
+}
+
+if (refFaceSlider) {
+  refVal.textContent = refFaceSlider.value;
+  refFaceSlider.addEventListener("input", () => {
+    referenceFaceSize = parseFloat(refFaceSlider.value);
+    refVal.textContent = refFaceSlider.value;
+  });
+}
+
+if (mirrorToggle) {
+  const applyMirror = () => {
+    mirrored = mirrorToggle.checked;
+    video.style.transform = mirrored ? "scaleX(-1)" : "scaleX(1)";
+  };
+  mirrorToggle.addEventListener("change", applyMirror);
+  applyMirror();
+}
+
+if (eyeModeSelect) {
+  eyeModeSelect.addEventListener("change", () => {
+    currentEyeMode = eyeModeSelect.value;
+  });
+}
+
+if (invertYToggle) {
+  invertYToggle.addEventListener("change", () => {
+    invertY = invertYToggle.checked;
+  });
+}
+
+if (recenterBtn) {
+  recenterBtn.addEventListener("click", () => {
+    neutralizeToCurrent();
+    calInstr.textContent = "Baseline recentered to the screen midpoint.";
+  });
+}
+
+if (startCalBtn) {
+  startCalBtn.addEventListener("click", () => {
+    if (calibration.active) return;
+    beginCalibration();
+  });
+}
+
+// network / loader ----------------------------------------------------------
 function timeoutFetch(url, ms = FETCH_TIMEOUT) {
   const ac = new AbortController();
   const id = setTimeout(() => ac.abort(), ms);
   return fetch(url, { signal: ac.signal }).finally(() => clearTimeout(id));
 }
 
 async function preflightChecks() {
   setStatus("Checking resources (preflight)...");
   // 1) Check wasm base reachable
   try {
-    await timeoutFetch(wasmBaseUrl + "/package.json", 8000); // a small file on the CDN
+    await timeoutFetch(wasmBaseUrl + "/package.json", 8000);
     console.log("WASM CDN reachable.");
   } catch (err) {
     console.warn("WASM CDN unreachable:", err);
     throw new Error(`Cannot reach MediaPipe wasm CDN at:\n${wasmBaseUrl}\n\nNetwork/CORS or offline environment?`);
   }
 
   // 2) Check local face_landmarker.task
   try {
     const r = await timeoutFetch(faceLandmarkerTaskPath, 8000);
     if (!r.ok) throw new Error(`HTTP ${r.status}`);
     console.log("Found local face_landmarker.task (OK).");
   } catch (err) {
     console.warn("face_landmarker.task fetch failed:", err);
     throw new Error(`Cannot fetch local model file: ${faceLandmarkerTaskPath}\nMake sure the file exists and you're serving via HTTP(S). Try running:\n  python3 -m http.server 8000\nand open http://localhost:8000/`);
   }
 }
 
-// Helpful UI Retry button injection
 function showErrorUI(message) {
   setStatus("Error — see details");
-  debugEl.style.display = "block";
-  debugEl.innerHTML = `<div style="color: #ff8cbf; font-weight:600;">ERROR</div><pre style="white-space:pre-wrap;color:#fff">${message}</pre>
+  debugEl.innerHTML = `<div style="color:#ff8cbf;font-weight:600;">ERROR</div><pre style="white-space:pre-wrap;color:#fff">${message}</pre>
     <div style="margin-top:8px;"><button id="retryLoader">Retry</button></div>
     <div style="margin-top:6px;color:#9df7ef;font-size:12px">If you're using local files: run a simple server (python -m http.server), ensure face_landmarker.task is in the same folder, and allow camera access.</div>`;
+  debugEl.style.pointerEvents = "auto";
+  positionDebugPanel();
   const btn = document.getElementById("retryLoader");
-  btn.addEventListener("click", () => { debugEl.style.display = "none"; startLoader(); });
+  if (btn) {
+    btn.addEventListener("click", () => {
+      debugEl.textContent = "Retrying…";
+      debugEl.style.pointerEvents = "none";
+      startLoader();
+    });
+  }
 }
 
-// Main loader that runs the model creation and then starts tracking
 async function startLoader() {
   try {
     setStatus("Preflight: verifying network and model files...");
     await preflightChecks();
 
     setStatus("Loading MediaPipe vision wasm files...");
-    // FilesetResolver.forVisionTasks expects the wasm base path (already set in wasmBaseUrl)
     const vision = await FilesetResolver.forVisionTasks(wasmBaseUrl);
     setStatus("Creating FaceLandmarker model (may take a few seconds)...");
     const fl = await FaceLandmarker.createFromOptions(vision, {
       baseOptions: { modelAssetPath: faceLandmarkerTaskPath },
       runningMode: "VIDEO",
       numFaces: 1
     });
-    window._faceLandmarker = fl; // expose for console debugging
+    window._faceLandmarker = fl;
     setStatus("Model loaded — starting webcam");
     await startCameraAndRun(fl);
   } catch (err) {
     console.error("Loader error:", err);
     showErrorUI(err.stack || err.message || String(err));
   }
 }
 
 async function startCameraAndRun(faceLandmarker) {
   try {
-    // start webcam
     const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
     video.srcObject = stream;
     await new Promise(resolve => { video.onloadedmetadata = () => { video.play(); resolve(); }; });
 
     setStatus("Tracking active — move only your eyes 👁️");
+    neutralizeToCurrent();
+    positionDebugPanel();
     runTracking(faceLandmarker);
   } catch (err) {
     console.error("Camera start error:", err);
     showErrorUI("Camera error: " + (err.message || String(err)) + "\nConfirm browser permissions and that a camera exists.");
   }
 }
 
-// A compact tracking loop (keeps your app behavior). Replace with your full mapping logic as needed.
-let smooth = { x: window.innerWidth/2, y: window.innerHeight/2 };
-const smoothFactor = 0.12;
+// calibration ---------------------------------------------------------------
+function beginCalibration() {
+  calibration.active = true;
+  calibration.stepIndex = -1;
+  calibration.samples = { left: [], right: [], up: [], down: [] };
+  startCalBtn.disabled = true;
+  calInstr.textContent = "Stabilizing before sampling...";
+  neutralizeToCurrent();
+  advanceCalibration();
+}
+
+function advanceCalibration() {
+  calibration.collecting = false;
+  calibration.stepIndex += 1;
+  if (calibration.stepIndex >= calibrationSteps.length) {
+    finalizeCalibration();
+    return;
+  }
+  const step = calibrationSteps[calibration.stepIndex];
+  calInstr.textContent = step.message;
+  // give user a short delay to move gaze
+  setTimeout(() => {
+    calibration.collecting = true;
+    calibration.collectStart = performance.now();
+  }, 450);
+}
+
+function finalizeCalibration() {
+  calibration.active = false;
+  calibration.collecting = false;
+  startCalBtn.disabled = false;
+
+  const averages = {
+    left: mean(calibration.samples.left) ?? calibration.bounds.minX,
+    right: mean(calibration.samples.right) ?? calibration.bounds.maxX,
+    up: mean(calibration.samples.up) ?? calibration.bounds.minY,
+    down: mean(calibration.samples.down) ?? calibration.bounds.maxY
+  };
+
+  // Ensure bounds retain sensible ordering (left negative, right positive, etc.)
+  calibration.bounds.minX = Math.min(averages.left, -0.1);
+  calibration.bounds.maxX = Math.max(averages.right, 0.1);
+  calibration.bounds.minY = Math.min(averages.up, -0.08);
+  calibration.bounds.maxY = Math.max(averages.down, 0.08);
+
+  calInstr.textContent = "Calibration complete. Sample again if needed.";
+}
+
+function neutralizeToCurrent() {
+  // Wait for a frame via RAF so we can grab latest derived metrics
+  if (!latestMetrics) {
+    neutral.x = 0;
+    neutral.y = 0;
+    smoothPoint = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
+    return;
+  }
+  neutral.x = latestMetrics.normX;
+  neutral.y = latestMetrics.normY;
+  smoothPoint = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
+}
+
+// tracking -----------------------------------------------------------------
+let latestMetrics = null;
 
 async function runTracking(landmarker) {
   if (!landmarker) return;
   try {
     const res = await landmarker.detectForVideo(video, performance.now());
     if (!res || !res.faceLandmarks || !res.faceLandmarks.length) {
       requestAnimationFrame(() => runTracking(landmarker));
       return;
     }
+
     const lm = res.faceLandmarks[0];
-    const leftEye = lm[33], rightEye = lm[263], leftIris = lm[468], rightIris = lm[473];
-    if (!leftEye || !rightEye || !leftIris || !rightIris) {
+    const metrics = deriveEyeMetrics(lm);
+    if (!metrics) {
       requestAnimationFrame(() => runTracking(landmarker));
       return;
     }
 
-    // simple fallback mapping so you can at least see a response — this avoids hangs
-    const faceCenter = { x:(leftEye.x+rightEye.x)/2, y:(leftEye.y+rightEye.y)/2 };
-    const irisAvg = { x:(leftIris.x+rightIris.x)/2, y:(leftIris.y+rightIris.y)/2 };
-    const offsetX = irisAvg.x - faceCenter.x;
-    const offsetY = irisAvg.y - faceCenter.y;
-
-    // fallback multiplier (small)
-    const gain = 4.0;
-    let rawX = 0.5 + offsetX * gain;
-    let rawY = 0.5 + offsetY * gain;
+    latestMetrics = metrics;
 
-    // mirror preview is set by CSS in your page; if mirrored visually we flip X mapping so movement matches preview
-    const mirrored = (getComputedStyle(video).transform.indexOf('-1') !== -1);
-    if (mirrored) rawX = 0.5 - offsetX * gain;
+    if (calibration.active && calibration.collecting) {
+      const step = calibrationSteps[calibration.stepIndex];
+      const elapsed = performance.now() - calibration.collectStart;
+      if (step && elapsed <= step.duration) {
+        // Use scaled deltas (already depth compensated) to establish extents
+        if (step.key === "left") calibration.samples.left.push(metrics.deltaX);
+        if (step.key === "right") calibration.samples.right.push(metrics.deltaX);
+        if (step.key === "up") calibration.samples.up.push(metrics.deltaY);
+        if (step.key === "down") calibration.samples.down.push(metrics.deltaY);
+      } else if (step && elapsed > step.duration) {
+        advanceCalibration();
+      }
+    }
 
-    let px = window.innerWidth * clamp(rawX, 0, 1);
-    let py = window.innerHeight * clamp(rawY, 0, 1);
+    const mappedX = mapToScreen(metrics.deltaX, calibration.bounds.minX, calibration.bounds.maxX);
+    const mappedY = mapToScreen(metrics.deltaY, calibration.bounds.minY, calibration.bounds.maxY);
 
-    smooth.x = smooth.x * (1 - smoothFactor) + px * smoothFactor;
-    smooth.y = smooth.y * (1 - smoothFactor) + py * smoothFactor;
+    const px = clamp(mappedX * window.innerWidth, 0, window.innerWidth);
+    const py = clamp(mappedY * window.innerHeight, 0, window.innerHeight);
 
-    dot.style.left = `${smooth.x}px`;
-    dot.style.top  = `${smooth.y}px`;
+    smoothPoint.x = lerp(smoothPoint.x, px, smoothFactor);
+    smoothPoint.y = lerp(smoothPoint.y, py, smoothFactor);
 
-    // debug (small)
-    debugEl.style.display = "block";
-    debugEl.innerText = `OK — running\nraw: ${rawX.toFixed(3)}, ${rawY.toFixed(3)}\npx: ${Math.round(px)}, ${Math.round(py)}`;
+    dot.style.left = `${smoothPoint.x}px`;
+    dot.style.top = `${smoothPoint.y}px`;
 
+    updateDebug(metrics, mappedX, mappedY);
   } catch (err) {
     console.error("Tracking frame error:", err);
-    debugEl.style.display = "block";
-    debugEl.innerText = "Tracking frame error: " + (err.message || err);
+    debugEl.textContent = "Tracking frame error: " + (err.message || err);
   } finally {
     requestAnimationFrame(() => runTracking(landmarker));
   }
 }
 
-// small helper clamp
-function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
+function deriveEyeMetrics(lm) {
+  const leftEye = buildEye(lm, 33, 133, 159, 145, 468);
+  const rightEye = buildEye(lm, 362, 263, 386, 374, 473);
+  if (!leftEye || !rightEye) return null;
+
+  let selected = null;
+  if (currentEyeMode === "left") selected = leftEye;
+  else if (currentEyeMode === "right") selected = rightEye;
+  else selected = blendEyes(leftEye, rightEye);
+
+  const faceWidth = (leftEye.width + rightEye.width) / 2;
+  const depthScale = clamp(referenceFaceSize / (faceWidth || referenceFaceSize), 0.65, 1.6);
+
+  let normX = selected.normX;
+  let normY = selected.normY;
+
+  if (mirrored) normX *= -1;
+  if (invertY) normY *= -1;
+
+  const deltaX = (normX - neutral.x) * depthScale;
+  const deltaY = (normY - neutral.y) * depthScale;
+
+  const centeredX = neutral.x + deltaX;
+  const centeredY = neutral.y + deltaY;
+
+  return { deltaX, deltaY, centeredX, centeredY, faceWidth, depthScale, normX, normY };
+}
+
+function buildEye(lm, outerIdx, innerIdx, upperIdx, lowerIdx, irisIdx) {
+  const outer = lm[outerIdx];
+  const inner = lm[innerIdx];
+  const upper = lm[upperIdx];
+  const lower = lm[lowerIdx];
+  const iris = lm[irisIdx];
+  if (!outer || !inner || !upper || !lower || !iris) return null;
+
+  const width = distance(outer, inner);
+  const height = distance(upper, lower);
+  if (width <= 0 || height <= 0) return null;
+
+  const centerX = (outer.x + inner.x) / 2;
+  const centerY = (upper.y + lower.y) / 2;
+
+  const normX = (iris.x - centerX) / (width / 2);
+  const normY = (iris.y - centerY) / (height / 2);
+
+  return { normX, normY, width, height };
+}
+
+function blendEyes(left, right) {
+  return {
+    normX: (left.normX + right.normX) / 2,
+    normY: (left.normY + right.normY) / 2,
+    width: (left.width + right.width) / 2,
+    height: (left.height + right.height) / 2
+  };
+}
+
+// utilities -----------------------------------------------------------------
+function mapToScreen(delta, minBound, maxBound) {
+  let ratio = 0;
+  if (delta >= 0) ratio = maxBound !== 0 ? clamp(delta / maxBound, -1, 1) : 0;
+  else ratio = minBound !== 0 ? clamp(delta / Math.abs(minBound), -1, 1) : 0;
+  return clamp(0.5 + ratio * 0.5, 0, 1);
+}
+
+function updateDebug(metrics, normalizedX, normalizedY) {
+  const now = performance.now();
+  if (now - lastDebug < DEBUG_INTERVAL) return;
+  lastDebug = now;
+  const centeredX = (normalizedX - 0.5) * 2;
+  const centeredY = (normalizedY - 0.5) * 2;
+  const lines = [
+    `centeredX: ${centeredX.toFixed(3)}`,
+    `centeredY: ${centeredY.toFixed(3)}`,
+    `faceSize: ${metrics.faceWidth.toFixed(4)}`,
+    `depthScale: ${metrics.depthScale.toFixed(3)}`
+  ];
+  debugEl.textContent = lines.join("\n");
+  debugEl.style.pointerEvents = "none";
+  positionDebugPanel();
+}
+
+function distance(a, b) {
+  const dx = a.x - b.x;
+  const dy = a.y - b.y;
+  return Math.hypot(dx, dy);
+}
+
+function clamp(v, min, max) {
+  return Math.max(min, Math.min(max, v));
+}
+
+function lerp(a, b, t) {
+  return a * (1 - t) + b * t;
+}
+
+function mean(arr) {
+  if (!arr || !arr.length) return undefined;
+  return arr.reduce((sum, v) => sum + v, 0) / arr.length;
+}
 
-// start initial loader
+// kick things off -----------------------------------------------------------
+positionDebugPanel();
 startLoader();
 
EOF
)
