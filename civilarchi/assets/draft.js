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

  braceToggle: () => document.getElementById('drBraceToggle'),
  bracePanel: () => document.getElementById('drBracePanel'),
  braceExit: () => document.getElementById('drBraceExit'),
  braceType: () => document.getElementById('drBraceType'),
  braceShape: () => document.getElementById('drBraceShape'),
  braceSize: () => document.getElementById('drBraceSize'),
  braceHint: () => document.getElementById('drBraceHint'),

  copy: () => document.getElementById('drCopy'),
  viewHome: () => document.getElementById('drViewHome'),

  exportStaad: () => document.getElementById('drExportStaad'),
  exportIfc: () => document.getElementById('drExportIfc'),
  exportData: () => document.getElementById('drExportData'),

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

  braceMode: false,
  bracePlaneGroup: null,
  braceGroup: null,
  braceType: 'X',
  braceProfile: null,
};

/** @type {Array<{id:string, faceKey:string, kind:'X'|'S', stdKey:string, shapeKey:string, sizeKey:string, name:string, kgm:number|null, a:{x:number,y:number,z:number}, b:{x:number,y:number,z:number}, c?:{x:number,y:number,z:number}, d?:{x:number,y:number,z:number}}>} */
const braces = [];

/** @type {Record<string, {shapeKey:string, sizeKey:string}>} */
const overrides = {};

function downloadText(filename, text){
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 500);
}

function collectMemberRecords(){
  const recs = [];
  const addFromGroup = (g)=>{
    for(const m of (g?.children||[])){
      const ud = m.userData || {};
      if(!ud.p0 || !ud.p1) continue;
      const dx = ud.p1.x-ud.p0.x;
      const dy = ud.p1.y-ud.p0.y;
      const dz = ud.p1.z-ud.p0.z;
      const lenMm = Math.sqrt(dx*dx+dy*dy+dz*dz);
      recs.push({
        id: ud.id || '',
        role: ud.role || '',
        stdKey: ud.stdKey || '',
        shapeKey: ud.shapeKey || '',
        sizeKey: ud.sizeKey || '',
        name: ud.name || '',
        x0: ud.p0.x, y0: ud.p0.y, z0: ud.p0.z,
        x1: ud.p1.x, y1: ud.p1.y, z1: ud.p1.z,
        lenMm,
      });
    }
  };
  addFromGroup(state.memberGroup);
  addFromGroup(state.braceGroup);
  return recs;
}

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

function getProfileFromSelectors(shapeSel, sizeSel){
  const shapeKey = shapeSel?.value || 'H';
  const sizeKey = sizeSel?.value || '';
  return getProfileBy(shapeKey, sizeKey);
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
  state.controls.enablePan = true;
  // Middle mouse drag = pan
  state.controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.ROTATE,
  };
  state.controls.addEventListener('change', ()=>{ state.__userMoved = true; });

  state.raycaster = new THREE.Raycaster();
  state.pointer = new THREE.Vector2();

  // Brace face hover highlight (each face uses its own material instance)
  let lastFace = null;
  function setFaceHover(faceMesh){
    if(lastFace && lastFace.material){
      lastFace.material.opacity = 0.0;
      lastFace.material.needsUpdate = true;
    }
    lastFace = faceMesh;
    if(lastFace && lastFace.material){
      lastFace.material.opacity = 0.16;
      lastFace.material.needsUpdate = true;
    }
  }
  state.renderer.domElement.addEventListener('pointermove', (ev)=>{
    if(!state.braceMode) return;
    const rect = state.renderer.domElement.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
    state.pointer.set(x,y);
    state.raycaster.setFromCamera(state.pointer, state.camera);
    const hits = state.raycaster.intersectObjects(state.bracePlaneGroup.children, false);
    const hit = hits[0]?.object || null;
    setFaceHover(hit);
  });

  function baseMatFor(mesh){
    const role = mesh?.userData?.role || 'default';
    return state.roleMats?.[role] || state.roleMats?.default;
  }
  function syncSelectionMaterials(){
    for(const mesh of state.memberGroup.children){
      const id = mesh?.userData?.id;
      if(!id) continue;
      mesh.material = state.selectedIds.has(id) ? state.matSelected : baseMatFor(mesh);
    }
  }

  // Selection / Brace mode click
  state.renderer.domElement.addEventListener('pointerdown', (ev)=>{
    const rect = state.renderer.domElement.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
    state.pointer.set(x,y);
    state.raycaster.setFromCamera(state.pointer, state.camera);

    if(state.braceMode){
      const hits = state.raycaster.intersectObjects(state.bracePlaneGroup.children, false);
      const hit = hits[0]?.object || null;
      if(hit && hit.userData?.faceKey){
        window.dispatchEvent(new CustomEvent('civilarchi:draft:braceFace', { detail: hit.userData }));
      }
      return;
    }

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
  state.bracePlaneGroup = new THREE.Group();
  state.braceGroup = new THREE.Group();
  state.root.add(state.gridGroup);
  state.root.add(state.memberGroup);
  state.root.add(state.bracePlaneGroup);
  state.root.add(state.braceGroup);

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

  // Sub beams + Joists need consistent direction
  const avgX = (d.spansX.reduce((a,b)=>a+b,0) / Math.max(1, d.spansX.length));
  const avgY = (d.spansY.reduce((a,b)=>a+b,0) / Math.max(1, d.spansY.length));
  const subAlongX = avgX <= avgY;

  // Sub beams (between main beams only => within each bay)
  if(d.subEnabled && d.subCountPerBay > 0){
    for(const z of d.levelsMm){
      if(subAlongX){
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

  // Joists (between beam/subbeam lines only, 90deg to sub beam, 700 spacing)
  if(d.joistEnabled){
    const data = (window.CIVILARCHI_STEEL_DATA && window.CIVILARCHI_STEEL_DATA.standards) || {};
    const stdKey = d.profileBeam.stdKey || 'KS';
    const cItems = data?.[stdKey]?.shapes?.['C']?.items || [];
    const c125 = cItems.find(it => /C\s*125x65x6x8/i.test(it.name)) || cItems[0] || null;
    const profJ = c125 ? { stdKey, shapeKey: 'C', sizeKey: c125.key, name: c125.name, kgm: c125.kgm ?? null } : { stdKey, shapeKey: 'C', sizeKey: 'C125', name: 'C 125x65x6x8', kgm: null };

    const step = 700;
    const sizeXmm = d.xPosMm[d.xPosMm.length-1] || 0;
    const sizeYmm = d.yPosMm[d.yPosMm.length-1] || 0;

    // subbeam lines positions inside bays (mm)
    const yLines = [];
    if(subAlongX){
      for(let bayY=0; bayY<d.ny-1; bayY++){
        const y0 = d.yPosMm[bayY] || 0;
        const y1 = d.yPosMm[bayY+1] || 0;
        yLines.push(y0, y1);
        for(let k=1; k<=d.subCountPerBay; k++){
          yLines.push(y0 + (k/(d.subCountPerBay+1))*(y1-y0));
        }
      }
    } else {
      // when subbeams along Y, joists along X, so boundaries in X
    }

    const xLines = [];
    if(!subAlongX){
      for(let bayX=0; bayX<d.nx-1; bayX++){
        const x0 = d.xPosMm[bayX] || 0;
        const x1 = d.xPosMm[bayX+1] || 0;
        xLines.push(x0, x1);
        for(let k=1; k<=d.subCountPerBay; k++){
          xLines.push(x0 + (k/(d.subCountPerBay+1))*(x1-x0));
        }
      }
    }

    const uniqSort = (arr)=>[...new Set(arr.map(v=>Math.round(v*1000)/1000))].sort((a,b)=>a-b);

    for(const z of d.levelsMm){
      if(subAlongX){
        const ys = uniqSort(yLines.length?yLines:[0,sizeYmm]);
        // joists run along Y, spaced in X within each bayX; length is between adjacent y-lines (beam/subbeam)
        for(let bayX=0; bayX<d.nx-1; bayX++){
          const x0 = d.xPosMm[bayX] || 0;
          const x1 = d.xPosMm[bayX+1] || 0;
          for(let xmm=x0+step; xmm < x1; xmm += step){
            for(let j=0; j<ys.length-1; j++){
              const segLenM = mmToM(ys[j+1]-ys[j]);
              add('Joist', profJ, segLenM);
            }
          }
        }
      } else {
        const xs = uniqSort(xLines.length?xLines:[0,sizeXmm]);
        // joists run along X, spaced in Y within each bayY; length between adjacent x-lines
        for(let bayY=0; bayY<d.ny-1; bayY++){
          const y0 = d.yPosMm[bayY] || 0;
          const y1 = d.yPosMm[bayY+1] || 0;
          for(let ymm=y0+step; ymm < y1; ymm += step){
            for(let j=0; j<xs.length-1; j++){
              const segLenM = mmToM(xs[j+1]-xs[j]);
              add('Joist', profJ, segLenM);
            }
          }
        }
      }
    }
  }

  // Braces
  if(braces.length){
    for(const br of braces){
      const prof = { shapeKey: br.shapeKey, sizeKey: br.sizeKey, name: br.name, kgm: br.kgm ?? null };
      const lenMm = (p,q)=>Math.sqrt((p.x-q.x)**2 + (p.y-q.y)**2 + (p.z-q.z)**2);
      if(br.kind==='X'){
        add('Brace', prof, mmToM(lenMm(br.a, br.b)));
        add('Brace', prof, mmToM(lenMm(br.c, br.d)));
      } else {
        const topMid = { x: (br.c.x+br.b.x)/2, y: (br.c.y+br.b.y)/2, z: br.c.z };
        add('Brace', prof, mmToM(lenMm(br.d, topMid)));
        add('Brace', prof, mmToM(lenMm(br.a, topMid)));
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
  clearGroup(state.bracePlaneGroup);
  clearGroup(state.braceGroup);

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

  function parseC(name){
    // Name like: "C 125x65x6x8"
    const m = String(name||'').match(/C\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);
    if(!m) return null;
    return { H: parseFloat(m[1]), B: parseFloat(m[2]), tw: parseFloat(m[3]), tf: parseFloat(m[4]) };
  }

  function parseL(name){
    // Name like: "L 75x75x6" (sometimes L 75x50x6)
    const m = String(name||'').match(/\bL\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);
    if(!m) return null;
    return { A: parseFloat(m[1]), B: parseFloat(m[2]), t: parseFloat(m[3]) };
  }

  function parseT(name){
    // Name like: "T 100x100x10x6" (H x B x tw x tf) (best-effort)
    const m = String(name||'').match(/\bT\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);
    if(!m) return null;
    return { H: parseFloat(m[1]), B: parseFloat(m[2]), tw: parseFloat(m[3]), tf: parseFloat(m[4]) };
  }

  function makeLGeomForBeamX(lenM, dim){
    const A = mmToM(dim.A);
    const B = mmToM(dim.B);
    const t = mmToM(dim.t);
    const leg1 = new THREE.BoxGeometry(lenM, t, A);
    leg1.translate(0, 0, (A/2 - t/2));
    const leg2 = new THREE.BoxGeometry(lenM, B, t);
    leg2.translate(0, (B/2 - t/2), 0);
    return mergeGeometries([leg1, leg2], false);
  }
  function makeLGeomForBeamY(lenM, dim){
    const g = makeLGeomForBeamX(lenM, dim);
    g.rotateY(Math.PI/2);
    return g;
  }
  function makeLGeomForColumn(heightM, dim){
    const A = mmToM(dim.A);
    const B = mmToM(dim.B);
    const t = mmToM(dim.t);
    const leg1 = new THREE.BoxGeometry(t, heightM, A);
    leg1.translate(-B/2 + t/2, 0, 0);
    const leg2 = new THREE.BoxGeometry(B, heightM, t);
    leg2.translate(0, 0, -A/2 + t/2);
    return mergeGeometries([leg1, leg2], false);
  }

  function makeTGeomForBeamX(lenM, dim){
    const B = mmToM(dim.B);
    const H = mmToM(dim.H);
    const tf = mmToM(dim.tf);
    const tw = mmToM(dim.tw);
    const flange = new THREE.BoxGeometry(lenM, tf, B);
    flange.translate(0, H/2 - tf/2, 0);
    const web = new THREE.BoxGeometry(lenM, Math.max(0.001, H - tf), Math.max(0.001, tw));
    web.translate(0, (H - tf)/2 - H/2, 0);
    return mergeGeometries([flange, web], false);
  }
  function makeTGeomForBeamY(lenM, dim){
    const g = makeTGeomForBeamX(lenM, dim);
    g.rotateY(Math.PI/2);
    return g;
  }
  function makeTGeomForColumn(heightM, dim){
    const B = mmToM(dim.B);
    const H = mmToM(dim.H);
    const tf = mmToM(dim.tf);
    const tw = mmToM(dim.tw);
    const flange = new THREE.BoxGeometry(B, heightM, tf);
    flange.translate(0, 0, H/2 - tf/2);
    const web = new THREE.BoxGeometry(Math.max(0.001, tw), heightM, Math.max(0.001, H - tf));
    web.translate(0, 0, (H - tf)/2 - H/2);
    return mergeGeometries([flange, web], false);
  }

  function makeCGeomForBeamX(lenM, dimMm){
    const B = mmToM(dimMm.B);
    const H = mmToM(dimMm.H);
    const tf = mmToM(dimMm.tf);
    const tw = mmToM(dimMm.tw);

    // C open side toward +Z (rough)
    const web = new THREE.BoxGeometry(lenM, Math.max(0.001, H - 2*tf), tw);
    web.translate(0, 0, -B/2 + tw/2);
    const top = new THREE.BoxGeometry(lenM, tf, B);
    top.translate(0, H/2 - tf/2, 0);
    const bot = new THREE.BoxGeometry(lenM, tf, B);
    bot.translate(0, -H/2 + tf/2, 0);
    return mergeGeometries([web, top, bot], false);
  }

  function makeCGeomForBeamY(lenM, dimMm){
    const g = makeCGeomForBeamX(lenM, dimMm);
    g.rotateY(Math.PI/2);
    return g;
  }

  function makeCGeomForColumn(heightM, dimMm){
    const B = mmToM(dimMm.B);
    const H = mmToM(dimMm.H);
    const tf = mmToM(dimMm.tf);
    const tw = mmToM(dimMm.tw);

    const web = new THREE.BoxGeometry(tw, heightM, Math.max(0.001, H - 2*tf));
    web.translate(0, 0, -B/2 + tw/2);
    const top = new THREE.BoxGeometry(B, heightM, tf);
    top.translate(0, 0, H/2 - tf/2);
    const bot = new THREE.BoxGeometry(B, heightM, tf);
    bot.translate(0, 0, -H/2 + tf/2);
    return mergeGeometries([web, top, bot], false);
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

  // materials (by role + selected)
  if(!state.matSelected) state.matSelected = new THREE.MeshStandardMaterial({ color: 0x3A6EA5, roughness: 0.75, metalness: 0.10, emissive: 0x0b2a4a, emissiveIntensity: 0.25 });
  if(!state.roleMats){
    state.roleMats = {
      col: new THREE.MeshStandardMaterial({ color: 0x4B5563, roughness: 0.9, metalness: 0.06 }),
      beam: new THREE.MeshStandardMaterial({ color: 0x6B7280, roughness: 0.88, metalness: 0.06 }),
      sub: new THREE.MeshStandardMaterial({ color: 0x8B5CF6, roughness: 0.85, metalness: 0.08 }),
      joist: new THREE.MeshStandardMaterial({ color: 0xF59E0B, roughness: 0.8, metalness: 0.08 }),
      brace: new THREE.MeshStandardMaterial({ color: 0x10B981, roughness: 0.82, metalness: 0.08 }),
      default: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.88, metalness: 0.05 }),
    };
  }
  const matFace = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.0, depthWrite: false });
  // Only show faces in brace mode
  if(state.bracePlaneGroup) state.bracePlaneGroup.visible = !!state.braceMode;

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
      const cdim = (prof.shapeKey === 'C') ? parseC(prof.name) : null;
      const ldim = (prof.shapeKey === 'L') ? parseL(prof.name) : null;
      const tdim = (prof.shapeKey === 'T') ? parseT(prof.name) : null;
      const geom = (dim && prof.shapeKey==='H')
        ? makeHGeomForColumn(h || 0.001, dim)
        : (cdim && prof.shapeKey==='C')
          ? makeCGeomForColumn(h || 0.001, cdim)
          : (ldim && prof.shapeKey==='L')
            ? makeLGeomForColumn(h || 0.001, ldim)
            : (tdim && prof.shapeKey==='T')
              ? makeTGeomForColumn(h || 0.001, tdim)
              : new THREE.BoxGeometry(b, h || 0.001, dd);
      const mesh = new THREE.Mesh(geom, state.roleMats.col);
      mesh.userData = { id, role: 'col', stdKey: prof.stdKey, shapeKey: prof.shapeKey, sizeKey: prof.sizeKey, name: prof.name, p0:{x, y, z:0}, p1:{x, y, z:d.heightMm} };
      mesh.position.copy(toV(x, y, d.heightMm / 2));
      state.memberGroup.add(mesh);
    }
  }

  // brace selectable faces (rectangles between grids and levels)
  // We create vertical faces for each bay segment between consecutive levels.
  const levels = [0, ...d.levelsMm];
  for(let li=0; li<levels.length-1; li++){
    const z0 = levels[li];
    const z1 = levels[li+1];

    // faces parallel to XZ at each Y gridline bay (between y[i]..y[i+1]) located at each y gridline? We'll do bay faces at fixed y for each row and each X span.
    for(let iy=0; iy<d.ny; iy++){
      const y = d.yPosMm[iy] || 0;
      for(let ix=0; ix<d.nx-1; ix++){
        const x0 = d.xPosMm[ix] || 0;
        const x1 = d.xPosMm[ix+1] || 0;
        // face on line y (between columns) spanning x0..x1 and z0..z1
        const w = mmToM(x1-x0);
        const hface = mmToM(z1-z0);
        const geom = new THREE.PlaneGeometry(w||0.001, hface||0.001);
        const m = matFace.clone();
        m.side = THREE.DoubleSide;
        const mesh = new THREE.Mesh(geom, m);
        // PlaneGeometry is XY (X span, Z span) and sits vertical with normal +Z (our grid-Y axis)
        mesh.position.copy(toV((x0+x1)/2, y, (z0+z1)/2));

        const faceKey = `F_Y_${iy}_${ix}_${z0}_${z1}`;
        // corners: bottom-left/right and top-left/right in the rectangle
        const p00 = { x: x0, y, z: z0 };
        const p10 = { x: x1, y, z: z0 };
        const p01 = { x: x0, y, z: z1 };
        const p11 = { x: x1, y, z: z1 };
        mesh.userData = { faceKey, corners: { a:p00, b:p11, c:p01, d:p10 } };
        state.bracePlaneGroup.add(mesh);
      }
    }

    // faces parallel to YZ at each X gridline
    for(let ix=0; ix<d.nx; ix++){
      const x = d.xPosMm[ix] || 0;
      for(let iy=0; iy<d.ny-1; iy++){
        const y0 = d.yPosMm[iy] || 0;
        const y1 = d.yPosMm[iy+1] || 0;
        const w = mmToM(y1-y0);
        const hface = mmToM(z1-z0);
        const geom = new THREE.PlaneGeometry(w||0.001, hface||0.001);
        const m = matFace.clone();
        m.side = THREE.DoubleSide;
        const mesh = new THREE.Mesh(geom, m);
        // rotate so plane spans Z (grid-Y) and Y (level)
        mesh.rotation.y = Math.PI/2;
        mesh.position.copy(toV(x, (y0+y1)/2, (z0+z1)/2));

        const faceKey = `F_X_${ix}_${iy}_${z0}_${z1}`;
        const p00 = { x, y: y0, z: z0 };
        const p10 = { x, y: y1, z: z0 };
        const p01 = { x, y: y0, z: z1 };
        const p11 = { x, y: y1, z: z1 };
        mesh.userData = { faceKey, corners: { a:p00, b:p11, c:p01, d:p10 } };
        state.bracePlaneGroup.add(mesh);
      }
    }

    // horizontal faces (grid cell at each level) - allows selecting faces at grid intersections
    for(let ix=0; ix<d.nx-1; ix++){
      const x0 = d.xPosMm[ix] || 0;
      const x1 = d.xPosMm[ix+1] || 0;
      for(let iy=0; iy<d.ny-1; iy++){
        const y0 = d.yPosMm[iy] || 0;
        const y1 = d.yPosMm[iy+1] || 0;
        const w = mmToM(x1-x0);
        const h = mmToM(y1-y0);
        const geom = new THREE.PlaneGeometry(w||0.001, h||0.001);
        const m = matFace.clone();
        m.side = THREE.DoubleSide;
        const mesh = new THREE.Mesh(geom, m);
        // PlaneGeometry XY => map to XZ by rotateX(-90deg)
        mesh.rotation.x = -Math.PI/2;
        mesh.position.copy(toV((x0+x1)/2, (y0+y1)/2, z1));

        const faceKey = `F_H_${ix}_${iy}_${z1}`;
        const p00 = { x: x0, y: y0, z: z1 };
        const p10 = { x: x1, y: y0, z: z1 };
        const p01 = { x: x0, y: y1, z: z1 };
        const p11 = { x: x1, y: y1, z: z1 };
        mesh.userData = { faceKey, corners: { a:p00, b:p11, c:p01, d:p10 } };
        state.bracePlaneGroup.add(mesh);
      }
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
        const cdim = (prof.shapeKey === 'C') ? parseC(prof.name) : null;
        const ldim = (prof.shapeKey === 'L') ? parseL(prof.name) : null;
        const tdim = (prof.shapeKey === 'T') ? parseT(prof.name) : null;
        const geom = (dim && prof.shapeKey==='H')
          ? makeHGeomForBeamX(len || 0.001, dim)
          : (cdim && prof.shapeKey==='C')
            ? makeCGeomForBeamX(len || 0.001, cdim)
            : (ldim && prof.shapeKey==='L')
              ? makeLGeomForBeamX(len || 0.001, ldim)
              : (tdim && prof.shapeKey==='T')
                ? makeTGeomForBeamX(len || 0.001, tdim)
                : new THREE.BoxGeometry(len || 0.001, dd, b);
        const mesh = new THREE.Mesh(geom, state.roleMats.beam);
        const y = d.yPosMm[iy] || 0;
        mesh.userData = { id, role: 'beam', stdKey: prof.stdKey, shapeKey: prof.shapeKey, sizeKey: prof.sizeKey, name: prof.name, p0:{x:x0, y, z}, p1:{x:x1, y, z} };
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
        const cdim = (prof.shapeKey === 'C') ? parseC(prof.name) : null;
        const ldim = (prof.shapeKey === 'L') ? parseL(prof.name) : null;
        const tdim = (prof.shapeKey === 'T') ? parseT(prof.name) : null;
        const geom = (dim && prof.shapeKey==='H')
          ? makeHGeomForBeamY(len || 0.001, dim)
          : (cdim && prof.shapeKey==='C')
            ? makeCGeomForBeamY(len || 0.001, cdim)
            : (ldim && prof.shapeKey==='L')
              ? makeLGeomForBeamY(len || 0.001, ldim)
              : (tdim && prof.shapeKey==='T')
                ? makeTGeomForBeamY(len || 0.001, tdim)
                : new THREE.BoxGeometry(b, dd, len || 0.001);
        const mesh = new THREE.Mesh(geom, state.roleMats.beam);
        const x = d.xPosMm[ix] || 0;
        mesh.userData = { id, role: 'beam', stdKey: prof.stdKey, shapeKey: prof.shapeKey, sizeKey: prof.sizeKey, name: prof.name, p0:{x, y:y0, z}, p1:{x, y:y1, z} };
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
              const mesh = new THREE.Mesh(geom, state.roleMats.sub);
              mesh.userData = { id, role: 'sub', stdKey: prof.stdKey, shapeKey: prof.shapeKey, sizeKey: prof.sizeKey, name: prof.name, p0:{x:x0, y, z}, p1:{x:x1, y, z} };
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
              const mesh = new THREE.Mesh(geom, state.roleMats.sub);
              mesh.userData = { id, role: 'sub', stdKey: prof.stdKey, shapeKey: prof.shapeKey, sizeKey: prof.sizeKey, name: prof.name, p0:{x, y:y0, z}, p1:{x, y:y1, z} };
              mesh.position.copy(toV(x, (y0+y1)/2, z - (dim?.H ?? 200)/2));
              state.memberGroup.add(mesh);
            }
          }
        }
      }
    }
  }

  // joists (700mm spacing, orthogonal to sub beam direction)
  if(d.joistEnabled){
    const data = (window.CIVILARCHI_STEEL_DATA && window.CIVILARCHI_STEEL_DATA.standards) || {};
    const stdKey = d.profileBeam.stdKey || 'KS';
    const cItems = data?.[stdKey]?.shapes?.['C']?.items || [];
    const c125 = cItems.find(it => /C\s*125x65x6x8/i.test(it.name)) || cItems[0] || null;
    const profJ = c125 ? { stdKey, shapeKey: 'C', sizeKey: c125.key, name: c125.name, kgm: c125.kgm ?? null } : { stdKey, shapeKey: 'C', sizeKey: 'C125', name: 'C 125x65x6x8', kgm: null };
    const cdim = parseC(profJ.name);

    const step = 700;
    const sizeXmm = d.xPosMm[d.xPosMm.length-1] || 0;
    const sizeYmm = d.yPosMm[d.yPosMm.length-1] || 0;

    // Sub beam direction was determined earlier as runSubAlongX
    // If sub beams run along X => joists run along Y (length in Z)
    for(const z of d.levelsMm){
      if(runSubAlongX){
        for(let bayX=0; bayX<d.nx-1; bayX++){
          const x0 = d.xPosMm[bayX] || 0;
          const x1 = d.xPosMm[bayX+1] || 0;
          for(let xmm=x0+step; xmm < x1; xmm += step){
            const len = mmToM(sizeYmm);
            const id = `JY_${z}_${bayX}_${xmm}`;
            const geom = (cdim && profJ.shapeKey==='C')
              ? makeCGeomForBeamY(len || 0.001, cdim)
              : new THREE.BoxGeometry(mmToM(65), mmToM(125), len || 0.001);
            const mesh = new THREE.Mesh(geom, state.roleMats.joist);
            mesh.userData = { id, role: 'joist', stdKey: profJ.stdKey, shapeKey: profJ.shapeKey, sizeKey: profJ.sizeKey, name: profJ.name, p0:{x:xmm, y:0, z}, p1:{x:xmm, y:sizeYmm, z} };
            // center in Y (grid) direction
            mesh.position.copy(toV(xmm, sizeYmm/2, z - (cdim?.H ?? 125)/2));
            state.memberGroup.add(mesh);
          }
        }
      } else {
        // sub beams run along Y => joists run along X (length in X)
        for(let bayY=0; bayY<d.ny-1; bayY++){
          const y0 = d.yPosMm[bayY] || 0;
          const y1 = d.yPosMm[bayY+1] || 0;
          for(let ymm=y0+step; ymm < y1; ymm += step){
            const len = mmToM(sizeXmm);
            const id = `JX_${z}_${bayY}_${ymm}`;
            const geom = (cdim && profJ.shapeKey==='C')
              ? makeCGeomForBeamX(len || 0.001, cdim)
              : new THREE.BoxGeometry(len || 0.001, mmToM(125), mmToM(65));
            const mesh = new THREE.Mesh(geom, state.roleMats.joist);
            mesh.userData = { id, role: 'joist', stdKey: profJ.stdKey, shapeKey: profJ.shapeKey, sizeKey: profJ.sizeKey, name: profJ.name, p0:{x:0, y:ymm, z}, p1:{x:sizeXmm, y:ymm, z} };
            mesh.position.copy(toV(sizeXmm/2, ymm, z - (cdim?.H ?? 125)/2));
            state.memberGroup.add(mesh);
          }
        }
      }
    }
  }

  // braces render
  const braceMat = state.roleMats.brace;
  function braceGeomAlongX(len, prof){
    const hdim = (prof.shapeKey==='H') ? parseH(prof.name) : null;
    const cdim = (prof.shapeKey==='C') ? parseC(prof.name) : null;
    const ldim = (prof.shapeKey==='L') ? parseL(prof.name) : null;
    const tdim = (prof.shapeKey==='T') ? parseT(prof.name) : null;

    if(hdim) return makeHGeomForBeamX(len||0.001, hdim);
    if(cdim) return makeCGeomForBeamX(len||0.001, cdim);
    if(ldim) return makeLGeomForBeamX(len||0.001, ldim);
    if(tdim) return makeTGeomForBeamX(len||0.001, tdim);

    const t = mmToM(10);
    return new THREE.BoxGeometry(len||0.001, t, t);
  }

  function addBraceMember(p0, p1, prof){
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const dz = p1.z - p0.z;
    const lenMm = Math.sqrt(dx*dx + dy*dy + dz*dz);
    const len = mmToM(lenMm);

    const geom = braceGeomAlongX(len, prof);
    const mesh = new THREE.Mesh(geom, braceMat);
    mesh.userData = { id: `BRM_${Math.random().toString(16).slice(2,6)}`, role:'brace', stdKey: prof.stdKey||'', shapeKey: prof.shapeKey||'', sizeKey: prof.sizeKey||'', name: prof.name||'', p0, p1 };
    // position mid
    mesh.position.copy(toV((p0.x+p1.x)/2, (p0.y+p1.y)/2, (p0.z+p1.z)/2));
    // orient along vector in world coords: our axes mapping is (x->X), (y->Z), (z->Y) in toV
    const v = new THREE.Vector3(mmToM(dx), mmToM(dz), mmToM(dy));
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1,0,0), v.clone().normalize());
    mesh.setRotationFromQuaternion(q);
    state.braceGroup.add(mesh);
    return lenMm;
  }

  for(const br of braces){
    const prof = { stdKey: br.stdKey, shapeKey: br.shapeKey, sizeKey: br.sizeKey, name: br.name, kgm: br.kgm ?? null };
    if(br.kind==='X'){
      addBraceMember(br.a, br.b, prof);
      addBraceMember(br.c, br.d, prof);
    } else {
      // chevron: bottom corners -> top mid
      const topMid = { x: (br.c.x+br.b.x)/2, y: (br.c.y+br.b.y)/2, z: br.c.z };
      addBraceMember(br.d, topMid, prof);
      addBraceMember(br.a, topMid, prof);
    }
  }

  // frame camera (only on first build / before user interaction)
  if(!state.__userMoved){
    const radius = mmToM(Math.max(sizeX, sizeY, d.heightMm)) * 0.9 + 2;
    state.camera.position.set(radius, radius * 0.85, radius);
    state.controls.target.set(0, mmToM(d.heightMm) * 0.45, 0);
    state.controls.update();
  }
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
  // brace uses same shape keys (we implement H/C/L/T visually)

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

  const braceShape = els.braceShape?.();
  const braceSize = els.braceSize?.();

  function rebuildAll(){
    rebuildShapeSelect(colShape);
    rebuildShapeSelect(beamShape);
    rebuildShapeSelect(subShape);
    braceShape && rebuildShapeSelect(braceShape);

    rebuildSizeSelect(colShape, colSize);
    rebuildSizeSelect(beamShape, beamSize);
    rebuildSizeSelect(subShape, subSize);
    braceShape && braceSize && rebuildSizeSelect(braceShape, braceSize);

    // default OFF
    if(!subEnable.value) subEnable.value = '0';
    if(!joistEnable.value) joistEnable.value = '0';

    // brace defaults
    if(braceShape && braceSize){
      if(!braceShape.value) braceShape.value = 'L';
    }
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

  // brace selectors may not exist (if DOM not loaded yet)
  const brShape = els.braceShape?.();
  const brSize = els.braceSize?.();
  const brType = els.braceType?.();
  brShape?.addEventListener('change', ()=>{ rebuildSizeSelect(brShape, brSize); state.braceProfile = getProfileFromSelectors(brShape, brSize); });
  brSize?.addEventListener('change', ()=>{ state.braceProfile = getProfileFromSelectors(brShape, brSize); });
  brType?.addEventListener('change', ()=>{ state.braceType = brType.value === 'S' ? 'S' : 'X'; });

  // initialize
  if(brShape && brSize) state.braceProfile = getProfileFromSelectors(brShape, brSize);
  if(brType) state.braceType = brType.value === 'S' ? 'S' : 'X';
}

function initBraceUI(){
  const btn = els.braceToggle();
  const panel = els.bracePanel();
  const exit = els.braceExit();
  const hint = els.braceHint();

  function renderBraceCount(){
    // keep hint updated with count (no big list UI)
    if(!hint) return;
    const n = braces.length;
    hint.textContent = `면에 마우스를 올리면 강조됩니다. 면을 클릭하면 브레이스가 ${n?`추가/삭제됩니다. (현재 ${n}개)`: '생성됩니다.'}`;
  }

  function setMode(on){
    state.braceMode = !!on;
    if(panel) panel.hidden = !state.braceMode;
    if(state.bracePlaneGroup) state.bracePlaneGroup.visible = state.braceMode;
    if(state.braceMode) renderBraceCount();
    else if(hint) hint.textContent = '';
  }

  btn && (btn.onclick = ()=>{
    setMode(!state.braceMode);
  });
  exit && (exit.onclick = ()=> setMode(false));

  // face click handler
  window.addEventListener('civilarchi:draft:braceFace', (e)=>{
    const face = e.detail;
    if(!face?.faceKey) return;

    // If braces exist on this face => delete them (requested)
    const before = braces.length;
    for(let i=braces.length-1; i>=0; i--){
      if(braces[i].faceKey === face.faceKey) braces.splice(i,1);
    }
    if(braces.length !== before){
      renderBraceCount();
      rebuild();
      return;
    }

    // else create
    const prof = state.braceProfile || getProfileBy('L','');
    const id = `BR_${Date.now()}_${Math.random().toString(16).slice(2,6)}`;
    const b = { id, faceKey: face.faceKey, kind: state.braceType, stdKey: prof.stdKey, shapeKey: prof.shapeKey, sizeKey: prof.sizeKey, name: prof.name || prof.sizeKey, kgm: prof.kgm ?? null, ...face.corners };
    braces.push(b);
    renderBraceCount();
    rebuild();
  });

  setMode(false);
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
  initBraceUI();
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

  // View home
  els.viewHome()?.addEventListener('click', ()=>{
    state.__userMoved = false;
    rebuild();
    state.__userMoved = true;
  });

  // Exports
  els.exportData()?.addEventListener('click', ()=>{
    const recs = collectMemberRecords();
    const header = ['id','role','std','shape','size','name','x0_mm','y0_mm','z0_mm','x1_mm','y1_mm','z1_mm','len_m'];
    const lines = [header.join(',')];
    for(const r of recs){
      lines.push([
        r.id,
        r.role,
        r.stdKey,
        r.shapeKey,
        r.sizeKey,
        (r.name||'').replaceAll(',', ' '),
        r.x0,
        r.y0,
        r.z0,
        r.x1,
        r.y1,
        r.z1,
        (r.lenMm/1000).toFixed(6),
      ].join(','));
    }
    downloadText('civilarchi-data.csv', lines.join('\n'));
  });

  els.exportStaad()?.addEventListener('click', ()=>{
    const recs = collectMemberRecords();
    // joints
    const keyOf = (x,y,z)=>`${x},${y},${z}`;
    const joints = new Map();
    let jn=1;
    const jointNum = (x,y,z)=>{
      const k = keyOf(x,y,z);
      if(!joints.has(k)) joints.set(k, jn++);
      return joints.get(k);
    };

    const members = [];
    let mn=1;
    for(const r of recs){
      const n1 = jointNum(r.x0, r.y0, r.z0);
      const n2 = jointNum(r.x1, r.y1, r.z1);
      members.push({ no: mn++, n1, n2, role:r.role, prof: r.name||r.sizeKey||r.shapeKey });
    }

    const out=[];
    out.push('STAAD SPACE');
    out.push('START JOB INFORMATION');
    out.push('ENGINEER DATE 05-Feb-2026');
    out.push('END JOB INFORMATION');
    out.push('UNIT METER KN');
    out.push('JOINT COORDINATES');
    for(const [k,no] of joints.entries()){
      const [x,y,z]=k.split(',').map(Number);
      out.push(`${no} ${ (x/1000).toFixed(6) } ${ (z/1000).toFixed(6) } ${ (y/1000).toFixed(6) }`);
    }
    out.push('MEMBER INCIDENCES');
    for(const m of members){
      out.push(`${m.no} ${m.n1} ${m.n2}`);
    }
    out.push('* NOTE: Member properties are not exported yet (geometry only).');
    out.push('FINISH');

    downloadText('civilarchi.staad.std', out.join('\n'));
  });

  els.exportIfc()?.addEventListener('click', ()=>{
    window.dispatchEvent(new CustomEvent('civilarchi:toast', { detail: 'IFC Export는 준비중입니다. (현재 STAAD/DATA만 지원)' }));
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
