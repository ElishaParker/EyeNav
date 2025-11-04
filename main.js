window.addEventListener('load', () => {
  const dot = document.getElementById('dot');
  let smoothX = window.innerWidth / 2;
  let smoothY = window.innerHeight / 2;
  const smoothFactor = 0.2;

  // --- Initialize WebGazer ---
  webgazer.setRegression('ridge')
    .setTracker('clmtrackr')
    .begin()
    .then(() => {
      webgazer.showVideo(false);
      webgazer.showFaceOverlay(false);
      webgazer.showFaceFeedbackBox(false);
      webgazer.showPredictionPoints(false);
      webgazer.saveDataAcrossSessions(true); // auto persist calibration
      if (webgazer.params) {
        webgazer.params.showGazeDot = false;
        webgazer.params.applyKalmanFilter = true;
      }
    });

  // --- Gaze smoothing & dot movement ---
  webgazer.setGazeListener((data) => {
    if (!data) return;
    data.x = window.innerWidth - data.x;
    data.x -= window.innerWidth / 2;
    data.y -= window.innerHeight / 2;

  // Optional scaling (tune if needed)
    const scaleX = 1.0;
    const scaleY = 1.0;

  // Shift back into screen space
    data.x = window.innerWidth / 2 + data.x * scaleX;
    data.y = window.innerHeight / 2 + data.y * scaleY;
    smoothX = smoothX * (1 - smoothFactor) + data.x * smoothFactor;
    smoothY = smoothY * (1 - smoothFactor) + data.y * smoothFactor;
    dot.style.left = `${smoothX - 8}px`;
    dot.style.top  = `${smoothY - 8}px`;
  });

  window.addEventListener('resize', () => {
    smoothX = window.innerWidth / 2;
    smoothY = window.innerHeight / 2;
  });

  // --- Calibration overlay setup ---
  const calBtn = document.getElementById('startCal');
  const resetBtn = document.getElementById('resetCal');
  const calBox = document.getElementById('calibration');
  const calPoints = Array.from(document.querySelectorAll('.cal-point'));
  const positions = [
    {x:0.1, y:0.1}, {x:0.9, y:0.1}, {x:0.5, y:0.5},
    {x:0.1, y:0.9}, {x:0.9, y:0.9}
  ];

  calBtn.onclick = async () => {
    calBtn.style.visibility = 'hidden';
    calBox.style.visibility = 'visible';
    await runCalibration();
    calBox.style.visibility = 'hidden';
    calBtn.style.visibility = 'visible';

    // 🔧 force model retraining after full calibration
    webgazer.train();

    alert('Calibration complete ✅');
  };

  async function runCalibration() {
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      const el = calPoints[i];
      el.style.left = `${p.x * window.innerWidth - 15}px`;
      el.style.top  = `${p.y * window.innerHeight - 15}px`;
      el.classList.add('active');

      await collectPoint(p);
      el.classList.remove('active');
    }
  }

  function collectPoint(p) {
    return new Promise(resolve => {
      const duration = 1500; // ms to sample each point
      const start = performance.now();
      const timer = setInterval(() => {
        const now = performance.now();
        if (now - start > duration) {
          clearInterval(timer);
          // 🔧 retrain the model after each calibration point
          webgazer.train();
          resolve();
        } else {
          webgazer.recordScreenPosition(
            p.x * window.innerWidth,
            p.y * window.innerHeight,
            'cal'
          );
        }
      }, 100);
    });
  }

  // --- Reset calibration manually ---
  resetBtn.onclick = () => {
    indexedDB.deleteDatabase('webgazer');
    alert('Calibration reset – you can recalibrate now.');
  };
});
