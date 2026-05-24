const BACKEND_PORT = 8003;
const API_BASE = (window.location.protocol === 'file:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? `${window.location.protocol === 'file:' ? 'http:' : window.location.protocol}//${window.location.hostname || 'localhost'}:${BACKEND_PORT}`
  : '';
const API_URL = `${API_BASE}/analyze`;

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const browseBtn = document.getElementById('browse-btn');
const uploadSection = document.getElementById('upload-section');
const loading = document.getElementById('loading');
const resultsSection = document.getElementById('results-section');
const resetBtn = document.getElementById('reset-btn');
const phaseTabs = document.getElementById('phase-tabs');
const wrapper = document.getElementById('comparison-wrapper');
const template = document.getElementById('athlete-card-template');

// Manual selection modal elements
const manualFilterToggle = document.getElementById('manual-filter-toggle');
const previewModal = document.getElementById('preview-modal');
const previewChartCanvas = document.getElementById('preview-chart');
const manualStartInput = document.getElementById('manual-start-input');
const manualEndInput = document.getElementById('manual-end-input');
const selectedDistDisplay = document.getElementById('selected-dist-display');
const cancelPreviewBtn = document.getElementById('cancel-preview-btn');
const confirmPreviewBtn = document.getElementById('confirm-preview-btn');
const auto200Btn = document.getElementById('auto-200-btn');
const lock200Checkbox = document.getElementById('lock-200-checkbox');
const selectedTimeDisplay = document.getElementById('selected-time-display');

let currentData = []; // Array to hold responses for up to 3 files
let currentPhase = '4_phase'; // default
let charts = []; // Array to hold chart instances
let currentFiles = []; // Array to hold file objects for re-analysis

// Preview flow variables
let csvFilesToPreview = [];
let currentPreviewIndex = -1;
let previewChartInstance = null;
let currentPreviewData = null;
let lastInteractedInput = null;
let toastDebounceTimeout = null;

// Setup Drag & Drop
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
  dropZone.addEventListener(eventName, preventDefaults, false);
});

function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

['dragenter', 'dragover'].forEach(eventName => {
  dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
});

['dragleave', 'drop'].forEach(eventName => {
  dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
});

dropZone.addEventListener('drop', handleDrop, false);
browseBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

// Helper to find and interpolate velocity at a specific distance odometer value
function getVelocityAtDistance(odoVal) {
  if (!currentPreviewData) return 0;
  const rawX = currentPreviewData.x;
  const rawY = currentPreviewData.y;
  
  let closestIdx = 0;
  let minDiff = Infinity;
  for (let i = 0; i < rawX.length; i++) {
    const diff = Math.abs(rawX[i] - odoVal);
    if (diff < minDiff) {
      minDiff = diff;
      closestIdx = i;
    }
  }
  return rawY[closestIdx];
}

// Floating toast notification system
function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.position = 'fixed';
    container.style.bottom = '2rem';
    container.style.right = '2rem';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '0.5rem';
    container.style.zIndex = '99999';
    container.style.pointerEvents = 'none';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.style.background = 'rgba(15, 23, 42, 0.85)';
  toast.style.backdropFilter = 'blur(10px)';
  toast.style.border = '1px solid rgba(0, 229, 255, 0.3)';
  toast.style.color = '#fff';
  toast.style.padding = '0.75rem 1.25rem';
  toast.style.borderRadius = '8px';
  toast.style.fontSize = '0.9rem';
  toast.style.fontWeight = '600';
  toast.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 0 15px rgba(0, 229, 255, 0.15)';
  toast.style.transition = 'all 0.3s ease';
  toast.style.opacity = '0';
  toast.style.transform = 'translateY(20px)';
  toast.style.display = 'flex';
  toast.style.alignItems = 'center';
  toast.style.gap = '0.5rem';

  const icon = document.createElement('span');
  icon.textContent = type === 'start' ? '🟢' : '🔴';
  toast.appendChild(icon);

  const textNode = document.createElement('span');
  textNode.innerHTML = message;
  toast.appendChild(textNode);

  container.appendChild(toast);

  // Trigger animation
  setTimeout(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  }, 10);

  // Remove toast
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-20px)';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 2500);
}

// Debounce helper to prevent toast spam when keyboard keys are held down
function debouncedToast(message, type) {
  if (toastDebounceTimeout) clearTimeout(toastDebounceTimeout);
  toastDebounceTimeout = setTimeout(() => {
    showToast(message, type);
  }, 400);
}

// Visual highlighting and state tracker for active adjustment point
function setActiveInput(inputElement) {
  lastInteractedInput = inputElement;
  
  const startGrp = document.getElementById('start-control-group');
  const endGrp = document.getElementById('end-control-group');
  
  if (startGrp && endGrp) {
    if (inputElement === manualStartInput) {
      startGrp.classList.add('active-adjustment-group');
      endGrp.classList.remove('active-adjustment-group');
    } else if (inputElement === manualEndInput) {
      endGrp.classList.add('active-adjustment-group');
      startGrp.classList.remove('active-adjustment-group');
    }
  }
}

function handleStartInput() {
  const startVal = parseFloat(manualStartInput.value);
  if (!isNaN(startVal)) {
    if (lock200Checkbox && lock200Checkbox.checked && currentPreviewData) {
      const maxOdo = Math.max(...currentPreviewData.x);
      manualEndInput.value = Math.min(maxOdo, startVal + 200).toFixed(1);
    }
    const startVel = getVelocityAtDistance(startVal);
    debouncedToast(`<strong>Ponto de Início:</strong> ${startVal.toFixed(1)}m <span style="color: var(--accent); margin-left: 0.5rem;">(Vel: ${startVel.toFixed(2)} m/s)</span>`, 'start');
  }
  updatePreviewChart();
}

function handleEndInput() {
  const endVal = parseFloat(manualEndInput.value);
  if (!isNaN(endVal)) {
    if (lock200Checkbox && lock200Checkbox.checked && currentPreviewData) {
      const minOdo = Math.min(...currentPreviewData.x);
      manualStartInput.value = Math.max(minOdo, endVal - 200).toFixed(1);
    }
    const endVel = getVelocityAtDistance(endVal);
    debouncedToast(`<strong>Ponto de Fim:</strong> ${endVal.toFixed(1)}m <span style="color: var(--accent); margin-left: 0.5rem;">(Vel: ${endVel.toFixed(2)} m/s)</span>`, 'end');
  }
  updatePreviewChart();
}

// Manual selection event listeners
if (manualStartInput) {
  manualStartInput.addEventListener('input', handleStartInput);
  manualStartInput.addEventListener('focus', () => setActiveInput(manualStartInput));
  manualStartInput.addEventListener('click', () => setActiveInput(manualStartInput));
}
if (manualEndInput) {
  manualEndInput.addEventListener('input', handleEndInput);
  manualEndInput.addEventListener('focus', () => setActiveInput(manualEndInput));
  manualEndInput.addEventListener('click', () => setActiveInput(manualEndInput));
}

if (lock200Checkbox) {
  lock200Checkbox.addEventListener('change', () => {
    if (lock200Checkbox.checked) {
      handleStartInput();
    }
  });
}

if (auto200Btn) {
  auto200Btn.addEventListener('click', () => {
    const startVal = parseFloat(manualStartInput.value);
    if (!isNaN(startVal) && currentPreviewData) {
      const maxOdo = Math.max(...currentPreviewData.x);
      manualEndInput.value = Math.min(maxOdo, startVal + 200).toFixed(1);
      updatePreviewChart();
    }
  });
}

if (confirmPreviewBtn) {
  confirmPreviewBtn.addEventListener('click', () => {
    const startVal = parseFloat(manualStartInput.value);
    const endVal = parseFloat(manualEndInput.value);

    if (isNaN(startVal) || isNaN(endVal) || startVal >= endVal) {
      alert("Please select a valid start and end distance. Start must be less than end.");
      return;
    }

    const file = csvFilesToPreview[currentPreviewIndex];
    file.manualStart = startVal;
    file.manualEnd = endVal;

    currentPreviewIndex++;
    showPreviewForCurrentIndex();
  });
}

if (cancelPreviewBtn) {
  cancelPreviewBtn.addEventListener('click', () => {
    previewModal.style.display = 'none';
    if (previewChartInstance) {
      previewChartInstance.destroy();
      previewChartInstance = null;
    }
    resetBtn.click();
  });
}

resetBtn.addEventListener('click', () => {
  resultsSection.style.display = 'none';
  uploadSection.style.display = 'flex';
  dropZone.style.display = 'block';
  fileInput.value = '';
  currentData = [];
  currentFiles = [];
  charts.forEach(c => c.destroy());
  charts = [];
  wrapper.innerHTML = '';
});

phaseTabs.addEventListener('click', async (e) => {
  if (e.target.classList.contains('tab')) {
    phaseTabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    e.target.classList.add('active');
    currentPhase = e.target.dataset.phase;
    renderAllCards();
  }
});

function handleDrop(e) {
  const dt = e.dataTransfer;
  const files = dt.files;
  handleFiles(files);
}

async function handleFiles(files) {
  if (files.length === 0) return;
  if (files.length > 3) {
    alert("You can only compare up to 3 files at a time.");
    return;
  }

  currentFiles = Array.from(files);
  currentFiles.forEach(f => {
    f.manualBp1 = null;
    f.manualStart = null;
    f.manualEnd = null;
  });

  const manualFilterEnabled = manualFilterToggle && manualFilterToggle.checked;
  if (manualFilterEnabled) {
    csvFilesToPreview = currentFiles.filter(f => f.name.toLowerCase().endsWith('.csv'));
    if (csvFilesToPreview.length > 0) {
      currentPreviewIndex = 0;
      await showPreviewForCurrentIndex();
      return;
    }
  }

  await runAnalysis();
}

async function fetchPreviewData(file) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE}/preview-csv`, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.detail || "Server error");
  }

  return await response.json();
}

function calculateSelectedDuration(startVal, endVal) {
  if (!currentPreviewData) return 0;
  const rawX = currentPreviewData.x;
  const rawY = currentPreviewData.y;
  
  let totalTime = 0;
  for (let i = 0; i < rawX.length - 1; i++) {
    const x1 = rawX[i];
    const x2 = rawX[i+1];
    
    const u1 = Math.max(x1, startVal);
    const u2 = Math.min(x2, endVal);
    
    if (u2 > u1) {
      const dx = x2 - x1;
      if (dx > 0) {
        const v1 = rawY[i];
        const v2 = rawY[i+1];
        
        const v1_opt = v1 + (v2 - v1) * (u1 - x1) / dx;
        const v2_opt = v1 + (v2 - v1) * (u2 - x1) / dx;
        const v_mid = (v1_opt + v2_opt) / 2;
        
        if (v_mid > 0.05) {
          totalTime += (u2 - u1) / v_mid;
        }
      }
    }
  }
  return totalTime;
}

function updatePreviewChart() {
  if (!previewChartInstance || !currentPreviewData) return;

  const startVal = parseFloat(manualStartInput.value) || 0;
  const endVal = parseFloat(manualEndInput.value) || 0;

  const selectedDist = (endVal - startVal).toFixed(1);
  selectedDistDisplay.textContent = selectedDist;

  const duration = calculateSelectedDuration(startVal, endVal);
  if (selectedTimeDisplay) {
    selectedTimeDisplay.textContent = duration.toFixed(1);
  }

  const startVelDisplay = document.getElementById('start-vel-display');
  const endVelDisplay = document.getElementById('end-vel-display');
  if (startVelDisplay) {
    startVelDisplay.textContent = getVelocityAtDistance(startVal).toFixed(2);
  }
  if (endVelDisplay) {
    endVelDisplay.textContent = getVelocityAtDistance(endVal).toFixed(2);
  }

  const rawX = currentPreviewData.x;
  const totalDuration = calculateSelectedDuration(rawX[0], rawX[rawX.length - 1]);
  const totalTimeDisplay = document.getElementById('total-time-display');
  if (totalTimeDisplay) {
    totalTimeDisplay.textContent = totalDuration.toFixed(1);
  }

  const rawY = currentPreviewData.y;
  const selectedPoints = [];
  for (let i = 0; i < rawX.length; i++) {
    if (rawX[i] >= startVal && rawX[i] <= endVal) {
      selectedPoints.push({ x: rawX[i], y: rawY[i] });
    }
  }

  previewChartInstance.data.datasets[1].data = selectedPoints;

  const minY = Math.min(...rawY);
  const maxY = Math.max(...rawY);
  
  previewChartInstance.data.datasets[2].data = [
    { x: startVal, y: minY },
    { x: startVal, y: maxY }
  ];
  
  previewChartInstance.data.datasets[3].data = [
    { x: endVal, y: minY },
    { x: endVal, y: maxY }
  ];

  previewChartInstance.update();
}

// Global keyboard arrow key adjustments
window.addEventListener('keydown', (e) => {
  if (!previewModal || previewModal.style.display !== 'flex') return;
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  
  let targetInput = lastInteractedInput || manualStartInput;
  if (document.activeElement === manualStartInput) {
    targetInput = manualStartInput;
  } else if (document.activeElement === manualEndInput) {
    targetInput = manualEndInput;
  }
  
  if (!targetInput) return;
  const step = 0.5;
  e.preventDefault();
  
  if (e.key === 'ArrowLeft') {
    if (targetInput === manualStartInput) {
      const cur = parseFloat(manualStartInput.value) || 0;
      manualStartInput.value = Math.max(0, cur - step).toFixed(1);
      setActiveInput(manualStartInput);
      handleStartInput();
    } else if (targetInput === manualEndInput) {
      const cur = parseFloat(manualEndInput.value) || 0;
      const minStart = parseFloat(manualStartInput.value) || 0;
      manualEndInput.value = Math.max(minStart, cur - step).toFixed(1);
      setActiveInput(manualEndInput);
      handleEndInput();
    }
  } else if (e.key === 'ArrowRight') {
    if (targetInput === manualStartInput) {
      const cur = parseFloat(manualStartInput.value) || 0;
      const maxOdo = Math.max(...currentPreviewData.x);
      manualStartInput.value = Math.min(maxOdo, cur + step).toFixed(1);
      setActiveInput(manualStartInput);
      handleStartInput();
    } else if (targetInput === manualEndInput) {
      const cur = parseFloat(manualEndInput.value) || 0;
      const maxOdo = Math.max(...currentPreviewData.x);
      manualEndInput.value = Math.min(maxOdo, cur + step).toFixed(1);
      setActiveInput(manualEndInput);
      handleEndInput();
    }
  }
});

async function showPreviewForCurrentIndex() {
  if (currentPreviewIndex < 0 || currentPreviewIndex >= csvFilesToPreview.length) {
    previewModal.style.display = 'none';
    if (previewChartInstance) {
      previewChartInstance.destroy();
      previewChartInstance = null;
    }
    await runAnalysis();
    return;
  }

  const file = csvFilesToPreview[currentPreviewIndex];
  dropZone.style.display = 'none';
  loading.style.display = 'block';
  document.getElementById('loading-text').textContent = `Loading preview for ${file.name}...`;

  try {
    currentPreviewData = await fetchPreviewData(file);
    loading.style.display = 'none';
    
    manualStartInput.value = currentPreviewData.auto_start.toFixed(1);
    
    const maxOdo = Math.max(...currentPreviewData.x);
    if (lock200Checkbox && lock200Checkbox.checked) {
      manualEndInput.value = Math.min(maxOdo, currentPreviewData.auto_start + 200).toFixed(1);
    } else {
      manualEndInput.value = Math.min(maxOdo, currentPreviewData.auto_end).toFixed(1);
    }
    
    selectedDistDisplay.textContent = (parseFloat(manualEndInput.value) - parseFloat(manualStartInput.value)).toFixed(1);
    
    previewModal.style.display = 'flex';
    setActiveInput(manualStartInput);
    
    if (previewChartInstance) {
      previewChartInstance.destroy();
    }
    
    const rawX = currentPreviewData.x;
    const rawY = currentPreviewData.y;
    const rawPoints = rawX.map((val, idx) => ({ x: val, y: rawY[idx] }));
    
    const minY = Math.min(...rawY);
    const maxY = Math.max(...rawY);
    
    previewChartInstance = new Chart(previewChartCanvas, {
      type: 'scatter',
      data: {
        datasets: [
          {
            label: 'All GPS Data',
            data: rawPoints,
            backgroundColor: 'rgba(255, 255, 255, 0.25)',
            pointRadius: 3,
            showLine: true,
            borderColor: 'rgba(255, 255, 255, 0.1)',
            borderWidth: 1
          },
          {
            label: 'Selected 200m Segment',
            data: [], 
            backgroundColor: 'rgba(0, 229, 255, 0.75)',
            borderColor: 'var(--accent)',
            borderWidth: 2,
            pointRadius: 4,
            showLine: true
          },
          {
            label: 'Start Odometer',
            data: [
              { x: currentPreviewData.auto_start, y: minY },
              { x: currentPreviewData.auto_start, y: maxY }
            ],
            borderColor: '#69f0ae',
            borderWidth: 2,
            borderDash: [5, 5],
            showLine: true,
            pointRadius: 0
          },
          {
            label: 'End Odometer',
            data: [
              { x: currentPreviewData.auto_end, y: minY },
              { x: currentPreviewData.auto_end, y: maxY }
            ],
            borderColor: '#ff4336',
            borderWidth: 2,
            borderDash: [5, 5],
            showLine: true,
            pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#94a3b8' }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `Dist: ${ctx.parsed.x.toFixed(1)}m, Speed: ${ctx.parsed.y.toFixed(2)}m/s`
            }
          }
        },
        scales: {
          x: {
            type: 'linear',
            position: 'bottom',
            title: {
              display: true,
              text: 'Distance (m)',
              color: '#94a3b8'
            },
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#94a3b8' }
          },
          y: {
            title: {
              display: true,
              text: 'Velocity (m/s)',
              color: '#94a3b8'
            },
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#94a3b8' }
          }
        },
        onClick: (e, elements, chart) => {
          const canvasPosition = Chart.helpers.getRelativePosition(e, chart);
          const clickedX = chart.scales.x.getValueForPixel(canvasPosition.x);
          
          if (clickedX !== undefined && currentPreviewData) {
            const maxOdo = Math.max(...currentPreviewData.x);
            const cappedX = Math.max(0, Math.min(maxOdo, clickedX));
            
            if (document.activeElement === manualStartInput) {
              manualStartInput.value = cappedX.toFixed(1);
              setActiveInput(manualStartInput);
              handleStartInput();
            } else if (document.activeElement === manualEndInput) {
              manualEndInput.value = cappedX.toFixed(1);
              setActiveInput(manualEndInput);
              handleEndInput();
            } else {
              const curStart = parseFloat(manualStartInput.value) || 0;
              const curEnd = parseFloat(manualEndInput.value) || 0;
              const distToStart = Math.abs(cappedX - curStart);
              const distToEnd = Math.abs(cappedX - curEnd);
              
              if (distToStart < distToEnd) {
                manualStartInput.value = cappedX.toFixed(1);
                setActiveInput(manualStartInput);
                handleStartInput();
              } else {
                manualEndInput.value = cappedX.toFixed(1);
                setActiveInput(manualEndInput);
                handleEndInput();
              }
            }
          }
        }
      }
    });

    updatePreviewChart();
    
  } catch (error) {
    console.error(error);
    alert(`Error loading preview for ${file.name}: ${error.message}`);
    currentPreviewIndex++;
    showPreviewForCurrentIndex();
  }
}

async function runAnalysis() {
  dropZone.style.display = 'none';
  loading.style.display = 'block';
  document.getElementById('loading-text').textContent = "Analyzing race data...";
  resultsSection.style.display = 'none';
  wrapper.innerHTML = '';
  charts.forEach(c => c.destroy());
  charts = [];

  try {
    const promises = currentFiles.map(file => uploadAndAnalyze(file));
    currentData = await Promise.all(promises);
    
    loading.style.display = 'none';
    uploadSection.style.display = 'none';
    resultsSection.style.display = 'flex';
    
    renderAllCards();

  } catch (error) {
    console.error(error);
    alert("Error analyzing files: " + error.message);
    resetBtn.click();
  }
}

function generateCsvBlob(x, y) {
  let csv = "Odometer,Velocity\n";
  for (let i = 0; i < x.length; i++) {
    csv += `${x[i]},${y[i]}\n`;
  }
  return new Blob([csv], { type: 'text/csv' });
}

async function updateAnalysisForIndex(index, manualBp1) {
  loading.style.display = 'block';
  resultsSection.style.display = 'none';
  wrapper.innerHTML = '';
  charts.forEach(c => c.destroy());
  charts = [];

  try {
    currentFiles[index].manualBp1 = manualBp1;
    const newData = await uploadAndAnalyze(currentFiles[index]);
    
    currentData[index] = newData;
    
    loading.style.display = 'none';
    resultsSection.style.display = 'flex';
    renderAllCards();
  } catch (error) {
    console.error(error);
    alert("Error analyzing file: " + error.message);
    resetBtn.click();
  }
}

async function uploadAndAnalyze(file) {
  const formData = new FormData();
  formData.append("file", file);

  if (file.manualBp1) {
    formData.append("manual_bp1", file.manualBp1);
  }
  if (file.manualStart !== undefined && file.manualStart !== null) {
    formData.append("manual_start", file.manualStart);
  }
  if (file.manualEnd !== undefined && file.manualEnd !== null) {
    formData.append("manual_end", file.manualEnd);
  }

  const response = await fetch(API_URL, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.detail || "Server error");
  }

  return await response.json();
}

function calculateWeightedAverageCadence(phaseStats, enteredCadences) {
  if (!phaseStats || !enteredCadences) return null;
  let totalDuration = 0, weightedSum = 0, hasInputs = false;
  phaseStats.forEach((stat, idx) => {
    const time = Number(stat["Time (s)"]);
    const cadence = Number(enteredCadences[`phase_${idx}`]);
    if (!isNaN(cadence) && cadence > 0) {
      weightedSum += cadence * time;
      totalDuration += time;
      hasInputs = true;
    }
  });
  return (hasInputs && totalDuration > 0) ? (weightedSum / totalDuration) : null;
}

function getBestIndices(values, type) {
  const validValues = values.filter(v => v !== null && v !== undefined && !isNaN(v));
  if (validValues.length < 2) return [];
  const minVal = Math.min(...validValues), maxVal = Math.max(...validValues);
  if (minVal === maxVal) return [];
  const bestValue = type === 'max' ? maxVal : minVal;
  return values.map(v => v !== null && v !== undefined && !isNaN(v) && v === bestValue);
}

// Comparative Matrix Generator
function buildComparisonTable(containerElement, testsData, phaseKey) {
  if (!containerElement) return;
  if (!testsData || testsData.length < 2) {
    containerElement.style.display = 'none';
    containerElement.innerHTML = '';
    return;
  }

  containerElement.style.display = 'block';
  const testColors = ['#00e5ff', '#ffc107', '#69f0ae'];

  let html = `
    <div class="comparison-table-card">
      <h3>📊 Matriz de Comparação Temporal / Pacing Comparative Matrix</h3>
      <div class="table-responsive">
        <table class="comparison-matrix">
          <thead>
            <tr>
              <th>Parâmetro / Metric</th>
  `;

  testsData.forEach((data, idx) => {
    const color = testColors[idx % testColors.length];
    html += `
              <th>
                <span class="matrix-color-box" style="background: ${color};"></span>
                ${data.filename}
              </th>
    `;
  });

  html += `
            </tr>
          </thead>
          <tbody>
  `;

  // --- SECTION: PERFORMANCE OVERVIEW ---
  html += `
    <tr class="matrix-section-row">
      <td colspan="${testsData.length + 1}">⚡ VISÃO GERAL DE DESEMPENHO / PERFORMANCE OVERVIEW</td>
    </tr>
  `;

  const r2Values = testsData.map(data => {
    const model = data.models[phaseKey];
    return model ? model.r_squared : null;
  });
  const r2Best = getBestIndices(r2Values, 'max');

  html += `<tr><td>Ajuste do Modelo / Model Fit (R²)</td>`;
  testsData.forEach((data, idx) => {
    const val = r2Values[idx];
    const isBest = r2Best[idx];
    const cellClass = isBest ? 'best-metric-highlight' : 'r2-highlight';
    html += `<td class="${cellClass}">${val !== null ? val.toFixed(4) : '-'}</td>`;
  });
  html += `</tr>`;

  html += `<tr><td>Distância Total / Total Distance (m)</td>`;
  testsData.forEach(data => {
    const totalStats = data.total_statistics;
    html += `<td class="metric-highlight">${totalStats ? Number(totalStats["Dist (m)"]).toFixed(0) + ' m' : '-'}</td>`;
  });
  html += `</tr>`;

  const timeValues = testsData.map(data => {
    const totalStats = data.total_statistics;
    return totalStats ? Number(totalStats["Time (s)"]) : null;
  });
  const timeBest = getBestIndices(timeValues, 'min');

  html += `<tr><td>Tempo Total / Total Time (s)</td>`;
  testsData.forEach((data, idx) => {
    const val = timeValues[idx];
    const isBest = timeBest[idx];
    const cellClass = isBest ? 'best-metric-highlight' : 'metric-highlight';
    const styleAttr = isBest ? '' : 'style="color: var(--accent);"';
    html += `<td class="${cellClass}" ${styleAttr}>${val !== null ? val.toFixed(1) + ' s' : '-'}</td>`;
  });
  html += `</tr>`;

  const meanVelValues = testsData.map(data => {
    const totalStats = data.total_statistics;
    return totalStats ? Number(totalStats["Mean Vel"]) : null;
  });
  const meanVelBest = getBestIndices(meanVelValues, 'max');

  html += `<tr><td>Velocidade Média / Mean Velocity (m/s)</td>`;
  testsData.forEach((data, idx) => {
    const val = meanVelValues[idx];
    const isBest = meanVelBest[idx];
    const cellClass = isBest ? 'best-metric-highlight' : 'metric-highlight';
    html += `<td class="${cellClass}">${val !== null ? val.toFixed(2) + ' m/s' : '-'}</td>`;
  });
  html += `</tr>`;

  const maxVelValues = testsData.map(data => {
    const totalStats = data.total_statistics;
    return totalStats ? Number(totalStats["Max Vel"]) : null;
  });
  const maxVelBest = getBestIndices(maxVelValues, 'max');

  html += `<tr><td>Velocidade Máxima / Max Velocity (m/s)</td>`;
  testsData.forEach((data, idx) => {
    const val = maxVelValues[idx];
    const isBest = maxVelBest[idx];
    const cellClass = isBest ? 'best-metric-highlight' : 'metric-highlight';
    html += `<td class="${cellClass}">${val !== null ? val.toFixed(2) + ' m/s' : '-'}</td>`;
  });
  html += `</tr>`;

  html += `<tr><td>Inclinação Geral / General Slope (%)</td>`;
  testsData.forEach(data => {
    const totalStats = data.total_statistics;
    html += `<td class="metric-highlight">${totalStats ? Number(totalStats["Incl (%)"]).toFixed(2) + '%' : '-'}</td>`;
  });
  html += `</tr>`;

  // --- SECTION: PACING TRANSITIONS ---
  html += `
    <tr class="matrix-section-row">
      <td colspan="${testsData.length + 1}">📍 PONTOS DE TRANSIÇÃO / PACING BREAKPOINTS</td>
    </tr>
  `;

  let bpCount = 0;
  if (phaseKey === '2_phase') bpCount = 1;
  else if (phaseKey === '3_phase') bpCount = 2;
  else if (phaseKey === '4_phase') bpCount = 3;

  for (let bpIdx = 0; bpIdx < bpCount; bpIdx++) {
    const label = `BP${bpIdx + 1}`;
    
    html += `<tr><td>Distância ${label} / ${label} Distance (m)</td>`;
    testsData.forEach(data => {
      const model = data.models[phaseKey];
      const bp = model && model.breakpoints ? model.breakpoints[bpIdx] : null;
      html += `<td class="metric-highlight">${bp ? Number(bp.distance).toFixed(0) + ' m' : '-'}</td>`;
    });
    html += `</tr>`;

    html += `<tr><td>Tempo ${label} / ${label} Time (s)</td>`;
    testsData.forEach(data => {
      const model = data.models[phaseKey];
      const bp = model && model.breakpoints ? model.breakpoints[bpIdx] : null;
      html += `<td class="metric-highlight">${bp ? Number(bp.time).toFixed(1) + ' s' : '-'}</td>`;
    });
    html += `</tr>`;

    const bpVelValues = testsData.map(data => {
      const model = data.models[phaseKey];
      const bp = model && model.breakpoints ? model.breakpoints[bpIdx] : null;
      return bp ? Number(bp.velocity) : null;
    });
    const bpVelBest = getBestIndices(bpVelValues, 'max');

    html += `<tr><td>Velocidade ${label} / ${label} Velocity (m/s)</td>`;
    testsData.forEach((data, idx) => {
      const val = bpVelValues[idx];
      const isBest = bpVelBest[idx];
      const cellClass = isBest ? 'best-metric-highlight' : 'metric-highlight';
      const styleAttr = isBest ? '' : 'style="color: var(--yellow-accent);"';
      html += `<td class="${cellClass}" ${styleAttr}>${val !== null ? val.toFixed(2) + ' m/s' : '-'}</td>`;
    });
    html += `</tr>`;
  }

  // --- SECTION: PHASE PACING SPEEDS ---
  html += `
    <tr class="matrix-section-row">
      <td colspan="${testsData.length + 1}">📈 VELOCIDADES POR FASE / PHASE PACING ACCENTS</td>
    </tr>
  `;

  const sampleModel = testsData[0].models[phaseKey];
  const sampleStats = sampleModel ? sampleModel.statistics : [];

  sampleStats.forEach((sampleStat, phaseIdx) => {
    const phaseName = sampleStat.Phase;

    const phaseVelValues = testsData.map(data => {
      const model = data.models[phaseKey];
      const stat = model && model.statistics ? model.statistics[phaseIdx] : null;
      return stat ? Number(stat["Mean Vel"]) : null;
    });
    const phaseVelBest = getBestIndices(phaseVelValues, 'max');

    html += `<tr><td>${phaseName}: Velocidade Média / Mean Velocity</td>`;
    testsData.forEach((data, idx) => {
      const val = phaseVelValues[idx];
      const isBest = phaseVelBest[idx];
      const cellClass = isBest ? 'best-metric-highlight' : 'metric-highlight';
      html += `<td class="${cellClass}">${val !== null ? val.toFixed(2) + ' m/s' : '-'}</td>`;
    });
    html += `</tr>`;

    html += `<tr><td>${phaseName}: Inclinação de Velocidade / Slope (%)</td>`;
    testsData.forEach(data => {
      const model = data.models[phaseKey];
      const stat = model && model.statistics ? model.statistics[phaseIdx] : null;
      html += `<td class="metric-highlight">${stat ? Number(stat["Incl (%)"]).toFixed(2) + '%' : '-'}</td>`;
    });
    html += `</tr>`;
  });

  // --- SECTION: CADENCE RATE (IF APPLICABLE) ---
  const hasAnyCadence = testsData.some(data => 
    data.manual_cadences && 
    data.manual_cadences[phaseKey] && 
    Object.keys(data.manual_cadences[phaseKey]).some(k => k.startsWith('phase_') && Number(data.manual_cadences[phaseKey][k]) > 0)
  );

  if (hasAnyCadence) {
    html += `
      <tr class="matrix-section-row">
        <td colspan="${testsData.length + 1}">⏱️ CADÊNCIA (stroke/min) / STROKE RATE</td>
      </tr>
    `;

    sampleStats.forEach((sampleStat, phaseIdx) => {
      const phaseName = sampleStat.Phase;
      html += `<tr><td>${phaseName}: Cadência / Stroke Rate</td>`;
      testsData.forEach(data => {
        const val = (data.manual_cadences && data.manual_cadences[phaseKey]) ? data.manual_cadences[phaseKey][`phase_${phaseIdx}`] : null;
        const displayVal = (val && Number(val) > 0) ? Number(val).toFixed(0) + ' spm' : '-';
        html += `<td class="metric-highlight">${displayVal}</td>`;
      });
      html += `</tr>`;
    });

    html += `<tr><td>Cadência Média / Average Cadence</td>`;
    const avgCadenceValues = testsData.map(data => {
      if (!data.manual_cadences || !data.manual_cadences[phaseKey]) return null;
      const model = data.models[phaseKey];
      if (!model) return null;
      return calculateWeightedAverageCadence(model.statistics, data.manual_cadences[phaseKey]);
    });
    const bestAvgCadenceIndices = getBestIndices(avgCadenceValues, 'max');

    testsData.forEach((data, idx) => {
      const avg = avgCadenceValues[idx];
      const isBest = bestAvgCadenceIndices[idx];
      const cellClass = isBest ? 'best-metric-highlight' : 'metric-highlight';
      const styleAttr = isBest ? '' : 'style="color: #69f0ae; font-weight: 600;"';
      const displayAvg = (avg !== null && !isNaN(avg)) ? avg.toFixed(1) + ' spm' : '-';
      html += `<td class="${cellClass}" ${styleAttr}>${displayAvg}</td>`;
    });
    html += `</tr>`;
  }

  html += `
          </tbody>
        </table>
      </div>
    </div>
  `;

  containerElement.innerHTML = html;
}

function renderAllCards() {
  wrapper.innerHTML = '';
  charts.forEach(c => c.destroy());
  charts = [];

  const quickCompContainer = document.getElementById('quick-comparison-table-container');
  buildComparisonTable(quickCompContainer, currentData, currentPhase);

  currentData.forEach((data, index) => {
    const card = template.content.cloneNode(true);
    const athleteCard = card.querySelector('.athlete-card');
    const phaseColors = ['#2196f3', '#ffc107', '#f44336', '#9c27b0', '#69f0ae'];

    card.querySelector('.athlete-name').textContent = data.filename;

    const manualBp1Input = card.querySelector('.card-manual-bp1');
    const bpSlider = card.querySelector('.card-manual-bp1-slider');
    
    const maxX = (data.raw_data && data.raw_data.x && data.raw_data.x.length > 0) ? data.raw_data.x[data.raw_data.x.length - 1] : 200;
    if (bpSlider) {
      bpSlider.min = 5;
      bpSlider.max = Math.floor(maxX);
      bpSlider.step = 0.5;
      bpSlider.value = currentFiles[index].manualBp1 || data.raw_data.bp1_x;
    }
    
    if (currentFiles[index].manualBp1) {
      manualBp1Input.value = currentFiles[index].manualBp1;
    }
    
    if (bpSlider && manualBp1Input) {
      bpSlider.addEventListener('input', () => {
        manualBp1Input.value = bpSlider.value;
      });
      bpSlider.addEventListener('change', () => {
        updateAnalysisForIndex(index, bpSlider.value);
      });
      manualBp1Input.addEventListener('input', () => {
        const val = parseFloat(manualBp1Input.value);
        if (!isNaN(val)) {
          bpSlider.value = val;
        }
      });
    }
    
    card.querySelector('.card-apply-bp1').addEventListener('click', () => {
      const val = manualBp1Input.value;
      if (val) {
        updateAnalysisForIndex(index, val);
      }
    });

    card.querySelector('.card-reset-bp1').addEventListener('click', () => {
      manualBp1Input.value = '';
      if (bpSlider) {
        bpSlider.value = data.raw_data.bp1_x;
      }
      updateAnalysisForIndex(index, null);
    });
    
    const modelData = data.models[currentPhase];
    card.querySelector('.r2-value').textContent = modelData.r_squared.toFixed(4);

    const bpTbody = card.querySelector('.breakpoints-table tbody');
    modelData.breakpoints.forEach(bp => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${bp.label}</td>
        <td>${Number(bp.distance).toFixed(0)}</td>
        <td>${Number(bp.time).toFixed(1)}</td>
        <td>${Number(bp.velocity).toFixed(2)}</td>
      `;
      bpTbody.appendChild(tr);
    });

    const statTbody = card.querySelector('.statistics-table tbody');
    const totalStats = data.total_statistics;
    const summaryContainer = card.querySelector('.total-results-summary');
    if (summaryContainer && totalStats) {
      summaryContainer.innerHTML = `
        <div class="summary-item"><span class="label">Total Dist:</span> <span class="value">${Number(totalStats["Dist (m)"]).toFixed(0)}m</span></div>
        <div class="summary-item"><span class="label">Total Time:</span> <span class="value">${Number(totalStats["Time (s)"]).toFixed(1)}s</span></div>
        <div class="summary-item"><span class="label">Mean Vel:</span> <span class="value">${Number(totalStats["Mean Vel"]).toFixed(2)} m/s</span></div>
        <div class="summary-item"><span class="label">Max Vel:</span> <span class="value">${Number(totalStats["Max Vel"]).toFixed(2)} m/s</span></div>
        <div class="summary-item"><span class="label">Incl (%):</span> <span class="value">${Number(totalStats["Incl (%)"]).toFixed(2)}%</span></div>
      `;
    }

    const allStats = [...modelData.statistics, totalStats];
    if (!data.manual_cadences) {
      data.manual_cadences = {};
    }
    if (!data.manual_cadences[currentPhase]) {
      data.manual_cadences[currentPhase] = {};
    }
    const activeCadences = data.manual_cadences[currentPhase];
    
    allStats.forEach((stat, i) => {
      const isTotal = stat.Phase === 'Total';
      const tr = document.createElement('tr');
      if (isTotal) {
        tr.style.fontWeight = 'bold';
        tr.style.borderTop = '2px solid var(--panel-border)';
        tr.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
      }
      
      const colorBox = isTotal ? 
        `<span style="display:inline-block;width:10px;height:10px;background:#fff;margin-right:8px;border-radius:2px;opacity:0.5;"></span>` :
        `<span style="display:inline-block;width:10px;height:10px;background:${phaseColors[i%phaseColors.length]};margin-right:8px;border-radius:2px;"></span>`;
      
      let cadenceCellVal = '-';
      if (isTotal) {
        const avg = calculateWeightedAverageCadence(modelData.statistics, activeCadences);
        if (avg !== null && !isNaN(avg)) {
          cadenceCellVal = avg.toFixed(1);
        }
      } else {
        const val = activeCadences[`phase_${i}`];
        if (val !== undefined && val !== null && Number(val) > 0) {
          cadenceCellVal = Number(val).toFixed(0);
        }
      }

      tr.innerHTML = `
        <td>${colorBox}${stat.Phase}</td>
        <td>${Number(stat["Dist (m)"]).toFixed(0)}</td>
        <td>${Number(stat["Time (s)"]).toFixed(1)}</td>
        <td>${Number(stat["Mean Vel"]).toFixed(2)}</td>
        <td>${Number(stat["Min Vel"]).toFixed(2)}</td>
        <td>${Number(stat["Max Vel"]).toFixed(2)}</td>
        <td>${Number(stat["Range (Abs)"]).toFixed(2)}</td>
        <td>${Number(stat["Range (%)"]).toFixed(1)}</td>
        <td>${Number(stat["Var Coef (%)"]).toFixed(1)}</td>
        <td>${Number(stat["Incl (Abs)"]).toFixed(2)}</td>
        <td>${Number(stat["Incl (%)"]).toFixed(2)}</td>
        <td class="table-cadence-cell" data-phase-idx="${isTotal ? 'total' : i}" style="color: #69f0ae; font-weight: bold;">${cadenceCellVal}</td>
      `;
      statTbody.appendChild(tr);
    });

    const tabBtns = card.querySelectorAll('.card-tab-btn');
    const tabContents = card.querySelectorAll('.card-tab-content');
    
    tabBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const targetTab = btn.dataset.tab;
        
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        tabContents.forEach(content => {
          if (content.dataset.tab === targetTab) {
            content.style.display = 'block';
          } else {
            content.style.display = 'none';
          }
        });
      });
    });

    const cadenceSection = card.querySelector('.card-cadence-section');
    const cadenceGrid = card.querySelector('.cadence-inputs-grid');
    const avgCadenceBadge = card.querySelector('.card-avg-cadence');

    if (cadenceSection && cadenceGrid && avgCadenceBadge) {
      cadenceGrid.innerHTML = '';
      modelData.statistics.forEach((stat, phaseIdx) => {
        const inputDiv = document.createElement('div');
        inputDiv.style.display = 'flex';
        inputDiv.style.flexDirection = 'column';
        inputDiv.style.gap = '0.3rem';
        
        const label = document.createElement('label');
        label.style.fontSize = '0.78rem';
        label.style.color = 'var(--text-secondary)';
        label.style.fontWeight = '500';
        label.textContent = stat.Phase;

        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'cadence-input-field';
        input.placeholder = '-';
        input.min = '0';
        input.max = '250';
        
        const existingVal = activeCadences[`phase_${phaseIdx}`];
        if (existingVal !== undefined && existingVal !== null && Number(existingVal) > 0) {
          input.value = existingVal;
        }

        input.addEventListener('input', () => {
          const val = Number(input.value);
          if (val > 0) {
            activeCadences[`phase_${phaseIdx}`] = val;
          } else {
            delete activeCadences[`phase_${phaseIdx}`];
          }
          
          const avg = calculateWeightedAverageCadence(modelData.statistics, activeCadences);
          if (avg !== null && !isNaN(avg)) {
            avgCadenceBadge.textContent = `${avg.toFixed(1)} stroke/min`;
          } else {
            avgCadenceBadge.textContent = `- stroke/min`;
          }

          const tableCell = athleteCard.querySelector(`.table-cadence-cell[data-phase-idx="${phaseIdx}"]`);
          if (tableCell) {
            tableCell.textContent = val > 0 ? val.toFixed(0) : '-';
          }
          const totalTableCell = athleteCard.querySelector(`.table-cadence-cell[data-phase-idx="total"]`);
          if (totalTableCell) {
            totalTableCell.textContent = (avg !== null && !isNaN(avg)) ? avg.toFixed(1) : '-';
          }
        });

        input.addEventListener('change', () => {
          const quickCompContainer = document.getElementById('quick-comparison-table-container');
          buildComparisonTable(quickCompContainer, currentData, currentPhase);
        });

        inputDiv.appendChild(label);
        inputDiv.appendChild(input);
        cadenceGrid.appendChild(inputDiv);
      });

      const initialAvg = calculateWeightedAverageCadence(modelData.statistics, activeCadences);
      if (initialAvg !== null && !isNaN(initialAvg)) {
        avgCadenceBadge.textContent = `${initialAvg.toFixed(1)} stroke/min`;
      } else {
        avgCadenceBadge.textContent = `- stroke/min`;
      }
    }

    wrapper.appendChild(card);

    const canvas = document.querySelectorAll('.pacing-chart')[index];
    renderChart(canvas, data, currentPhase, phaseColors);
  });
}

function renderChart(canvas, data, phase, colors) {
  const raw = data.raw_data;
  const model = data.models[phase];

  const rawPoints = raw.x.map((x, i) => ({ x: x, y: raw.y[i] }));
  
  const fitDatasets = [];
  const bps = [0, ...model.breakpoints.map(bp => bp.x_index), raw.x.length - 1];
  
  for (let i = 0; i < bps.length - 1; i++) {
    const start = bps[i];
    const end = bps[i+1];
    const lineData = [];
    for(let j = start; j <= end; j++) {
      lineData.push({ x: raw.x[j], y: model.y_fit[j] });
    }
    fitDatasets.push({
      label: i === 0 ? 'Acceleration Phase' : `Phase ${i+1}`,
      data: lineData,
      borderColor: colors[i % colors.length],
      borderWidth: 3,
      fill: false,
      pointRadius: 0,
      pointHitRadius: 10,
      showLine: true,
      tension: 0
    });
  }

  const bpDots = model.breakpoints.map(bp => ({
    x: bp.distance,
    y: bp.velocity
  }));

  const drawBPLabels = {
    id: 'drawBPLabels',
    afterDatasetsDraw(chart, args, options) {
      const { ctx } = chart;
      chart.data.datasets.forEach((dataset, i) => {
        if (dataset.label === 'Breakpoints') {
          const meta = chart.getDatasetMeta(i);
          meta.data.forEach((element, index) => {
            const bpDist = dataset.data[index].x;
            ctx.save();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 12px Inter';
            ctx.textAlign = 'center';
            ctx.fillText(Number(bpDist).toFixed(0) + 'm', element.x, element.y - 15);
            ctx.restore();
          });
        }
      });
    }
  };

  const chart = new Chart(canvas, {
    type: 'scatter',
    plugins: [drawBPLabels],
    data: {
      datasets: [
        {
          label: 'Raw Velocity',
          data: rawPoints,
          backgroundColor: 'rgba(255,255,255,0.2)',
          pointRadius: 2,
        },
        ...fitDatasets,
        {
          label: 'Breakpoints',
          data: bpDots,
          backgroundColor: '#fff',
          borderColor: '#000',
          borderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 8,
          showLine: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#94a3b8' }
        },
        tooltip: {
          mode: 'index',
          intersect: false,
        }
      },
      scales: {
        x: {
          type: 'linear',
          position: 'bottom',
          min: 0,
          max: 200,
          title: {
            display: true,
            text: 'Distance (m)',
            color: '#94a3b8'
          },
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { 
            color: '#94a3b8',
            stepSize: 20
          }
        },
        y: {
          title: {
            display: true,
            text: 'Velocity (m/s)',
            color: '#94a3b8'
          },
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#94a3b8' }
        }
      }
    }
  });

  charts.push(chart);
}

function generateChartBase64(data, phase) {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 400;
  
  const darkBgPlugin = {
    id: 'customCanvasBackgroundColor',
    beforeDraw: (chart, args, options) => {
      const {ctx} = chart;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = options.color || '#141a28';
      ctx.fillRect(0, 0, chart.width, chart.height);
      ctx.restore();
    }
  };

  const colors = ['#2196f3', '#ffc107', '#f44336', '#9c27b0', '#69f0ae'];
  const raw = data.raw_data;
  const model = data.models[phase];

  const rawPoints = raw.x.map((x, i) => ({ x: x, y: raw.y[i] }));
  const fitDatasets = [];
  const bps = [0, ...model.breakpoints.map(bp => bp.x_index), raw.x.length - 1];
  
  for (let i = 0; i < bps.length - 1; i++) {
    const start = bps[i];
    const end = bps[i+1];
    const lineData = [];
    for(let j = start; j <= end; j++) {
      lineData.push({ x: raw.x[j], y: model.y_fit[j] });
    }
    fitDatasets.push({
      label: i === 0 ? 'Acceleration Phase' : `Phase ${i+1}`,
      data: lineData,
      borderColor: colors[i % colors.length],
      borderWidth: 3,
      fill: false,
      pointRadius: 0,
      pointHitRadius: 10,
      showLine: true,
      tension: 0
    });
  }

  const bpDots = model.breakpoints.map(bp => ({ x: bp.distance, y: bp.velocity }));

  const chart = new Chart(canvas, {
    type: 'scatter',
    plugins: [darkBgPlugin],
    data: {
      datasets: [
        {
          label: 'Raw Velocity',
          data: rawPoints,
          backgroundColor: 'rgba(255, 255, 255, 0.25)',
          pointRadius: 2,
        },
        ...fitDatasets,
        {
          label: 'Breakpoints',
          data: bpDots,
          backgroundColor: '#fff',
          borderColor: '#00e5ff',
          borderWidth: 2,
          pointRadius: 6,
          showLine: false
        }
      ]
    },
    options: {
      animation: false,
      responsive: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#94a3b8', font: { family: 'Segoe UI, Inter' } } },
        customCanvasBackgroundColor: { color: '#141a28' }
      },
      scales: {
        x: { 
          type: 'linear', 
          position: 'bottom', 
          min: 0,
          max: 200,
          title: { display: true, text: 'Distance (m)', color: '#94a3b8', font: { family: 'Segoe UI, Inter' } }, 
          grid: { color: 'rgba(255, 255, 255, 0.05)' }, 
          ticks: { color: '#94a3b8', font: { family: 'Segoe UI, Inter' }, stepSize: 20 } 
        },
        y: { 
          title: { display: true, text: 'Velocity (m/s)', color: '#94a3b8', font: { family: 'Segoe UI, Inter' } }, 
          grid: { color: 'rgba(255, 255, 255, 0.05)' }, 
          ticks: { color: '#94a3b8', font: { family: 'Segoe UI, Inter' } } 
        }
      }
    }
  });

  const b64 = chart.toBase64Image();
  chart.destroy();
  return b64;
}

// Export functionality
const exportBtn = document.getElementById('export-btn');
if (exportBtn) {
  exportBtn.addEventListener('click', async () => {
    if (!currentData || currentData.length === 0) return;
    if (typeof ExcelJS === 'undefined') {
      alert("Excel export library is still loading. Please try again in a moment.");
      return;
    }
    
    const oldText = exportBtn.innerHTML;
    exportBtn.innerHTML = "⏳ Exporting...";
    exportBtn.disabled = true;

    try {
      const wb = new ExcelJS.Workbook();

      const BG_COLOR = 'FF0B0F19';      // Deep blue/black
      const PANEL_BG = 'FF141A28';      // Panel background
      const HEADER_BG = 'FF1E293B';     // Slate header background
      const TEXT_PRIMARY = 'FFF0F4F8';  // Light grey
      const TEXT_MUTED = 'FF94A3B8';    // Secondary grey
      const ACCENT = 'FF00E5FF';        // Cyan
      const YELLOW_ACCENT = 'FFFFC107'; // Yellow gold
      const BORDER_COLOR = 'FF2A3547';  // Card border

      const subtleBorder = {
        top: { style: 'thin', color: { argb: BORDER_COLOR } },
        left: { style: 'thin', color: { argb: BORDER_COLOR } },
        bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
        right: { style: 'thin', color: { argb: BORDER_COLOR } }
      };

      function styleCell(cell, {
        bg = BG_COLOR,
        fontColor = TEXT_PRIMARY,
        fontSize = 10,
        bold = false,
        italic = false,
        alignH = 'center',
        alignV = 'middle',
        numFormat = null,
        border = null
      } = {}) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: bg }
        };
        cell.font = {
          name: 'Segoe UI',
          size: fontSize,
          bold: bold,
          italic: italic,
          color: { argb: fontColor }
        };
        cell.alignment = {
          horizontal: alignH,
          vertical: alignV,
          wrapText: true
        };
        if (numFormat) {
          cell.numFormat = numFormat;
        }
        if (border) {
          cell.border = border;
        } else {
          cell.border = { top: null, left: null, bottom: null, right: null };
        }
      }

      function styleMergedRange(ws, r1, c1, r2, c2, styleOptions) {
        for (let r = r1; r <= r2; r++) {
          for (let c = c1; c <= c2; c++) {
            const cell = ws.getCell(r, c);
            styleCell(cell, styleOptions);
          }
        }
        ws.mergeCells(r1, c1, r2, c2);
      }

      const phasesToExport = ['2_phase', '3_phase', '4_phase'];
      const phaseNames = {
        '2_phase': '2 Fases (2 Phases)',
        '3_phase': '3 Fases (3 Phases)',
        '4_phase': '4 Fases (4 Phases)'
      };

      phasesToExport.forEach(phaseKey => {
        const ws = wb.addWorksheet(phaseNames[phaseKey]);
        ws.views = [{ showGridLines: false }];

        ws.columns = [
          { width: 22 }, // A
          { width: 14 }, // B
          { width: 12 }, // C
          { width: 16 }, // D
          { width: 14 }, // E
          { width: 14 }, // F
          { width: 16 }, // G
          { width: 14 }, // H
          { width: 16 }, // I
          { width: 16 }, // J
          { width: 14 }, // K
          { width: 4 },  // L
          { width: 12 }, // M
          { width: 12 }, // N
          { width: 12 }, // O
          { width: 12 }, // P
          { width: 12 }, // Q
          { width: 12 }, // R
          { width: 12 }, // S
          { width: 12 }, // T
          { width: 12 }, // U
          { width: 12 }  // V
        ];

        for (let r = 1; r <= 80; r++) {
          for (let c = 1; c <= 22; c++) {
            const cell = ws.getCell(r, c);
            styleCell(cell, { bg: BG_COLOR });
          }
        }

        currentData.forEach((data, index) => {
          const model = data.models[phaseKey];
          if (!model) return;

          const startRow = index * 26 + 1;

          styleMergedRange(ws, startRow, 1, startRow, 11, {
            bg: PANEL_BG,
            fontColor: ACCENT,
            fontSize: 12,
            bold: true,
            alignH: 'left',
            alignV: 'middle',
            border: subtleBorder
          });
          ws.getCell(startRow, 1).value = `  🏃 ANALISE / PACING: ${data.filename.toUpperCase()}`;
          ws.getRow(startRow).height = 28;

          styleMergedRange(ws, startRow + 1, 1, startRow + 1, 11, {
            bg: PANEL_BG,
            fontColor: TEXT_MUTED,
            fontSize: 10,
            bold: false,
            alignH: 'left',
            alignV: 'middle',
            border: {
              left: { style: 'thin', color: { argb: BORDER_COLOR } },
              right: { style: 'thin', color: { argb: BORDER_COLOR } },
              bottom: { style: 'thin', color: { argb: BORDER_COLOR } }
            }
          });
          ws.getCell(startRow + 1, 1).value = `   🎯 Ajuste do Modelo / Model Fit: R² = ${model.r_squared.toFixed(4)}`;
          ws.getRow(startRow + 1).height = 22;

          const bpTitleRow = startRow + 3;
          styleMergedRange(ws, bpTitleRow, 1, bpTitleRow, 4, {
            bg: HEADER_BG,
            fontColor: YELLOW_ACCENT,
            fontSize: 10,
            bold: true,
            alignH: 'left',
            alignV: 'middle',
            border: subtleBorder
          });
          ws.getCell(bpTitleRow, 1).value = ` 📍 PONTOS DE TRANSIÇÃO / PHASE BREAKPOINTS`;
          ws.getRow(bpTitleRow).height = 22;

          const bpHeaderRow = startRow + 4;
          const bpHeaders = [
            "Ponto / Breakpoint", 
            "Distância / Dist (m)", 
            "Tempo / Time (s)", 
            "Velocidade / Vel (m/s)"
          ];
          bpHeaders.forEach((h, colIdx) => {
            const cell = ws.getCell(bpHeaderRow, colIdx + 1);
            styleCell(cell, {
              bg: HEADER_BG,
              fontColor: TEXT_PRIMARY,
              fontSize: 9.5,
              bold: true,
              alignH: colIdx === 0 ? 'left' : 'center',
              alignV: 'middle',
              border: subtleBorder
            });
            cell.value = h;
          });
          ws.getRow(bpHeaderRow).height = 20;

          let currentBPRow = startRow + 5;
          model.breakpoints.forEach(bp => {
            const c1 = ws.getCell(currentBPRow, 1);
            styleCell(c1, { bg: PANEL_BG, fontColor: TEXT_PRIMARY, alignH: 'left', border: subtleBorder });
            c1.value = bp.label;

            const c2 = ws.getCell(currentBPRow, 2);
            styleCell(c2, { bg: PANEL_BG, fontColor: TEXT_PRIMARY, numFormat: '#,##0', border: subtleBorder });
            c2.value = Number(bp.distance);

            const c3 = ws.getCell(currentBPRow, 3);
            styleCell(c3, { bg: PANEL_BG, fontColor: TEXT_PRIMARY, numFormat: '0.0', border: subtleBorder });
            c3.value = Number(bp.time);

            const c4 = ws.getCell(currentBPRow, 4);
            styleCell(c4, { bg: PANEL_BG, fontColor: TEXT_PRIMARY, numFormat: '0.00', border: subtleBorder });
            c4.value = Number(bp.velocity);

            ws.getRow(currentBPRow).height = 18;
            currentBPRow++;
          });

          const statsTitleRow = startRow + 9;
          styleMergedRange(ws, statsTitleRow, 1, statsTitleRow, 11, {
            bg: HEADER_BG,
            fontColor: ACCENT,
            fontSize: 10,
            bold: true,
            alignH: 'left',
            alignV: 'middle',
            border: subtleBorder
          });
          ws.getCell(statsTitleRow, 1).value = ` 📊 ESTATÍSTICAS DOS SEGMENTOS / SEGMENT STATISTICS`;
          ws.getRow(statsTitleRow).height = 22;

          const statsHeaderRow = startRow + 10;
          const statsHeaders = [
            "Fase / Phase", 
            "Dist (m)", 
            "Tempo / Time (s)", 
            "Média Vel (m/s)", 
            "Mín Vel (m/s)", 
            "Máx Vel (m/s)", 
            "Var Abs (m/s)", 
            "Variação %", 
            "Var Coef %", 
            "Incl Abs", 
            "Inclinação %"
          ];
          statsHeaders.forEach((h, colIdx) => {
            const cell = ws.getCell(statsHeaderRow, colIdx + 1);
            styleCell(cell, {
              bg: HEADER_BG,
              fontColor: TEXT_PRIMARY,
              fontSize: 9.5,
              bold: true,
              alignH: colIdx === 0 ? 'left' : 'center',
              alignV: 'middle',
              border: subtleBorder
            });
            cell.value = h;
          });
          ws.getRow(statsHeaderRow).height = 20;

          let currentStatsRow = startRow + 11;
          const allStatsExport = [...model.statistics, data.total_statistics];
          allStatsExport.forEach(stat => {
            const isTotal = stat.Phase === 'Total';
            const rowBg = PANEL_BG;
            const fontColor = isTotal ? ACCENT : TEXT_PRIMARY;
            const isBold = isTotal;

            const cell1 = ws.getCell(currentStatsRow, 1);
            styleCell(cell1, { bg: rowBg, fontColor, bold: isBold, alignH: 'left', border: subtleBorder });
            cell1.value = stat.Phase;

            const cell2 = ws.getCell(currentStatsRow, 2);
            styleCell(cell2, { bg: rowBg, fontColor, bold: isBold, numFormat: '#,##0', border: subtleBorder });
            cell2.value = Number(stat["Dist (m)"]);

            const cell3 = ws.getCell(currentStatsRow, 3);
            styleCell(cell3, { bg: rowBg, fontColor, bold: isBold, numFormat: '0.0', border: subtleBorder });
            cell3.value = Number(stat["Time (s)"]);

            const cell4 = ws.getCell(currentStatsRow, 4);
            styleCell(cell4, { bg: rowBg, fontColor, bold: isBold, numFormat: '0.00', border: subtleBorder });
            cell4.value = Number(stat["Mean Vel"]);

            const cell5 = ws.getCell(currentStatsRow, 5);
            styleCell(cell5, { bg: rowBg, fontColor, bold: isBold, numFormat: '0.00', border: subtleBorder });
            cell5.value = Number(stat["Min Vel"]);

            const cell6 = ws.getCell(currentStatsRow, 6);
            styleCell(cell6, { bg: rowBg, fontColor, bold: isBold, numFormat: '0.00', border: subtleBorder });
            cell6.value = Number(stat["Max Vel"]);

            const cell7 = ws.getCell(currentStatsRow, 7);
            styleCell(cell7, { bg: rowBg, fontColor, bold: isBold, numFormat: '0.00', border: subtleBorder });
            cell7.value = Number(stat["Range (Abs)"]);

            const cell8 = ws.getCell(currentStatsRow, 8);
            styleCell(cell8, { bg: rowBg, fontColor, bold: isBold, numFormat: '0.0', border: subtleBorder });
            cell8.value = Number(stat["Range (%)"]);

            const cell9 = ws.getCell(currentStatsRow, 9);
            styleCell(cell9, { bg: rowBg, fontColor, bold: isBold, numFormat: '0.0', border: subtleBorder });
            cell9.value = Number(stat["Var Coef (%)"]);

            const cell10 = ws.getCell(currentStatsRow, 10);
            styleCell(cell10, { bg: rowBg, fontColor, bold: isBold, numFormat: '0.00', border: subtleBorder });
            cell10.value = Number(stat["Incl (Abs)"]);

            const cell11 = ws.getCell(currentStatsRow, 11);
            styleCell(cell11, { bg: rowBg, fontColor, bold: isBold, numFormat: '0.00', border: subtleBorder });
            cell11.value = Number(stat["Incl (%)"]);

            ws.getRow(currentStatsRow).height = 18;
            currentStatsRow++;
          });

          // Insert pacing chart image
          const b64Image = generateChartBase64(data, phaseKey);
          const imageId = wb.addImage({
            base64: b64Image,
            extension: 'png',
          });

          ws.addImage(imageId, {
            tl: { col: 12, row: startRow + 1 }, 
            ext: { width: 560, height: 280 }
          });
        });
      });

      const buffer = await wb.xlsx.writeBuffer();
      saveAs(new Blob([buffer]), `Analise_Pacing_Publico.xlsx`);
      
    } catch (error) {
      console.error(error);
      alert("Error generating Excel: " + error.message);
    } finally {
      exportBtn.innerHTML = oldText;
      exportBtn.disabled = false;
    }
  });
}
