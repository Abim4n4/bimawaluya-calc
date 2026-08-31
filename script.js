// =====================================================================
// FTTH Link Budget Calculator — model bertahap (staged)
// Mengikuti jalur fisik nyata: SFP/OLT → patchcord → OTB → feeder →
// ODC (IN/OUT) → distribusi → ODP (IN/OUT) → kabel drop → ONT.
// Semua perhitungan berjalan di browser (client-side), tidak ada data
// yang dikirim ke server manapun.
// =====================================================================

const STORAGE_KEY = 'bimawaluya-calc-v2';

const SPLITTER_LOSS_TABLE = {
  '1:2': 3.5,
  '1:4': 7.0,
  '1:8': 10.5,
  '1:16': 14.0,
  '1:32': 17.5,
  '1:64': 21.0
};

// Nilai "maksimum" = tipikal + toleransi pabrikan (~0.5 dB) sebagai perkiraan
// worst-case yang lebih konservatif. Angka pastinya tetap beda tiap vendor —
// selalu cek datasheet splitter riil yang dipakai, field ini bisa diedit manual.
const SPLITTER_LOSS_TABLE_MAX = Object.fromEntries(
  Object.entries(SPLITTER_LOSS_TABLE).map(([ratio, db]) => [ratio, Math.round((db + 0.5) * 10) / 10])
);

// Preset teknologi: nilai tipikal untuk perencanaan awal.
// Kelas daya OLT/ONT (B+, C+, N1, N2, dst) bervariasi antar vendor —
// selalu cocokkan dengan datasheet SFP/ONT yang sesungguhnya dipakai.
const PRESETS = {
  'gpon-down':    { tx: 3,   rx: -28 },
  'gpon-up':      { tx: 1.5, rx: -28 },
  'xgpon-down':   { tx: 4,   rx: -28 },
  'xgspon':       { tx: 4,   rx: -28 },
  'epon-down':    { tx: 3,   rx: -24 },
  '10gepon-down': { tx: 4,   rx: -28.5 }
};

const el = (id) => document.getElementById(id);

const inputs = {
  preset: el('preset'),
  sfpTx: el('sfpTx'),
  oltConnCount: el('oltConnCount'),
  oltConnLoss: el('oltConnLoss'),
  otbLoss: el('otbLoss'),
  wavelength: el('wavelength'),
  customAtten: el('customAtten'),
  customAttenWrap: el('customAttenWrap'),
  splitterValueMode: el('splitterValueMode'),
  feederLength: el('feederLength'),
  feederSpliceCount: el('feederSpliceCount'),
  feederSpliceLoss: el('feederSpliceLoss'),
  odcSplitterRatio: el('odcSplitterRatio'),
  odcSplitterLoss: el('odcSplitterLoss'),
  odcConnCount: el('odcConnCount'),
  odcConnLoss: el('odcConnLoss'),
  distLength: el('distLength'),
  distSpliceCount: el('distSpliceCount'),
  distSpliceLoss: el('distSpliceLoss'),
  odpSplitterRatio: el('odpSplitterRatio'),
  odpSplitterLoss: el('odpSplitterLoss'),
  odpConnCount: el('odpConnCount'),
  odpConnLoss: el('odpConnLoss'),
  dropLength: el('dropLength'),
  dropConnCount: el('dropConnCount'),
  dropConnLoss: el('dropConnLoss'),
  rxSens: el('rxSens'),
  maxOverload: el('maxOverload'),
  safetyMargin: el('safetyMargin'),
  uncertaintyPct: el('uncertaintyPct')
};

// ---------------------------------------------------------------------
// Accordion: toggle per-stage, expand/collapse all
// ---------------------------------------------------------------------
document.querySelectorAll('.stage').forEach(stage => {
  const header = stage.querySelector('.stage__header');
  header.addEventListener('click', () => {
    const collapsed = stage.dataset.collapsed === 'true';
    stage.dataset.collapsed = collapsed ? 'false' : 'true';
    header.setAttribute('aria-expanded', collapsed ? 'true' : 'false');
  });
});

el('expandAllBtn').addEventListener('click', () => {
  document.querySelectorAll('.stage').forEach(stage => {
    stage.dataset.collapsed = 'false';
    stage.querySelector('.stage__header').setAttribute('aria-expanded', 'true');
  });
});

el('collapseAllBtn').addEventListener('click', () => {
  document.querySelectorAll('.stage').forEach(stage => {
    stage.dataset.collapsed = 'true';
    stage.querySelector('.stage__header').setAttribute('aria-expanded', 'false');
  });
});

// Klik status pill di header (sticky) -> scroll halus ke panel hasil
el('topStatus').addEventListener('click', () => {
  el('resultPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ---------------------------------------------------------------------
// Splitter dropdowns (ODC & ODP) — populate options, auto-fill loss
// ---------------------------------------------------------------------
function populateSplitterSelect(selectEl, defaultRatio) {
  selectEl.innerHTML = Object.keys(SPLITTER_LOSS_TABLE).map(r =>
    `<option value="${r}" ${r === defaultRatio ? 'selected' : ''}>Splitter ${r}</option>`
  ).join('');
}
populateSplitterSelect(inputs.odcSplitterRatio, '1:4');
populateSplitterSelect(inputs.odpSplitterRatio, '1:8');

function currentSplitterTable() {
  return inputs.splitterValueMode.value === 'max' ? SPLITTER_LOSS_TABLE_MAX : SPLITTER_LOSS_TABLE;
}

inputs.odcSplitterRatio.addEventListener('change', () => {
  inputs.odcSplitterLoss.value = currentSplitterTable()[inputs.odcSplitterRatio.value];
  render(calculate());
});
inputs.odpSplitterRatio.addEventListener('change', () => {
  inputs.odpSplitterLoss.value = currentSplitterTable()[inputs.odpSplitterRatio.value];
  render(calculate());
});

// Ganti mode (Tipikal/Maksimum) -> isi ulang nilai insertion loss ODC & ODP
// sesuai rasio yang sedang dipilih. Field tetap bisa diedit manual sesudahnya.
inputs.splitterValueMode.addEventListener('change', () => {
  const table = currentSplitterTable();
  inputs.odcSplitterLoss.value = table[inputs.odcSplitterRatio.value];
  inputs.odpSplitterLoss.value = table[inputs.odpSplitterRatio.value];
  render(calculate());
});

// ---------------------------------------------------------------------
// Preset & wavelength handling
// ---------------------------------------------------------------------
inputs.preset.addEventListener('change', () => {
  const p = PRESETS[inputs.preset.value];
  if (p) {
    inputs.sfpTx.value = p.tx;
    inputs.rxSens.value = p.rx;
  }
});

inputs.wavelength.addEventListener('change', () => {
  inputs.customAttenWrap.hidden = inputs.wavelength.value !== 'custom';
});

function currentAttenCoeff() {
  if (inputs.wavelength.value === 'custom') {
    return parseFloat(inputs.customAtten.value) || 0;
  }
  return parseFloat(inputs.wavelength.value) || 0;
}

// ---------------------------------------------------------------------
// Calculation — mengalir tahap demi tahap sesuai jalur fisik
// ---------------------------------------------------------------------
function calculate() {
  const sfpTx = parseFloat(inputs.sfpTx.value) || 0;
  const rxSens = parseFloat(inputs.rxSens.value) || 0;
  const maxOverload = parseFloat(inputs.maxOverload.value) || 0;
  const safetyMargin = Math.max(0, parseFloat(inputs.safetyMargin.value) || 0);
  const attenCoeff = currentAttenCoeff(); // dB/km, dipakai di semua segmen kabel

  // Tahap 2: patchcord OLT -> OTB
  const oltConnCount = Math.max(0, parseInt(inputs.oltConnCount.value) || 0);
  const oltConnLoss = Math.max(0, parseFloat(inputs.oltConnLoss.value) || 0);
  const lossPatch = oltConnCount * oltConnLoss;

  // Tahap 3: OTB
  const otbLoss = Math.max(0, parseFloat(inputs.otbLoss.value) || 0);
  const otbPower = sfpTx - lossPatch - otbLoss;

  // Tahap 4: feeder OTB -> ODC
  const feederLength = Math.max(0, parseFloat(inputs.feederLength.value) || 0);
  const feederSpliceCount = Math.max(0, parseInt(inputs.feederSpliceCount.value) || 0);
  const feederSpliceLoss = Math.max(0, parseFloat(inputs.feederSpliceLoss.value) || 0);
  const lossFeederFiber = feederLength * attenCoeff;
  const lossFeederSplice = feederSpliceCount * feederSpliceLoss;

  // Tahap 5: ODC — IN & OUT
  const odcIN = otbPower - lossFeederFiber - lossFeederSplice;
  const odcSplitterRatio = inputs.odcSplitterRatio.value;
  const odcSplitterLoss = Math.max(0, parseFloat(inputs.odcSplitterLoss.value) || 0);
  const odcConnCount = Math.max(0, parseInt(inputs.odcConnCount.value) || 0);
  const odcConnLoss = Math.max(0, parseFloat(inputs.odcConnLoss.value) || 0);
  const odcConnLossTotal = odcConnCount * odcConnLoss;
  const odcOUT = odcIN - odcSplitterLoss - odcConnLossTotal;

  // Tahap 6: distribusi ODC -> ODP
  const distLength = Math.max(0, parseFloat(inputs.distLength.value) || 0);
  const distSpliceCount = Math.max(0, parseInt(inputs.distSpliceCount.value) || 0);
  const distSpliceLoss = Math.max(0, parseFloat(inputs.distSpliceLoss.value) || 0);
  const lossDistFiber = distLength * attenCoeff;
  const lossDistSplice = distSpliceCount * distSpliceLoss;

  // Tahap 7-8: ODP — IN & OUT
  const odpIN = odcOUT - lossDistFiber - lossDistSplice;
  const odpSplitterRatio = inputs.odpSplitterRatio.value;
  const odpSplitterLoss = Math.max(0, parseFloat(inputs.odpSplitterLoss.value) || 0);
  const odpConnCount = Math.max(0, parseInt(inputs.odpConnCount.value) || 0);
  const odpConnLoss = Math.max(0, parseFloat(inputs.odpConnLoss.value) || 0);
  const odpConnLossTotal = odpConnCount * odpConnLoss;
  const odpOUT = odpIN - odpSplitterLoss - odpConnLossTotal;

  // Tahap 9: kabel drop ODP -> rumah pelanggan (meter)
  const dropLength = Math.max(0, parseFloat(inputs.dropLength.value) || 0);
  const dropConnCount = Math.max(0, parseInt(inputs.dropConnCount.value) || 0);
  const dropConnLoss = Math.max(0, parseFloat(inputs.dropConnLoss.value) || 0);
  const dropAttenPerM = attenCoeff / 1000;
  const lossDropFiber = dropLength * dropAttenPerM;
  const dropConnLossTotal = dropConnCount * dropConnLoss;

  // Tahap 10: ONT — daya ideal (sesuai spec datasheet, sebelum buffer ketidakpastian)
  const idealRx = odpOUT - lossDropFiber - dropConnLossTotal;

  const actualLoss = sfpTx - idealRx; // total redaman ideal
  const uncertaintyPct = Math.max(0, parseFloat(inputs.uncertaintyPct.value) || 0);
  const adjustedLoss = actualLoss * (1 + uncertaintyPct / 100); // total redaman konservatif
  const conservativeRx = sfpTx - adjustedLoss; // dipakai untuk keputusan LULUS/GAGAL

  const margin = conservativeRx - rxSens; // margin dihitung dari skenario konservatif (worst-case redaman)
  const totalBudget = sfpTx - rxSens;
  const overloadMargin = maxOverload - idealRx; // overload dicek dari skenario ideal (worst-case daya berlebih)

  let status;
  if (idealRx > maxOverload) status = 'overload';
  else if (margin < 0) status = 'fail';
  else if (margin < safetyMargin) status = 'warn';
  else status = 'pass';

  return {
    sfpTx, rxSens, maxOverload, overloadMargin, safetyMargin, attenCoeff,
    oltConnCount, oltConnLoss, lossPatch,
    otbLoss, otbPower,
    feederLength, feederSpliceCount, feederSpliceLoss, lossFeederFiber, lossFeederSplice,
    odcIN, odcSplitterRatio, odcSplitterLoss, odcConnCount, odcConnLoss, odcConnLossTotal, odcOUT,
    distLength, distSpliceCount, distSpliceLoss, lossDistFiber, lossDistSplice,
    odpIN, odpSplitterRatio, odpSplitterLoss, odpConnCount, odpConnLoss, odpConnLossTotal, odpOUT,
    dropLength, dropConnCount, dropConnLoss, lossDropFiber, dropConnLossTotal,
    idealRx, actualLoss, uncertaintyPct, adjustedLoss, conservativeRx,
    margin, totalBudget, status
  };
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------
const STATUS_META = {
  pass: { label: 'LULUS', title: 'Link memenuhi margin keamanan', topText: 'LULUS' },
  warn: { label: 'MARGINAL', title: 'Link menyala tapi margin di bawah batas aman', topText: 'MARGINAL' },
  fail: { label: 'GAGAL', title: 'Daya terima di bawah sensitivitas penerima', topText: 'GAGAL' },
  overload: { label: 'OVERLOAD', title: 'Daya terima melebihi batas maksimum ONT', topText: 'OVERLOAD' }
};

function fmt(n, digits = 2) {
  return (Math.round(n * 100) / 100).toFixed(digits);
}

function flashValue(node) {
  node.classList.remove('value-flash');
  // force reflow supaya animasi bisa retrigger walau class sama
  void node.offsetWidth;
  node.classList.add('value-flash');
}

function render(result) {
  const { status } = result;
  const meta = STATUS_META[status];

  el('odcInReadout').textContent = `IN ODC: ${fmt(result.odcIN, 1)} dBm`;
  el('odpInReadout').textContent = `IN ODP: ${fmt(result.odpIN, 1)} dBm`;

  const topStatus = el('topStatus');
  topStatus.dataset.state = status;
  el('topStatusText').textContent = meta.topText;
  el('topRxValue').textContent = `${fmt(result.conservativeRx, 1)} dBm`;

  const rxEl = el('rxPowerValue');
  rxEl.innerHTML = `${fmt(result.conservativeRx)} <small>dBm</small>`;
  flashValue(rxEl);
  el('idealRxNote').textContent = `Ideal (sesuai spec): ${fmt(result.idealRx)} dBm`;
  el('totalLossValue').textContent = `${fmt(result.adjustedLoss)} dB`;
  el('marginValue').textContent = `${fmt(result.margin)} dB`;

  const banner = el('statusBanner');
  banner.dataset.state = status;
  el('statusTitle').textContent = `${meta.label} — ${meta.title}`;

  let desc;
  if (status === 'pass') {
    desc = `Margin konservatif ${fmt(result.margin)} dB melebihi syarat minimum ${fmt(result.safetyMargin)} dB, dan skenario ideal masih ${fmt(result.overloadMargin)} dB di bawah batas overload. Link aman digunakan, sudah memperhitungkan buffer ketidakpastian lapangan +${fmt(result.uncertaintyPct, 0)}%.`;
  } else if (status === 'warn') {
    desc = `Skenario konservatif masih menyala (margin ${fmt(result.margin)} dB), tapi di bawah margin keamanan ${fmt(result.safetyMargin)} dB. Perhatikan: ini sudah termasuk buffer ketidakpastian +${fmt(result.uncertaintyPct, 0)}% — kalau kondisi kabel/konektor jelek, link berisiko drop.`;
  } else if (status === 'overload') {
    const excess = fmt(Math.abs(result.overloadMargin));
    desc = `Daya terima (skenario ideal) melebihi ${excess} dB dari batas maksimum ONT (${fmt(result.maxOverload)} dBm). Redaman jalur terlalu sedikit — berisiko merusak fotodetektor ONT dalam jangka panjang. Tambahkan splitter/redaman, atau pasang attenuator.`;
  } else {
    const deficit = fmt(Math.abs(result.margin));
    desc = `Daya terima skenario konservatif (sudah +${fmt(result.uncertaintyPct, 0)}% buffer) kurang ${deficit} dB dari sensitivitas ONT. Bandingkan checkpoint IN/OUT di bawah (nilai ideal) dengan hasil ukur OPM untuk cari titik bermasalah.`;
  }
  el('statusDesc').textContent = desc;

  renderGauge(result);
  renderTimeline(result);
  renderBreakdown(result);
}

function renderGauge(result) {
  const { sfpTx, rxSens, idealRx, conservativeRx, safetyMargin, totalBudget, maxOverload } = result;
  el('gaugeTxLabel').textContent = `${fmt(sfpTx, 1)} dBm`;
  el('gaugeRxLabel').textContent = `${fmt(rxSens, 1)} dBm`;

  const scaleSpan = totalBudget > 0 ? totalBudget : 1;

  // Pointer utama (tebal) = skenario konservatif — ini yang menentukan status
  let pointerPct = ((sfpTx - conservativeRx) / scaleSpan) * 100;
  pointerPct = Math.max(0, Math.min(100, pointerPct));
  el('gaugePointer').style.top = pointerPct + '%';
  el('gaugePointerLabel').textContent = `${fmt(conservativeRx, 1)} dBm`;

  // Pointer sekunder (tipis) = skenario ideal, buat perbandingan
  let idealPct = ((sfpTx - idealRx) / scaleSpan) * 100;
  idealPct = Math.max(0, Math.min(100, idealPct));
  el('gaugeIdealPointer').style.top = idealPct + '%';
  el('gaugeIdealPointer').title = `Ideal: ${fmt(idealRx, 1)} dBm`;

  let marginPct = (safetyMargin / scaleSpan) * 100;
  marginPct = Math.max(0, Math.min(100, marginPct));
  el('gaugeMarginZone').style.height = marginPct + '%';

  // Zona overload: bagian atas gauge (dekat Tx), daerah di atas batas maks ONT
  let overloadPct = ((sfpTx - maxOverload) / scaleSpan) * 100;
  overloadPct = Math.max(0, Math.min(100, overloadPct));
  el('gaugeOverloadZone').style.height = overloadPct + '%';
}

function renderTimeline(result) {
  const points = [
    { label: 'SFP OUT (OLT)', value: result.sfpTx, endpoint: true },
    { label: 'OTB (setelah patchcord + OTB)', value: result.otbPower },
    { label: `ODC — IN`, value: result.odcIN },
    { label: `ODC — OUT (splitter ${result.odcSplitterRatio})`, value: result.odcOUT },
    { label: `ODP — IN`, value: result.odpIN },
    { label: `ODP — OUT (splitter ${result.odpSplitterRatio})`, value: result.odpOUT },
    { label: 'ONT / rumah pelanggan (ideal)', value: result.idealRx, endpoint: true }
  ];

  el('timeline').innerHTML = points.map(p => `
    <div class="timeline__item ${p.endpoint ? 'timeline__item--endpoint' : ''}">
      <span class="timeline__dot"></span>
      <span class="timeline__label">${p.label}</span>
      <span class="timeline__value">${fmt(p.value, 1)} dBm</span>
    </div>
  `).join('');
}

function renderBreakdown(result) {
  const rows = [
    ['Patchcord OLT → OTB', `${result.oltConnCount} × ${fmt(result.oltConnLoss, 2)} dB`, fmt(result.lossPatch)],
    ['OTB (pigtail/adaptor)', '', fmt(result.otbLoss)],
    ['Feeder OTB → ODC', `${fmt(result.feederLength, 2)} km × ${fmt(result.attenCoeff, 2)} dB/km`, fmt(result.lossFeederFiber)],
    ['Sambungan feeder', `${result.feederSpliceCount} × ${fmt(result.feederSpliceLoss, 2)} dB`, fmt(result.lossFeederSplice)],
    [`Splitter ODC (${result.odcSplitterRatio})`, 'insertion loss', fmt(result.odcSplitterLoss)],
    ['Konektor ODC', `${result.odcConnCount} × ${fmt(result.odcConnLoss, 2)} dB`, fmt(result.odcConnLossTotal)],
    ['Distribusi ODC → ODP', `${fmt(result.distLength, 2)} km × ${fmt(result.attenCoeff, 2)} dB/km`, fmt(result.lossDistFiber)],
    ['Sambungan distribusi', `${result.distSpliceCount} × ${fmt(result.distSpliceLoss, 2)} dB`, fmt(result.lossDistSplice)],
    [`Splitter ODP (${result.odpSplitterRatio})`, 'insertion loss', fmt(result.odpSplitterLoss)],
    ['Konektor ODP', `${result.odpConnCount} × ${fmt(result.odpConnLoss, 2)} dB`, fmt(result.odpConnLossTotal)],
    ['Kabel drop (DC) ODP → rumah', `${fmt(result.dropLength, 0)} m`, fmt(result.lossDropFiber)],
    ['Konektor drop', `${result.dropConnCount} × ${fmt(result.dropConnLoss, 2)} dB`, fmt(result.dropConnLossTotal)],
    ['Total redaman (ideal)', 'sesuai spec datasheet', fmt(result.actualLoss)],
    [`Buffer ketidakpastian lapangan (+${fmt(result.uncertaintyPct, 0)}%)`, 'konektor kotor, bending, dll', fmt(result.adjustedLoss - result.actualLoss)],
    ['<strong>Total redaman (konservatif)</strong>', '', `<strong>${fmt(result.adjustedLoss)}</strong>`]
  ];

  el('breakdownBody').innerHTML = rows.map(r =>
    `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]} dB</td></tr>`
  ).join('');
}

// ---------------------------------------------------------------------
// Copy result as text (untuk laporan WhatsApp/dokumentasi lapangan)
// ---------------------------------------------------------------------
function buildTextSummary(result) {
  const meta = STATUS_META[result.status];
  const lines = [
    `LINK BUDGET FTTH — ${meta.label}`,
    `----------------------------------`,
    `SFP OUT (OLT)   : ${fmt(result.sfpTx, 2)} dBm`,
    `OTB             : ${fmt(result.otbPower, 2)} dBm`,
    `ODC — IN        : ${fmt(result.odcIN, 2)} dBm`,
    `ODC — OUT (${result.odcSplitterRatio}) : ${fmt(result.odcOUT, 2)} dBm`,
    `ODP — IN        : ${fmt(result.odpIN, 2)} dBm`,
    `ODP — OUT (${result.odpSplitterRatio}) : ${fmt(result.odpOUT, 2)} dBm`,
    `ONT (ideal)     : ${fmt(result.idealRx, 2)} dBm`,
    `ONT (konservatif, +${fmt(result.uncertaintyPct, 0)}%) : ${fmt(result.conservativeRx, 2)} dBm`,
    `----------------------------------`,
    `Panjang feeder      : ${fmt(result.feederLength, 2)} km`,
    `Panjang distribusi  : ${fmt(result.distLength, 2)} km`,
    `Panjang drop (DC)   : ${fmt(result.dropLength, 0)} m`,
    `----------------------------------`,
    `Total redaman (ideal)       : ${fmt(result.actualLoss)} dB`,
    `Total redaman (konservatif) : ${fmt(result.adjustedLoss)} dB`,
    `Sensitivitas Rx : ${fmt(result.rxSens, 2)} dBm (batas bawah)`,
    `Maks. overload  : ${fmt(result.maxOverload, 2)} dBm (batas atas)`,
    `Margin tersisa  : ${fmt(result.margin)} dB (syarat min ${fmt(result.safetyMargin)} dB)`,
    `Status          : ${meta.label}`
  ];
  return lines.join('\n');
}

el('copyBtn').addEventListener('click', async () => {
  const result = calculate();
  const text = buildTextSummary(result);
  try {
    await navigator.clipboard.writeText(text);
    const btn = el('copyBtn');
    const original = btn.textContent;
    btn.textContent = '✓ Tersalin ke clipboard';
    setTimeout(() => { btn.textContent = original; }, 1800);
  } catch (err) {
    alert('Gagal menyalin otomatis. Salin manual dari sini:\n\n' + text);
  }
});

// ---------------------------------------------------------------------
// Persistence (localStorage)
// ---------------------------------------------------------------------
function saveState() {
  const state = { values: {} };
  Object.keys(inputs).forEach(key => {
    if (inputs[key] && 'value' in inputs[key]) state.values[key] = inputs[key].value;
  });
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

function loadState() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { saved = null; }
  if (!saved) return;
  Object.keys(saved.values || {}).forEach(key => {
    if (inputs[key]) inputs[key].value = saved.values[key];
  });
  inputs.customAttenWrap.hidden = inputs.wavelength.value !== 'custom';
}

// ---------------------------------------------------------------------
// Wire up
// ---------------------------------------------------------------------
el('calcBtn').addEventListener('click', () => {
  render(calculate());
  saveState();
});

el('resetBtn').addEventListener('click', () => {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  location.reload();
});

document.querySelectorAll('input, select').forEach(node => {
  node.addEventListener('input', () => render(calculate()));
  node.addEventListener('change', () => render(calculate()));
});

// Init
loadState();
render(calculate());
el('footerYear').textContent = new Date().getFullYear();
