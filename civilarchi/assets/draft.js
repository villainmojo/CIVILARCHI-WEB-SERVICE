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
  spansX: () => document.getElementById('drSpansX'),
  spansY: () => document.getElementById('drSpansY'),

  levels: () => document.getElementById('drLevels'),
  addLevel: () => document.getElementById('drAddLevel'),

  std: () => document.getElementById('drStd'),
  shape: () => document.getElementById('drShape'),
  size: () => document.getElementById('drSize'),

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

function getLevelElevationsMm() {
  const wrap = els.levels();
  if (!wrap) return [];
  const inputs = [...wrap.querySelectorAll('input[data-level]')];
  return inputs
    .map((i) => clampNum(i.value, 0))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
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

  // default 2 levels if empty (absolute elevations)
  if (wrap.querySelectorAll('input[data-level]').length === 0) {
    renderLevels([4200, 8400]);
  }

  els.addLevel()?.addEventListener('click', () => {
    const hs = getLevelElevationsMm();
    const last = hs.length ? hs[hs.length - 1] : 0;
    hs.push(last + 4200);
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
    const hs = getLevelElevationsMm().filter((_, i) => i !== idx);
    renderLevels(hs);
    rebuild();
  });
}

function parseSpans(text){
  if(!text) return [];
  return text
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => clampNum(s, 1));
}

function cumulativePos(spans){
  const pos=[0];
  for(const s of spans) pos.push(pos[pos.length-1] + s);
  return pos;
}

function getProfile(){
  const data = (window.CIVILARCHI_STEEL_DATA && window.CIVILARCHI_STEEL_DATA.standards) || {};
  const stdKey = els.std()?.value || 'KS';
  const shapeKey = els.shape()?.value || 'H';
  const sizeKey = els.size()?.value || '';
  const item = data?.[stdKey]?.shapes?.[shapeKey]?.items?.find(it => it.key === sizeKey) || null;
  return { stdKey, shapeKey, sizeKey, item, kgm: item?.kgm ?? null, name: item?.name ?? '' };
}

function calc() {
  let nx = clampInt(els.gridX()?.value ?? 1, 1);
  let ny = clampInt(els.gridY()?.value ?? 1, 1);
  const sx = clampNum(els.spacingX()?.value ?? 1, 1);
  const sy = clampNum(els.spacingY()?.value ?? 1, 1);

  let spansX = parseSpans(els.spansX()?.value || '');
  let spansY = parseSpans(els.spansY()?.value || '');

  if(spansX.length){ nx = spansX.length + 1; if(els.gridX()) els.gridX().value = String(nx); }
  else spansX = Array.from({length: Math.max(0,nx-1)}, () => sx);

  if(spansY.length){ ny = spansY.length + 1; if(els.gridY()) els.gridY().value = String(ny); }
  else spansY = Array.from({length: Math.max(0,ny-1)}, () => sy);

  const xPosMm = cumulativePos(spansX);
  const yPosMm = cumulativePos(spansY);

  const levelsMm = getLevelElevationsMm();
  const heightMm = levelsMm.length ? levelsMm[levelsMm.length - 1] : 0;

  const colCount = nx * ny;
  const colLenMm = colCount * heightMm;

  const beamLevels = levelsMm.length;
  const beamCountPerLevel = (ny * Math.max(0, nx - 1)) + (nx * Math.max(0, ny - 1));
  const beamCount = beamLevels * beamCountPerLevel;

  const sumX = spansX.reduce((a,b)=>a+b,0);
  const sumY = spansY.reduce((a,b)=>a+b,0);
  const beamLenPerLevelMm = (ny * sumX) + (nx * sumY);
  const beamLenMm = beamLevels * beamLenPerLevelMm;

  const profile = getProfile();

  return { nx, ny, spansX, spansY, xPosMm, yPosMm, levelsMm, heightMm, colCount, colLenMm, beamCount, beamLenMm, profile };
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

function fmtLoadKgTon(kg){
  if(kg == null || !Number.isFinite(kg)) return '-';
  const ton = kg/1000;
  return `${fmt(kg,3)} kg (${fmt(ton,6)} t)`;
}

function renderQty(d) {
  const rowsEl = els.qtyRows();
  if (!rowsEl) return;

  const colLenM = mmToM(d.colLenMm);
  const beamLenM = mmToM(d.beamLenMm);

  const kgm = (d.profile && Number.isFinite(d.profile.kgm)) ? d.profile.kgm : null;
  const colLoadKg = (kgm != null) ? (colLenM * kgm) : null;
  const beamLoadKg = (kgm != null) ? (beamLenM * kgm) : null;

  const rows = [
    { cat: '기둥', member: d.profile.name || d.profile.sizeKey || 'COLUMN', len: colLenM, count: d.colCount, loadKg: colLoadKg },
    { cat: '보', member: d.profile.name || d.profile.sizeKey || 'BEAM', len: beamLenM, count: d.beamCount, loadKg: beamLoadKg },
  ];

  rowsEl.innerHTML = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.cat}</td>
      <td class="mono">${r.member}</td>
      <td class="right mono">${fmt(r.len, 3)}</td>
      <td class="right mono">${fmt(r.count, 0)}</td>
      <td class="right mono">${fmtLoadKgTon(r.loadKg)}</td>
    `;
    rowsEl.appendChild(tr);
  }

  const sumCount = d.colCount + d.beamCount;
  const sumLen = colLenM + beamLenM;
  const sumLoad = (kgm != null) ? ((sumLen * kgm)) : null;

  els.qtySumCount().textContent = fmt(sumCount, 0);
  els.qtySumLen().textContent = fmt(sumLen, 3);
  els.qtySumLoad().textContent = fmtLoadKgTon(sumLoad);
}

function rebuild() {
  const d = calc();
  renderQty(d);

  const ok = ensureThree();
  if (!ok || !state.inited) return;

  clearGroup(state.gridGroup);
  clearGroup(state.memberGroup);

  // center model
  const sizeX = d.xPosMm[d.xPosMm.length-1] || 0;
  const sizeY = d.yPosMm[d.yPosMm.length-1] || 0;
  const cx = sizeX / 2;
  const cy = sizeY / 2;

  const toV = (xmm, ymm, zmm) => new THREE.Vector3(mmToM(xmm - cx), mmToM(zmm), mmToM(ymm - cy));

  // grid lines (base)
  const gridMat = new THREE.LineBasicMaterial({ color: 0x3A6EA5, transparent: true, opacity: 0.35 });
  for (let ix = 0; ix < d.nx; ix++) {
    const x = d.xPosMm[ix] || 0;
    const geom = new THREE.BufferGeometry().setFromPoints([toV(x, 0, 0), toV(x, sizeY, 0)]);
    state.gridGroup.add(new THREE.Line(geom, gridMat));
  }
  for (let iy = 0; iy < d.ny; iy++) {
    const y = d.yPosMm[iy] || 0;
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
      const x = d.xPosMm[ix] || 0;
      const y = d.yPosMm[iy] || 0;
      const mesh = new THREE.Mesh(colGeom, colMat);
      mesh.position.copy(toV(x, y, d.heightMm / 2));
      state.memberGroup.add(mesh);
    }
  }

  // beams per level (absolute elevations)
  for (const z of d.levelsMm) {
    // X direction beams
    for (let iy = 0; iy < d.ny; iy++) {
      for (let ix = 0; ix < d.nx - 1; ix++) {
        const x0 = d.xPosMm[ix] || 0;
        const x1 = d.xPosMm[ix+1] || 0;
        const len = mmToM(x1 - x0);
        const geom = new THREE.BoxGeometry(len || 0.001, beamH, beamW);
        const mesh = new THREE.Mesh(geom, beamMat);
        const y = d.yPosMm[iy] || 0;
        mesh.position.copy(toV((x0 + x1) / 2, y, z));
        state.memberGroup.add(mesh);
      }
    }

    // Y direction beams
    for (let ix = 0; ix < d.nx; ix++) {
      for (let iy = 0; iy < d.ny - 1; iy++) {
        const y0 = d.yPosMm[iy] || 0;
        const y1 = d.yPosMm[iy+1] || 0;
        const len = mmToM(y1 - y0);
        const geom = new THREE.BoxGeometry(beamW, beamH, len || 0.001);
        const mesh = new THREE.Mesh(geom, beamMat);
        const x = d.xPosMm[ix] || 0;
        mesh.position.copy(toV(x, (y0 + y1) / 2, z));
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
  const kgm = (d.profile && Number.isFinite(d.profile.kgm)) ? d.profile.kgm : null;

  const colLenM = mmToM(d.colLenMm);
  const beamLenM = mmToM(d.beamLenMm);
  const sumLenM = colLenM + beamLenM;

  const colLoadKg = (kgm != null) ? colLenM * kgm : null;
  const beamLoadKg = (kgm != null) ? beamLenM * kgm : null;
  const sumLoadKg = (kgm != null) ? sumLenM * kgm : null;

  const memberLabel = d.profile.name || d.profile.sizeKey || '';

  const lines = [];
  lines.push(['분류', '부재종류', '길이(m)', '갯수', '하중'].join('\t'));
  lines.push(['기둥', memberLabel, String(colLenM), String(d.colCount), colLoadKg == null ? '' : String(colLoadKg)].join('\t'));
  lines.push(['보', memberLabel, String(beamLenM), String(d.beamCount), beamLoadKg == null ? '' : String(beamLoadKg)].join('\t'));
  lines.push(['합계', '', String(sumLenM), String(d.colCount + d.beamCount), sumLoadKg == null ? '' : String(sumLoadKg)].join('\t'));
  const tsv = lines.join('\n');
  await navigator.clipboard.writeText(tsv);
}

function fillProfileSelectors(){
  const data = (window.CIVILARCHI_STEEL_DATA && window.CIVILARCHI_STEEL_DATA.standards) || {};
  const stdSel = els.std();
  const shapeSel = els.shape();
  const sizeSel = els.size();
  if(!stdSel || !shapeSel || !sizeSel) return;

  const STD_LABEL = { KS: 'KR · KS', JIS: 'JP · JIS' };
  const SHAPE_LABEL = { H:'H', C:'C', L:'L', LC:'LC', Rect:'Rect', I:'I', T:'T' };

  // standards
  if(stdSel.options.length === 0){
    stdSel.innerHTML='';
    ['KS','JIS'].filter(k => data[k]).forEach(k=>{
      const opt=document.createElement('option');
      opt.value=k; opt.textContent=STD_LABEL[k]||k;
      stdSel.appendChild(opt);
    });
    stdSel.value = data['KS'] ? 'KS' : (stdSel.options[0]?.value || '');
  }

  function rebuildShapes(){
    const stdKey = stdSel.value;
    const shapes = data[stdKey]?.shapes || {};
    const keys = Object.keys(shapes);
    shapeSel.innerHTML='';
    keys.forEach(k=>{
      const opt=document.createElement('option');
      opt.value=k; opt.textContent = SHAPE_LABEL[k] || k;
      shapeSel.appendChild(opt);
    });
    if(keys.includes('H')) shapeSel.value='H';
  }

  function rebuildSizes(){
    const stdKey = stdSel.value;
    const shapeKey = shapeSel.value;
    const items = data[stdKey]?.shapes?.[shapeKey]?.items || [];
    sizeSel.innerHTML='';
    items.forEach(it=>{
      const opt=document.createElement('option');
      opt.value = it.key;
      opt.textContent = `${it.name}${(it.kgm!=null && Number.isFinite(it.kgm)) ? ` · ${it.kgm} kg/m` : ''}`;
      sizeSel.appendChild(opt);
    });

    // default H 150x150... if present
    const preferred = items.find(it => /^H\s*150x150/i.test(it.name));
    if(preferred) sizeSel.value = preferred.key;
  }

  // init
  rebuildShapes();
  rebuildSizes();

  stdSel.addEventListener('change', ()=>{ rebuildShapes(); rebuildSizes(); rebuild(); });
  shapeSel.addEventListener('change', ()=>{ rebuildSizes(); rebuild(); });
  sizeSel.addEventListener('change', rebuild);
}

function wire() {
  initLevels();
  fillProfileSelectors();

  [els.gridX(), els.gridY(), els.spacingX(), els.spacingY(), els.spansX(), els.spansY()].forEach((el) => {
    el?.addEventListener('input', rebuild);
  });

  els.copy()?.addEventListener('click', async () => {
    try {
      await copyToClipboard();
      window.dispatchEvent(new CustomEvent('civilarchi:toast', { detail: 'DRAFT 물량 표를 복사했습니다. 엑셀에 붙여넣기 하세요.' }));
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
