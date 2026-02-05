import * as THREE from 'https://esm.sh/three@0.160.0';
import { OrbitControls } from 'https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js';

// STEEL STRUCTURE DRAFT (MVP)
// Units: inputs are mm. Internals use meters for Three.js.

// Debug hook: lets app.js detect module executed
window.__civilarchiDraftModuleExecuted = (window.__civilarchiDraftModuleExecuted || 0) + 1;

const mmToM = (mm) => mm / 1000;
const clampNum = (v, min = 0) => {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, n);
};
const clampInt = (v, min = 1) => {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, n);
};

function fmt(n, digits = 3) {
  if (n == null || !Number.isFinite(n)) return '-';
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

const els = {
  canvas: () => document.getElementById('drCanvas'),
  gridX: () => document.getElementById('drGridX'),
  gridY: () => document.getElementById('drGridY'),
  spacingX: () => document.getElementById('drSpacingX'),
  spacingY: () => document.getElementById('drSpacingY'),
  levels: () => document.getElementById('drLevels'),
  addLevel: () => document.getElementById('drAddLevel'),
  copy: () => document.getElementById('drCopy'),

  qtyRows: () => document.getElementById('drQtyRows'),
  qtySumCount: () => document.getElementById('drQtySumCount'),
  qtySumLen: () => document.getElementById('drQtySumLen'),
  qtySumLoad: () => document.getElementById('drQtySumLoad'),
};

const state = {
  inited: false,
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  root: null,
  gridGroup: null,
  memberGroup: null,
  raf: 0,
};

function clearGroup(g) {
  if (!g) return;
  while (g.children.length) {
    const c = g.children.pop();
    g.remove(c);
  }
}

function getLevelHeightsMm() {
  const wrap = els.levels();
  if (!wrap) return [];
  const inputs = [...wrap.querySelectorAll('input[data-level]')];
  return inputs.map((i) => clampNum(i.value, 0));
}

function renderLevels(rows) {
  const wrap = els.levels();
  if (!wrap) return;
  wrap.innerHTML = '';

  rows.forEach((h, idx) => {
    const row = document.createElement('div');
    row.style.display = 'grid';
    row.style.gridTemplateColumns = '1fr auto';
    row.style.gap = '10px';
    row.style.alignItems = 'end';
    row.innerHTML = `
      <label style="margin:0">
        <span>Level ${idx + 1} 높이 (mm)</span>
        <input data-level="${idx}" type="number" min="0" step="1" value="${h}" />
      </label>
      <button class="mini-btn" data-level-del="${idx}">삭제</button>
    `;
    wrap.appendChild(row);
  });
}

function initLevels() {
  const wrap = els.levels();
  if (!wrap) return;

  // default 2 levels if empty
  if (wrap.querySelectorAll('input[data-level]').length === 0) {
    renderLevels([4200, 4200]);
  }

  els.addLevel()?.addEventListener('click', () => {
    const hs = getLevelHeightsMm();
    hs.push(4200);
    renderLevels(hs);
    rebuild();
  });

  wrap.addEventListener('input', (e) => {
    if (e.target && e.target.matches('input[data-level]')) rebuild();
  });

  wrap.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-level-del]');
    if (!btn) return;
    const idx = clampInt(btn.getAttribute('data-level-del'), 0);
    const hs = getLevelHeightsMm().filter((_, i) => i !== idx);
    renderLevels(hs);
    rebuild();
  });
}

function calc() {
  const nx = clampInt(els.gridX()?.value ?? 1, 1);
  const ny = clampInt(els.gridY()?.value ?? 1, 1);
  const sx = clampNum(els.spacingX()?.value ?? 1, 1);
  const sy = clampNum(els.spacingY()?.value ?? 1, 1);

  const levels = getLevelHeightsMm().filter((v) => v > 0);
  const heightMm = levels.reduce((a, b) => a + b, 0);

  const colCount = nx * ny;
  const colLenMm = colCount * heightMm;

  const beamLevels = levels.length;
  const beamCountPerLevel = (ny * Math.max(0, nx - 1)) + (nx * Math.max(0, ny - 1));
  const beamCount = beamLevels * beamCountPerLevel;

  const beamLenPerLevelMm = (ny * Math.max(0, nx - 1) * sx) + (nx * Math.max(0, ny - 1) * sy);
  const beamLenMm = beamLevels * beamLenPerLevelMm;

  return { nx, ny, sx, sy, levels, heightMm, colCount, colLenMm, beamCount, beamLenMm };
}

function ensureThree() {
  if (state.inited) return true;
  const canvasWrap = els.canvas();
  if (!canvasWrap) return false;

  state.scene = new THREE.Scene();
  state.scene.background = new THREE.Color(0xffffff);

  state.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
  state.camera.position.set(8, 8, 8);

  try{
    state.renderer = new THREE.WebGLRenderer({ antialias: true });
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    canvasWrap.innerHTML = '';
    canvasWrap.appendChild(state.renderer.domElement);
  } catch(e){
    canvasWrap.innerHTML = '<div style="padding:14px; color: rgba(46,46,46,0.75)">WebGL을 초기화하지 못했습니다. (브라우저/그래픽 설정 확인)</div>';
    return false;
  }

  const light1 = new THREE.DirectionalLight(0xffffff, 0.9);
  light1.position.set(10, 20, 10);
  state.scene.add(light1);
  state.scene.add(new THREE.AmbientLight(0xffffff, 0.55));

  state.controls = new OrbitControls(state.camera, state.renderer.domElement);
  state.controls.enableDamping = true;

  state.root = new THREE.Group();
  state.scene.add(state.root);

  state.gridGroup = new THREE.Group();
  state.memberGroup = new THREE.Group();
  state.root.add(state.gridGroup);
  state.root.add(state.memberGroup);

  const resize = () => {
    const rect = canvasWrap.getBoundingClientRect();
    const w = Math.max(10, rect.width);
    const h = Math.max(10, rect.height);
    state.camera.aspect = w / h;
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(w, h);
  };

  window.addEventListener('resize', resize);
  resize();

  const tick = () => {
    state.raf = requestAnimationFrame(tick);
    state.controls?.update();
    state.renderer.render(state.scene, state.camera);
  };
  tick();

  state.inited = true;
  return true;
}

function renderQty(d) {
  const rowsEl = els.qtyRows();
  if (!rowsEl) return;

  const colLenM = mmToM(d.colLenMm);
  const beamLenM = mmToM(d.beamLenMm);

  const rows = [
    { cat: '기둥', member: 'COLUMN', len: colLenM, count: d.colCount, load: null },
    { cat: '보', member: 'BEAM', len: beamLenM, count: d.beamCount, load: null },
  ];

  rowsEl.innerHTML = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.cat}</td>
      <td class="mono">${r.member}</td>
      <td class="right mono">${fmt(r.len, 3)}</td>
      <td class="right mono">${fmt(r.count, 0)}</td>
      <td class="right mono">${r.load == null ? '-' : fmt(r.load, 3)}</td>
    `;
    rowsEl.appendChild(tr);
  }

  const sumCount = d.colCount + d.beamCount;
  const sumLen = colLenM + beamLenM;

  els.qtySumCount().textContent = fmt(sumCount, 0);
  els.qtySumLen().textContent = fmt(sumLen, 3);
  els.qtySumLoad().textContent = '-';
}

function rebuild() {
  const d = calc();
  renderQty(d);

  const ok = ensureThree();
  if (!ok || !state.inited) return;

  clearGroup(state.gridGroup);
  clearGroup(state.memberGroup);

  // center model
  const sizeX = (d.nx - 1) * d.sx;
  const sizeY = (d.ny - 1) * d.sy;
  const cx = sizeX / 2;
  const cy = sizeY / 2;

  const toV = (xmm, ymm, zmm) => new THREE.Vector3(mmToM(xmm - cx), mmToM(zmm), mmToM(ymm - cy));

  // grid lines (base)
  const gridMat = new THREE.LineBasicMaterial({ color: 0x3A6EA5, transparent: true, opacity: 0.35 });
  for (let ix = 0; ix < d.nx; ix++) {
    const x = ix * d.sx;
    const geom = new THREE.BufferGeometry().setFromPoints([toV(x, 0, 0), toV(x, sizeY, 0)]);
    state.gridGroup.add(new THREE.Line(geom, gridMat));
  }
  for (let iy = 0; iy < d.ny; iy++) {
    const y = iy * d.sy;
    const geom = new THREE.BufferGeometry().setFromPoints([toV(0, y, 0), toV(sizeX, y, 0)]);
    state.gridGroup.add(new THREE.Line(geom, gridMat));
  }

  // members (placeholder box sections)
  const colMat = new THREE.MeshStandardMaterial({ color: 0x1F2A44, roughness: 0.8, metalness: 0.15 });
  const beamMat = new THREE.MeshStandardMaterial({ color: 0x2E2E2E, roughness: 0.85, metalness: 0.05 });

  const colW = mmToM(200);
  const beamW = mmToM(180);
  const beamH = mmToM(220);

  // columns (one piece)
  const h = mmToM(d.heightMm);
  const colGeom = new THREE.BoxGeometry(colW, h || 0.001, colW);
  for (let ix = 0; ix < d.nx; ix++) {
    for (let iy = 0; iy < d.ny; iy++) {
      const x = ix * d.sx;
      const y = iy * d.sy;
      const mesh = new THREE.Mesh(colGeom, colMat);
      mesh.position.copy(toV(x, y, d.heightMm / 2));
      state.memberGroup.add(mesh);
    }
  }

  // beams per level
  let zAcc = 0;
  for (const lvl of d.levels) {
    zAcc += lvl;
    const z = zAcc;

    // X direction beams
    for (let iy = 0; iy < d.ny; iy++) {
      for (let ix = 0; ix < d.nx - 1; ix++) {
        const x0 = ix * d.sx;
        const x1 = (ix + 1) * d.sx;
        const len = mmToM(x1 - x0);
        const geom = new THREE.BoxGeometry(len || 0.001, beamH, beamW);
        const mesh = new THREE.Mesh(geom, beamMat);
        mesh.position.copy(toV((x0 + x1) / 2, iy * d.sy, z));
        state.memberGroup.add(mesh);
      }
    }

    // Y direction beams
    for (let ix = 0; ix < d.nx; ix++) {
      for (let iy = 0; iy < d.ny - 1; iy++) {
        const y0 = iy * d.sy;
        const y1 = (iy + 1) * d.sy;
        const len = mmToM(y1 - y0);
        const geom = new THREE.BoxGeometry(beamW, beamH, len || 0.001);
        const mesh = new THREE.Mesh(geom, beamMat);
        mesh.position.copy(toV(ix * d.sx, (y0 + y1) / 2, z));
        state.memberGroup.add(mesh);
      }
    }
  }

  // frame camera
  const radius = mmToM(Math.max(sizeX, sizeY, d.heightMm)) * 0.9 + 2;
  state.camera.position.set(radius, radius * 0.85, radius);
  state.controls.target.set(0, mmToM(d.heightMm) * 0.45, 0);
  state.controls.update();
}

async function copyToClipboard() {
  const d = calc();
  const lines = [];
  lines.push(['분류', '부재종류', '길이(m)', '갯수', '하중'].join('\t'));
  lines.push(['기둥', 'COLUMN', String(mmToM(d.colLenMm)), String(d.colCount), '-'].join('\t'));
  lines.push(['보', 'BEAM', String(mmToM(d.beamLenMm)), String(d.beamCount), '-'].join('\t'));
  lines.push(['합계', '', String(mmToM(d.colLenMm + d.beamLenMm)), String(d.colCount + d.beamCount), '-'].join('\t'));
  const tsv = lines.join('\n');
  await navigator.clipboard.writeText(tsv);
}

function wire() {
  initLevels();

  [els.gridX(), els.gridY(), els.spacingX(), els.spacingY()].forEach((el) => {
    el?.addEventListener('input', rebuild);
  });

  els.copy()?.addEventListener('click', async () => {
    try {
      await copyToClipboard();
      window.dispatchEvent(new CustomEvent('civilarchi:toast', { detail: 'DRAFT 물량(길이) 표를 복사했습니다. 엑셀에 붙여넣기 하세요.' }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent('civilarchi:toast', { detail: '복사 실패(브라우저 권한).' }));
    }
  });
}

let wired = false;
function show() {
  if (!wired) {
    wire();
    wired = true;
  }
  setTimeout(rebuild, 30);
}

window.addEventListener('civilarchi:draft:show', show);

function maybeAutoShow(){
  try{
    if((location.hash || '') === '#draft') show();
  }catch(_e){}
}

// If loaded directly in #draft
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', maybeAutoShow, { once: true });
} else {
  maybeAutoShow();
}
