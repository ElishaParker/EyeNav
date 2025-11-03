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
      if (webgazer.params) {
        webgazer.params.showGazeDot = false;
        webgazer.params.applyKalmanFilter = true;
      }
    });

  // --- Gaze dot smoothing ---
  webgazer.setGazeListener((data) => {
    if (!data) return;
    smoothX = smoothX * (1 - smoothFactor) + data.x * smoothFactor;
    smoothY = smoothY * (1 - smoothFactor) + data.y * smoothFactor;
    dot.style.left = `${smoothX - 8}px`;
    dot.style.top  = `${smoothY - 8}px`;
  });

  window.addEventListener('resize', () => {
    smoothX = window.innerWidth / 2;
    smoothY = window.innerHeight / 2;
  });

  // --- Calibration Logic ---
  const calBtn = document.getElementById('startCal');
  const calBox = document.getElementById('calibration');
  const calPoints = Array.from(document.querySelectorAll('.cal-point'));

  const positions = [
    {x:0.1, y:0.1}, // top-left
    {x:0.9, y:0.1}, // top-right
    {x:0.5, y:0.5}, // center
    {x:0.1, y:0.9}, // bottom-left
    {x:0.9, y:0.9}  // bottom-right
  ];

  calBtn.onclick = async () => {
    calBtn.style.visibility = 'hidden';
    calBox.style.visibility = 'visible';
    await runCalibration();
    calBox.style.visibility = 'hidden';
    calBtn.style.visibility = 'visible';
    alert('Calibration complete ✅');
  };

  async function runCalibration() {
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      const el = calPoints[i];
      el.style.position = 'fixed';
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

  // --- Save/Load Calibration ---
  document.getElementById('saveCal').onclick = async () => {
    const model = await webgazer.getStoredData();
    if (!model) {
      alert('No calibration data found yet!');
      return;
    }
    localStorage.setItem('webgazerModel', JSON.stringify(model));
    alert('Calibration saved locally ✅');
  };

  document.getElementById('loadCal').onclick = async () => {
    const modelStr = localStorage.getItem('webgazerModel');
    if (!modelStr) {
      alert('No saved calibration data found!');
      return;
    }
    const model = JSON.parse(modelStr);
    await webgazer.setStoredData(model);
    alert('Calibration loaded ✅');
  };
});
