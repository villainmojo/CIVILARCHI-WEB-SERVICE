import * as THREE from 'https://esm.sh/three@0.160.0';
import { OrbitControls } from 'https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'https://esm.sh/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js';

// STEEL STRUCTURE DRAFT (MVP)
// Units: inputs are mm. Internals use meters for Three.js.

// Guard: prevent double-execution if the module is accidentally injected twice
if(window.__civilarchiDraftBooted){
  // eslint-disable-next-line no-console
  console.warn('civilarchi draft: already booted');
} else {
  window.__civilarchiDraftBooted = true;
}

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

  stdAll: () => document.getElementById('drStdAll'),
  colShape: () => document.getElementById('drColShape'),
  colSize: () => document.getElementById('drColSize'),
  beamShape: () => document.getElementById('drBeamShape'),
  beamSize: () => document.getElementById('drBeamSize'),

  subEnable: () => document.getElementById('drSubEnable'),
  subShape: () => document.getElementById('drSubShape'),
  subSize: () => document.getElementById('drSubSize'),
  subCount: () => document.getElementById('drSubCount'),
  joistEnable: () => document.getElementById('drJoistEnable'),

  copy: () => document.getElementById('drCopy'),

  qtyRows: () => document.getElementById('drQtyRows'),
  qtySumCount: () => document.getElementById('drQtySumCount'),
  qtySumLen: () => document.getElementById('drQtySumLen'),
  qtySumLoad: () => document.getElementById('drQtySumLoad'),
  qtySumTop: () => document.getElementById('drQtySumTop'),
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

  raycaster: null,
  pointer: null,
  selectedId: null,
  selectedMesh: null,
  selectedIds: new Set(),
  matGray: null,
  matSelected: null,
};

/** @type {Record<string, {shapeKey:string, sizeKey:string}>} */
const overrides = {};

function effectiveProfile(base, memberId){
  const ov = memberId ? overrides[memberId] : null;
  if(!ov) return base;
  const data = (window.CIVILARCHI_STEEL_DATA && window.CIVILARCHI_STEEL_DATA.standards) || {};
  const item = data?.[base.stdKey]?.shapes?.[ov.shapeKey]?.items?.find(it => it.key === ov.sizeKey) || null;
  return { ...base, shapeKey: ov.shapeKey, sizeKey: ov.sizeKey, name: item?.name ?? ov.sizeKey, kgm: item?.kgm ?? null };
}

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

function getProfileBy(shapeKey, sizeKey){
  const data = (window.CIVILARCHI_STEEL_DATA && window.CIVILARCHI_STEEL_DATA.standards) || {};
  const stdKey = els.stdAll()?.value || 'KS';
  const item = data?.[stdKey]?.shapes?.[shapeKey]?.items?.find(it => it.key === sizeKey) || null;
  return { stdKey, shapeKey, sizeKey, item, kgm: item?.kgm ?? null, name: item?.name ?? '' };
}

function getProfile(role){
  const data = (window.CIVILARCHI_STEEL_DATA && window.CIVILARCHI_STEEL_DATA.standards) || {};
  const stdKey = els.stdAll()?.value || 'KS';

  if(role==='sub'){
    const shapeKey = els.subShape()?.value || 'H';
    const sizeKey = els.subSize()?.value || '';
    const item = data?.[stdKey]?.shapes?.[shapeKey]?.items?.find(it => it.key === sizeKey) || null;
    return { stdKey, shapeKey, sizeKey, item, kgm: item?.kgm ?? null, name: item?.name ?? '' };
  }

  const shapeKey = (role==='col' ? els.colShape()?.value : els.beamShape()?.value) || 'H';
  const sizeKey = (role==='col' ? els.colSize()?.value : els.beamSize()?.value) || '';
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

  const profileCol = getProfile('col');
  const profileBeam = getProfile('beam');
  const profileSub = getProfile('sub');

  const subEnabled = (els.subEnable()?.value === '1');
  const subCountPerBay = clampInt(els.subCount()?.value ?? 0, 0);
  const joistEnabled = (els.joistEnable()?.value === '1');

  return { nx, ny, spansX, spansY, xPosMm, yPosMm, levelsMm, heightMm, colCount, colLenMm, beamCount, beamLenMm, profileCol, profileBeam, profileSub, subEnabled, subCountPerBay, joistEnabled };
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

  state.raycaster = new THREE.Raycaster();
  state.pointer = new THREE.Vector2();

  function syncSelectionMaterials(){
    for(const mesh of state.memberGroup.children){
      const id = mesh?.userData?.id;
      if(!id) continue;
      mesh.material = state.selectedIds.has(id) ? state.matSelected : state.matGray;
    }
  }

  // Selection (Shift: multi)
  state.renderer.domElement.addEventListener('pointerdown', (ev)=>{
    const rect = state.renderer.domElement.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
    state.pointer.set(x,y);
    state.raycaster.setFromCamera(state.pointer, state.camera);

    const hits = state.raycaster.intersectObjects(state.memberGroup.children, false);
    const hit = hits[0]?.object || null;

    if(!ev.shiftKey){
      state.selectedIds.clear();
    }

    if(hit && hit.userData?.id){
      const id = hit.userData.id;
      if(ev.shiftKey && state.selectedIds.has(id)) state.selectedIds.delete(id);
      else state.selectedIds.add(id);

      state.selectedMesh = hit;
      state.selectedId = id;
      syncSelectionMaterials();

      // notify UI (send last selected + full set)
      window.dispatchEvent(new CustomEvent('civilarchi:draft:selected', { detail: { last: hit.userData, ids: [...state.selectedIds] } }));
    } else {
      syncSelectionMaterials();
      window.dispatchEvent(new CustomEvent('civilarchi:draft:selected', { detail: { last: null, ids: [...state.selectedIds] } }));
    }
  });

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

  /** @type {Map<string, {cat:string, member:string, len:number, count:number, loadKg:number|null}>} */
  const g = new Map();
  const add = (cat, prof, lenM) => {
    const member = prof?.name || prof?.sizeKey || '-';
    const key = `${cat}|${member}`;
    const cur = g.get(key) || { cat, member, len: 0, count: 0, loadKg: 0 };
    cur.len += lenM;
    cur.count += 1;
    if (Number.isFinite(prof?.kgm)) cur.loadKg += prof.kgm * lenM;
    g.set(key, cur);
  };

  // columns (each)
  const colLenEachM = mmToM(d.heightMm);
  for (let ix = 0; ix < d.nx; ix++) {
    for (let iy = 0; iy < d.ny; iy++) {
      const id = `C_${ix}_${iy}`;
      const prof = effectiveProfile(d.profileCol, id);
      add('기둥', prof, colLenEachM);
    }
  }

  // beams (each span)
  for (const z of d.levelsMm) {
    // X direction
    for (let iy = 0; iy < d.ny; iy++) {
      for (let ix = 0; ix < d.nx - 1; ix++) {
        const x0 = d.xPosMm[ix] || 0;
        const x1 = d.xPosMm[ix + 1] || 0;
        const lenM = mmToM(x1 - x0);
        const id = `BX_${z}_${iy}_${ix}`;
        const prof = effectiveProfile(d.profileBeam, id);
        add('보', prof, lenM);
      }
    }
    // Y direction
    for (let ix = 0; ix < d.nx; ix++) {
      for (let iy = 0; iy < d.ny - 1; iy++) {
        const y0 = d.yPosMm[iy] || 0;
        const y1 = d.yPosMm[iy + 1] || 0;
        const lenM = mmToM(y1 - y0);
        const id = `BY_${z}_${ix}_${iy}`;
        const prof = effectiveProfile(d.profileBeam, id);
        add('보', prof, lenM);
      }
    }
  }

  // Sub beams
  if(d.subEnabled && d.subCountPerBay > 0){
    const avgX = (d.spansX.reduce((a,b)=>a+b,0) / Math.max(1, d.spansX.length));
    const avgY = (d.spansY.reduce((a,b)=>a+b,0) / Math.max(1, d.spansY.length));
    const runAlongX = avgX <= avgY;

    for(const z of d.levelsMm){
      if(runAlongX){
        // between Y gridlines, place sub beams along X
        for(let bayY=0; bayY<d.ny-1; bayY++){
          const y0 = d.yPosMm[bayY] || 0;
          const y1 = d.yPosMm[bayY+1] || 0;
          for(let k=1; k<=d.subCountPerBay; k++){
            const y = y0 + (k/(d.subCountPerBay+1))*(y1-y0);
            for(let ix=0; ix<d.nx-1; ix++){
              const x0 = d.xPosMm[ix] || 0;
              const x1 = d.xPosMm[ix+1] || 0;
              const lenM = mmToM(x1-x0);
              add('Sub beam', d.profileSub, lenM);
            }
          }
        }
      } else {
        // between X gridlines, place sub beams along Y
        for(let bayX=0; bayX<d.nx-1; bayX++){
          const x0 = d.xPosMm[bayX] || 0;
          const x1 = d.xPosMm[bayX+1] || 0;
          for(let k=1; k<=d.subCountPerBay; k++){
            const x = x0 + (k/(d.subCountPerBay+1))*(x1-x0);
            for(let iy=0; iy<d.ny-1; iy++){
              const y0 = d.yPosMm[iy] || 0;
              const y1 = d.yPosMm[iy+1] || 0;
              const lenM = mmToM(y1-y0);
              add('Sub beam', d.profileSub, lenM);
            }
          }
        }
      }
    }
  }

  // Joists (fixed: C 125x65x6x8, X-dir, 700 spacing)
  if(d.joistEnabled){
    const data = (window.CIVILARCHI_STEEL_DATA && window.CIVILARCHI_STEEL_DATA.standards) || {};
    const stdKey = d.profileBeam.stdKey || 'KS';
    const cItems = data?.[stdKey]?.shapes?.['C']?.items || [];
    const c125 = cItems.find(it => /C\s*125x65x6x8/i.test(it.name)) || cItems[0] || null;
    const profJ = c125 ? { stdKey, shapeKey: 'C', sizeKey: c125.key, name: c125.name, kgm: c125.kgm ?? null } : { stdKey, shapeKey: 'C', sizeKey: 'C125', name: 'C 125x65x6x8', kgm: null };

    const sizeY = d.yPosMm[d.yPosMm.length-1] || 0;
    const step = 700;
    for(const z of d.levelsMm){
      for(let y=step; y < sizeY; y+=step){
        for(let ix=0; ix<d.nx-1; ix++){
          const x0 = d.xPosMm[ix] || 0;
          const x1 = d.xPosMm[ix+1] || 0;
          const lenM = mmToM(x1-x0);
          add('Joist', profJ, lenM);
        }
      }
    }
  }

  const rows = [...g.values()].map(r => ({
    ...r,
    loadKg: (r.loadKg && r.loadKg > 0) ? r.loadKg : null,
  }));

  rowsEl.innerHTML = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.cat}</td>
      <td class="mono">${r.member}</td>
      <td class="right mono">${fmt(r.len, 3)}</td>
      <td class="right mono">${fmt(r.count, 0)}</td>
      <td class="right mono">${fmtLoadKgTon(r.loadKg || null)}</td>
    `;
    rowsEl.appendChild(tr);
  }

  const sumCount = rows.reduce((a,r)=>a + (Number.isFinite(r.count)?r.count:0), 0);
  const sumLen = rows.reduce((a,r)=>a + (Number.isFinite(r.len)?r.len:0), 0);
  const sumLoad = rows.reduce((acc, r) => acc + (Number.isFinite(r.loadKg) ? r.loadKg : 0), 0) || null;

  els.qtySumCount().textContent = fmt(sumCount, 0);
  els.qtySumLen().textContent = fmt(sumLen, 3);
  els.qtySumLoad().textContent = fmtLoadKgTon(sumLoad);

  const top = els.qtySumTop();
  if(top) top.textContent = `전체 물량 합산 무게: ${fmtLoadKgTon(sumLoad)}`;
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

  function parseH(name){
    // Name like: "H 150x150x10x7"
    const m = String(name||'').match(/H\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);
    if(!m) return null;
    return { H: parseFloat(m[1]), B: parseFloat(m[2]), tf: parseFloat(m[3]), tw: parseFloat(m[4]) };
  }

  function makeHGeomForBeamX(lenM, dimMm){
    const B = mmToM(dimMm.B);
    const H = mmToM(dimMm.H);
    const tf = mmToM(dimMm.tf);
    const tw = mmToM(dimMm.tw);

    const top = new THREE.BoxGeometry(lenM, tf, B);
    top.translate(0, (H/2 - tf/2), 0);
    const bot = new THREE.BoxGeometry(lenM, tf, B);
    bot.translate(0, (-H/2 + tf/2), 0);
    const web = new THREE.BoxGeometry(lenM, Math.max(0.001, H - 2*tf), Math.max(0.001, tw));
    web.translate(0, 0, 0);

    return mergeGeometries([top, bot, web], false);
  }

  function makeHGeomForBeamY(lenM, dimMm){
    const g = makeHGeomForBeamX(lenM, dimMm);
    // rotate so length goes to Z, flange width to X
    g.rotateY(Math.PI / 2);
    return g;
  }

  function makeHGeomForColumn(heightM, dimMm){
    const B = mmToM(dimMm.B);
    const H = mmToM(dimMm.H);
    const tf = mmToM(dimMm.tf);
    const tw = mmToM(dimMm.tw);

    // Extrude along Y (vertical)
    const top = new THREE.BoxGeometry(B, heightM, tf);
    top.translate(0, 0, (H/2 - tf/2));
    const bot = new THREE.BoxGeometry(B, heightM, tf);
    bot.translate(0, 0, (-H/2 + tf/2));
    const web = new THREE.BoxGeometry(Math.max(0.001, tw), heightM, Math.max(0.001, H - 2*tf));
    web.translate(0, 0, 0);

    return mergeGeometries([top, bot, web], false);
  }

  // materials (gray + selected)
  if(!state.matGray) state.matGray = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.88, metalness: 0.05 });
  if(!state.matSelected) state.matSelected = new THREE.MeshStandardMaterial({ color: 0x3A6EA5, roughness: 0.75, metalness: 0.10, emissive: 0x0b2a4a, emissiveIntensity: 0.25 });

  const colBase = effectiveProfile(d.profileCol, null);
  const beamBase = effectiveProfile(d.profileBeam, null);

  const colHdim = (colBase.shapeKey === 'H') ? parseH(colBase.name) : null;
  const beamHdim = (beamBase.shapeKey === 'H') ? parseH(beamBase.name) : null;

  const colB = mmToM(colHdim?.B ?? 200);
  const colD = mmToM(colHdim?.H ?? 200);

  const beamB = mmToM(beamHdim?.B ?? 180);
  const beamD = mmToM(beamHdim?.H ?? 220);

  // columns (one piece)
  const h = mmToM(d.heightMm);
  const colGeom = new THREE.BoxGeometry(colB, h || 0.001, colD);
  for (let ix = 0; ix < d.nx; ix++) {
    for (let iy = 0; iy < d.ny; iy++) {
      const x = d.xPosMm[ix] || 0;
      const y = d.yPosMm[iy] || 0;
      const id = `C_${ix}_${iy}`;
      const prof = effectiveProfile(d.profileCol, id);
      const dim = (prof.shapeKey === 'H') ? parseH(prof.name) : null;
      const b = mmToM(dim?.B ?? (colHdim?.B ?? 200));
      const dd = mmToM(dim?.H ?? (colHdim?.H ?? 200));
      const geom = (dim && prof.shapeKey==='H')
        ? makeHGeomForColumn(h || 0.001, dim)
        : new THREE.BoxGeometry(b, h || 0.001, dd);
      const mesh = new THREE.Mesh(geom, state.matGray);
      mesh.userData = { id, role: 'col', stdKey: prof.stdKey, shapeKey: prof.shapeKey, sizeKey: prof.sizeKey };
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
        const id = `BX_${z}_${iy}_${ix}`;
        const prof = effectiveProfile(d.profileBeam, id);
        const dim = (prof.shapeKey === 'H') ? parseH(prof.name) : null;
        const b = mmToM(dim?.B ?? (beamHdim?.B ?? 180));
        const dd = mmToM(dim?.H ?? (beamHdim?.H ?? 220));
        const geom = (dim && prof.shapeKey==='H')
          ? makeHGeomForBeamX(len || 0.001, dim)
          : new THREE.BoxGeometry(len || 0.001, dd, b);
        const mesh = new THREE.Mesh(geom, state.matGray);
        mesh.userData = { id, role: 'beam', stdKey: prof.stdKey, shapeKey: prof.shapeKey, sizeKey: prof.sizeKey };
        const y = d.yPosMm[iy] || 0;
        // Place beam TOP at level elevation
        mesh.position.copy(toV((x0 + x1) / 2, y, z - (dim?.H ?? (beamHdim?.H ?? 220))/2));
        state.memberGroup.add(mesh);
      }
    }

    // Y direction beams
    for (let ix = 0; ix < d.nx; ix++) {
      for (let iy = 0; iy < d.ny - 1; iy++) {
        const y0 = d.yPosMm[iy] || 0;
        const y1 = d.yPosMm[iy+1] || 0;
        const len = mmToM(y1 - y0);
        const id = `BY_${z}_${ix}_${iy}`;
        const prof = effectiveProfile(d.profileBeam, id);
        const dim = (prof.shapeKey === 'H') ? parseH(prof.name) : null;
        const b = mmToM(dim?.B ?? (beamHdim?.B ?? 180));
        const dd = mmToM(dim?.H ?? (beamHdim?.H ?? 220));
        const geom = (dim && prof.shapeKey==='H')
          ? makeHGeomForBeamY(len || 0.001, dim)
          : new THREE.BoxGeometry(b, dd, len || 0.001);
        const mesh = new THREE.Mesh(geom, state.matGray);
        mesh.userData = { id, role: 'beam', stdKey: prof.stdKey, shapeKey: prof.shapeKey, sizeKey: prof.sizeKey };
        const x = d.xPosMm[ix] || 0;
        // Place beam TOP at level elevation
        mesh.position.copy(toV(x, (y0 + y1) / 2, z - (dim?.H ?? (beamHdim?.H ?? 220))/2));
        state.memberGroup.add(mesh);
      }
    }
  }

  // Sub beams + Joists
  const avgX = (d.spansX.reduce((a,b)=>a+b,0) / Math.max(1, d.spansX.length));
  const avgY = (d.spansY.reduce((a,b)=>a+b,0) / Math.max(1, d.spansY.length));
  const runSubAlongX = avgX <= avgY;

  // sub beams
  if(d.subEnabled && d.subCountPerBay > 0){
    const prof = d.profileSub;
    const dim = (prof.shapeKey === 'H') ? parseH(prof.name) : null;
    const b = mmToM(dim?.B ?? 120);
    const dd = mmToM(dim?.H ?? 200);

    for(const z of d.levelsMm){
      if(runSubAlongX){
        for(let bayY=0; bayY<d.ny-1; bayY++){
          const y0 = d.yPosMm[bayY] || 0;
          const y1 = d.yPosMm[bayY+1] || 0;
          for(let k=1; k<=d.subCountPerBay; k++){
            const y = y0 + (k/(d.subCountPerBay+1))*(y1-y0);
            for(let ix=0; ix<d.nx-1; ix++){
              const x0 = d.xPosMm[ix] || 0;
              const x1 = d.xPosMm[ix+1] || 0;
              const len = mmToM(x1-x0);
              const id = `SBX_${z}_${bayY}_${k}_${ix}`;
              const geom = (dim && prof.shapeKey==='H')
                ? makeHGeomForBeamX(len || 0.001, dim)
                : new THREE.BoxGeometry(len || 0.001, dd, b);
              const mesh = new THREE.Mesh(geom, state.matGray);
              mesh.userData = { id, role: 'sub', stdKey: prof.stdKey, shapeKey: prof.shapeKey, sizeKey: prof.sizeKey };
              mesh.position.copy(toV((x0+x1)/2, y, z - (dim?.H ?? 200)/2));
              state.memberGroup.add(mesh);
            }
          }
        }
      } else {
        for(let bayX=0; bayX<d.nx-1; bayX++){
          const x0 = d.xPosMm[bayX] || 0;
          const x1 = d.xPosMm[bayX+1] || 0;
          for(let k=1; k<=d.subCountPerBay; k++){
            const x = x0 + (k/(d.subCountPerBay+1))*(x1-x0);
            for(let iy=0; iy<d.ny-1; iy++){
              const y0 = d.yPosMm[iy] || 0;
              const y1 = d.yPosMm[iy+1] || 0;
              const len = mmToM(y1-y0);
              const id = `SBY_${z}_${bayX}_${k}_${iy}`;
              const geom = (dim && prof.shapeKey==='H')
                ? makeHGeomForBeamY(len || 0.001, dim)
                : new THREE.BoxGeometry(b, dd, len || 0.001);
              const mesh = new THREE.Mesh(geom, state.matGray);
              mesh.userData = { id, role: 'sub', stdKey: prof.stdKey, shapeKey: prof.shapeKey, sizeKey: prof.sizeKey };
              mesh.position.copy(toV(x, (y0+y1)/2, z - (dim?.H ?? 200)/2));
              state.memberGroup.add(mesh);
            }
          }
        }
      }
    }
  }

  // joists (X-dir, 700mm spacing, C 125x65x6x8)
  if(d.joistEnabled){
    const data = (window.CIVILARCHI_STEEL_DATA && window.CIVILARCHI_STEEL_DATA.standards) || {};
    const stdKey = d.profileBeam.stdKey || 'KS';
    const cItems = data?.[stdKey]?.shapes?.['C']?.items || [];
    const c125 = cItems.find(it => /C\s*125x65x6x8/i.test(it.name)) || cItems[0] || null;
    const profJ = c125 ? { stdKey, shapeKey: 'C', sizeKey: c125.key, name: c125.name, kgm: c125.kgm ?? null } : { stdKey, shapeKey: 'C', sizeKey: 'C125', name: 'C 125x65x6x8', kgm: null };

    const sizeYmm = d.yPosMm[d.yPosMm.length-1] || 0;
    const step = 700;
    // rough dims
    const jb = mmToM(65);
    const jd = mmToM(125);

    for(const z of d.levelsMm){
      for(let ymm=step; ymm < sizeYmm; ymm += step){
        for(let ix=0; ix<d.nx-1; ix++){
          const x0 = d.xPosMm[ix] || 0;
          const x1 = d.xPosMm[ix+1] || 0;
          const len = mmToM(x1-x0);
          const id = `JX_${z}_${ymm}_${ix}`;
          const geom = new THREE.BoxGeometry(len || 0.001, jd, jb);
          const mesh = new THREE.Mesh(geom, state.matGray);
          mesh.userData = { id, role: 'joist', stdKey: profJ.stdKey, shapeKey: profJ.shapeKey, sizeKey: profJ.sizeKey };
          mesh.position.copy(toV((x0+x1)/2, ymm, z - 125/2));
          state.memberGroup.add(mesh);
        }
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
  const kgmCol = (d.profileCol && Number.isFinite(d.profileCol.kgm)) ? d.profileCol.kgm : null;
  const kgmBeam = (d.profileBeam && Number.isFinite(d.profileBeam.kgm)) ? d.profileBeam.kgm : null;

  const colLenM = mmToM(d.colLenMm);
  const beamLenM = mmToM(d.beamLenMm);
  const sumLenM = colLenM + beamLenM;

  const colLoadKg = (kgmCol != null) ? colLenM * kgmCol : null;
  const beamLoadKg = (kgmBeam != null) ? beamLenM * kgmBeam : null;
  const sumLoadKg = ((colLoadKg ?? 0) + (beamLoadKg ?? 0)) || null;

  const colLabel = d.profileCol.name || d.profileCol.sizeKey || '';
  const beamLabel = d.profileBeam.name || d.profileBeam.sizeKey || '';

  const lines = [];
  lines.push(['분류', '부재종류', '길이(m)', '갯수', '하중'].join('\t'));
  lines.push(['기둥', colLabel, String(colLenM), String(d.colCount), colLoadKg == null ? '' : String(colLoadKg)].join('\t'));
  lines.push(['보', beamLabel, String(beamLenM), String(d.beamCount), beamLoadKg == null ? '' : String(beamLoadKg)].join('\t'));
  lines.push(['합계', '', String(sumLenM), String(d.colCount + d.beamCount), sumLoadKg == null ? '' : String(sumLoadKg)].join('\t'));
  const tsv = lines.join('\n');
  await navigator.clipboard.writeText(tsv);
}

function fillProfileSelectors(){
  const data = (window.CIVILARCHI_STEEL_DATA && window.CIVILARCHI_STEEL_DATA.standards) || {};
  const stdAll = els.stdAll();
  const colShape = els.colShape();
  const colSize = els.colSize();
  const beamShape = els.beamShape();
  const beamSize = els.beamSize();
  const subEnable = els.subEnable();
  const subShape = els.subShape();
  const subSize = els.subSize();
  const subCount = els.subCount();
  const joistEnable = els.joistEnable();

  if(!stdAll || !colShape || !colSize || !beamShape || !beamSize || !subEnable || !subShape || !subSize || !subCount || !joistEnable) return;

  const STD_LABEL = { KS: 'KR · KS', JIS: 'JP · JIS' };
  const SHAPE_KEYS = ['H','C','L','LC','Rect','I','T'];

  // standards
  stdAll.innerHTML='';
  ['KS','JIS'].filter(k => data[k]).forEach(k=>{
    const opt=document.createElement('option');
    opt.value=k; opt.textContent=STD_LABEL[k]||k;
    stdAll.appendChild(opt);
  });
  stdAll.value = data['KS'] ? 'KS' : (stdAll.options[0]?.value || '');

  function rebuildShapeSelect(sel){
    const stdKey = stdAll.value;
    const shapes = data[stdKey]?.shapes || {};
    const keys = SHAPE_KEYS.filter(k=>shapes[k]);
    sel.innerHTML='';
    keys.forEach(k=>{
      const opt=document.createElement('option');
      opt.value=k; opt.textContent=k;
      sel.appendChild(opt);
    });
    if(keys.includes('H')) sel.value='H';
  }

  function rebuildSizeSelect(shapeSel, sizeSel){
    const stdKey = stdAll.value;
    const shapeKey = shapeSel.value;
    const items = data[stdKey]?.shapes?.[shapeKey]?.items || [];
    sizeSel.innerHTML='';
    items.forEach(it=>{
      const opt=document.createElement('option');
      opt.value = it.key;
      opt.textContent = `${it.name}${(it.kgm!=null && Number.isFinite(it.kgm)) ? ` · ${it.kgm} kg/m` : ''}`;
      sizeSel.appendChild(opt);
    });
    const preferred = items.find(it => /^H\s*150x150/i.test(it.name));
    if(preferred) sizeSel.value = preferred.key;
  }

  function rebuildAll(){
    rebuildShapeSelect(colShape);
    rebuildShapeSelect(beamShape);
    rebuildShapeSelect(subShape);
    rebuildSizeSelect(colShape, colSize);
    rebuildSizeSelect(beamShape, beamSize);
    rebuildSizeSelect(subShape, subSize);

    // default OFF
    if(!subEnable.value) subEnable.value = '0';
    if(!joistEnable.value) joistEnable.value = '0';
  }

  rebuildAll();

  stdAll.addEventListener('change', ()=>{ rebuildAll(); rebuild(); });
  colShape.addEventListener('change', ()=>{ rebuildSizeSelect(colShape, colSize); rebuild(); });
  beamShape.addEventListener('change', ()=>{ rebuildSizeSelect(beamShape, beamSize); rebuild(); });
  subShape.addEventListener('change', ()=>{ rebuildSizeSelect(subShape, subSize); rebuild(); });

  colSize.addEventListener('change', rebuild);
  beamSize.addEventListener('change', rebuild);
  subSize.addEventListener('change', rebuild);

  subEnable.addEventListener('change', rebuild);
  subCount.addEventListener('input', rebuild);
  joistEnable.addEventListener('change', rebuild);
}

function initSelectionUI(){
  const panel = document.getElementById('drOvPanel');
  const btnToggle = document.getElementById('drOvToggle');
  const btnCollapse = document.getElementById('drOvCollapse');

  const info = document.getElementById('drOvInfo');
  const selShape = document.getElementById('drOvShape');
  const selSize = document.getElementById('drOvSize');
  const btnApply = document.getElementById('drOvApply');
  const btnClear = document.getElementById('drOvClear');
  const btnResetAll = document.getElementById('drOvResetAll');
  const ovList = document.getElementById('drOvList');

  function setCollapsed(on){
    if(!panel) return;
    panel.classList.toggle('collapsed', !!on);
  }
  btnToggle && (btnToggle.onclick = ()=>{
    if(!panel) return;
    setCollapsed(!panel.classList.contains('collapsed'));
  });
  btnCollapse && (btnCollapse.onclick = ()=> setCollapsed(true));
  // default collapsed
  setCollapsed(true);

  const data = (window.CIVILARCHI_STEEL_DATA && window.CIVILARCHI_STEEL_DATA.standards) || {};

  function disableAll(){
    selShape.disabled = true;
    selSize.disabled = true;
    btnApply.disabled = true;
    btnClear.disabled = true;
  }

  function enableAll(){
    selShape.disabled = false;
    selSize.disabled = false;
    btnApply.disabled = false;
    btnClear.disabled = false;
  }

  function renderOverrideList(){
    if(!ovList) return;
    const entries = Object.entries(overrides);
    ovList.innerHTML = '';
    if(entries.length === 0){
      const tr=document.createElement('tr');
      tr.innerHTML = '<td colspan="5" class="muted">(override 없음)</td>';
      ovList.appendChild(tr);
      return;
    }
    for(const [id, ov] of entries){
      const tr=document.createElement('tr');
      tr.innerHTML = `
        <td class="mono">${id}</td>
        <td>${id.startsWith('C_') ? '기둥' : '보'}</td>
        <td class="mono">${ov.shapeKey}</td>
        <td class="mono">${ov.sizeKey}</td>
        <td class="right"><button class="mini-btn" data-ov-del="${id}">삭제</button></td>
      `;
      ovList.appendChild(tr);
    }
  }

  ovList?.addEventListener('click', (e)=>{
    const btn = e.target.closest('[data-ov-del]');
    if(!btn) return;
    const id = btn.getAttribute('data-ov-del');
    delete overrides[id];
    btnResetAll && (btnResetAll.disabled = Object.keys(overrides).length === 0);
    renderOverrideList();
    rebuild();
  });

  function fillFrom(payload){
    const last = payload?.last || null;
    const ids = payload?.ids || [];

    renderOverrideList();

    if(!last){
      info.textContent = ids.length ? `선택됨: ${ids.length}개 (Shift 클릭으로 추가/해제)` : '3D에서 부재를 클릭하면 여기서 해당 부재만 프로파일을 변경할 수 있습니다. (Shift 클릭: 멀티 선택)';
      disableAll();
      selShape.innerHTML='';
      selSize.innerHTML='';
      btnResetAll && (btnResetAll.disabled = Object.keys(overrides).length === 0);
      return;
    }

    // keep panel collapsed; user opens via button

    const stdKey = els.stdAll()?.value || last.stdKey || 'KS';
    const shapes = data?.[stdKey]?.shapes || {};
    const shapeKeys = Object.keys(shapes);

    selShape.innerHTML='';
    shapeKeys.forEach(sk=>{
      const opt=document.createElement('option');
      opt.value=sk; opt.textContent=sk;
      selShape.appendChild(opt);
    });

    const currentOv = overrides[last.id];
    selShape.value = currentOv?.shapeKey || last.shapeKey || (shapeKeys.includes('H')?'H':(shapeKeys[0]||''));

    function fillSizes(){
      const items = shapes?.[selShape.value]?.items || [];
      selSize.innerHTML='';
      items.forEach(it=>{
        const opt=document.createElement('option');
        opt.value=it.key;
        opt.textContent = `${it.name}${(it.kgm!=null && Number.isFinite(it.kgm)) ? ` · ${it.kgm} kg/m` : ''}`;
        selSize.appendChild(opt);
      });
      selSize.value = currentOv?.sizeKey || last.sizeKey || (items[0]?.key || '');
    }

    fillSizes();
    enableAll();

    info.textContent = `선택됨: ${last.role.toUpperCase()} · ${last.id} (총 ${ids.length}개 선택)`;

    selShape.onchange = ()=>{ fillSizes(); };

    btnApply.onclick = ()=>{
      for(const id of ids){
        overrides[id] = { shapeKey: selShape.value, sizeKey: selSize.value };
      }
      if(btnResetAll) btnResetAll.disabled = Object.keys(overrides).length === 0;
      renderOverrideList();
      rebuild();
    };

    btnClear.onclick = ()=>{
      for(const id of ids){
        delete overrides[id];
      }
      if(btnResetAll) btnResetAll.disabled = Object.keys(overrides).length === 0;
      renderOverrideList();
      rebuild();
    };
  }

  window.addEventListener('civilarchi:draft:selected', (e)=>{
    fillFrom(e.detail);
  });

  btnResetAll && (btnResetAll.onclick = ()=>{
    for(const k of Object.keys(overrides)) delete overrides[k];
    if(btnResetAll) btnResetAll.disabled = true;
    // keep current selection
    window.dispatchEvent(new CustomEvent('civilarchi:draft:selected', { detail: { last: state.selectedMesh?.userData || null, ids: [...state.selectedIds] } }));
    rebuild();
  });

  // initial state
  if(btnResetAll) btnResetAll.disabled = true;
  fillFrom({ last: null, ids: [] });
}

function wire() {
  // Avoid double-wiring if module loaded twice
  if(window.__civilarchiDraftWired) return;
  window.__civilarchiDraftWired = true;

  initLevels();
  fillProfileSelectors();
  initSelectionUI();

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
