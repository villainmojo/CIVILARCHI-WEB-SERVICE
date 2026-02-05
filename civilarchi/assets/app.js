(function(){
  const elBuild = document.getElementById('build');
  const elStatus = document.getElementById('status');

  const build = {
    deployedAt: new Date().toISOString(),
    path: location.pathname,
  };

  if(elBuild) elBuild.textContent = build.deployedAt;
  if(elStatus){
    elStatus.textContent = 'OK';
    elStatus.classList.remove('warn','fail');
    elStatus.classList.add('ok');
  }

  // ------------------------
  // Simple view router
  // ------------------------
  const views = new Map([...
    document.querySelectorAll('.view[data-view]')
  ].map(el => [el.getAttribute('data-view'), el]));

  const sbItems = [...document.querySelectorAll('.sb-item[data-view]')];

  function setActiveNav(view){
    sbItems.forEach(a => a.classList.toggle('active', a.getAttribute('data-view') === view));
  }

  function applyLayout(view){
    // Sidebar only for tool views
    document.body.setAttribute('data-view', view);
  }

  function showView(view){
    for(const [k, el] of views.entries()){
      el.hidden = (k !== view);
    }
    applyLayout(view);
    setActiveNav(view);
  }

  function currentViewFromHash(){
    const h = (location.hash || '').replace('#','').trim();
    if(!h) return 'home';
    if(views.has(h)) return h;
    return 'home';
  }

  window.addEventListener('hashchange', ()=> showView(currentViewFromHash()));

  document.addEventListener('click', (e)=>{
    const btn = e.target.closest('[data-goto]');
    if(!btn) return;
    const v = btn.getAttribute('data-goto');
    if(!v) return;
    location.hash = v;
  });

  showView(currentViewFromHash());

  // ------------------------
  // Steel unit-weight tool (from Excel)
  // Excel sheets include W column (kg/m)
  // ------------------------

  const RAW = (window.CIVILARCHI_STEEL_DATA && window.CIVILARCHI_STEEL_DATA.standards) || {};

  const STD_LABEL = {
    KS: 'KR · KS',
    JIS: 'JP · JIS',
  };

  const SHAPE_LABEL = {
    H: 'H-beam',
    C: 'C-channel',
    L: 'L-angle',
    LC: 'Lipped C',
    Rect: 'Rectangular tube',
    I: 'I-beam',
    T: 'T-bar',
  };

  const hbStandard = document.getElementById('hbStandard');
  const hbShape = document.getElementById('hbShape');
  const hbSize = document.getElementById('hbSize');
  const hbLength = document.getElementById('hbLength');
  const hbUseCustom = document.getElementById('hbUseCustom');
  const hbCustomWrap = document.getElementById('hbCustomWrap');
  const hbCustomKgm = document.getElementById('hbCustomKgm');

  const hbKgm = document.getElementById('hbKgm');
  const hbTotal = document.getElementById('hbTotal');
  const hbTotalTon = document.getElementById('hbTotalTon');
  const hbMsg = document.getElementById('hbMsg');
  const hbAdd = document.getElementById('hbAdd');
  const hbCopy = document.getElementById('hbCopy');

  const sumRowsEl = document.getElementById('sumRows');
  const sumKgEl = document.getElementById('sumKg');
  const sumTonEl = document.getElementById('sumTon');
  const sumCopy = document.getElementById('sumCopy');

  function fmt(n, digits=3){
    if(n == null || !Number.isFinite(n)) return '-';
    return n.toLocaleString('en-US', { maximumFractionDigits: digits });
  }

  function setMsg(text){
    if(!hbMsg) return;
    if(!text){ hbMsg.hidden = true; hbMsg.textContent=''; return; }
    hbMsg.hidden = false;
    hbMsg.textContent = text;
  }

  function getSelected(){
    const stdKey = hbStandard?.value || null;
    const shapeKey = hbShape?.value || null;
    const sizeKey = hbSize?.value || null;

    const shapes = (stdKey && RAW[stdKey] && RAW[stdKey].shapes) ? RAW[stdKey].shapes : {};
    const shape = (shapeKey && shapes && shapes[shapeKey]) ? shapes[shapeKey] : null;
    const items = shape?.items || [];
    const item = items.find(it => it.key === sizeKey) || null;

    return { stdKey, shapeKey, sizeKey, shape, item };
  }

  function rebuildStandards(){
    if(!hbStandard) return;
    hbStandard.innerHTML = '';

    const keys = Object.keys(RAW);
    // Prefer KS then JIS if present
    keys.sort((a,b)=>{
      const order = { KS: 0, JIS: 1 };
      return (order[a] ?? 99) - (order[b] ?? 99);
    });

    keys.forEach(k => {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = STD_LABEL[k] || k;
      hbStandard.appendChild(opt);
    });
  }

  function rebuildShapes(){
    if(!hbStandard || !hbShape) return;
    const stdKey = hbStandard.value;
    const shapes = RAW[stdKey]?.shapes || {};

    hbShape.innerHTML = '';
    const shapeKeys = Object.keys(shapes);
    shapeKeys.sort();

    shapeKeys.forEach(sk => {
      const opt = document.createElement('option');
      opt.value = sk;
      opt.textContent = SHAPE_LABEL[sk] ? `${SHAPE_LABEL[sk]} (${sk})` : sk;
      hbShape.appendChild(opt);
    });

    // default to H when available
    if(shapeKeys.includes('H')) hbShape.value = 'H';
  }

  function rebuildSizes(){
    if(!hbStandard || !hbShape || !hbSize) return;
    const stdKey = hbStandard.value;
    const shapeKey = hbShape.value;

    const items = RAW[stdKey]?.shapes?.[shapeKey]?.items || [];

    hbSize.innerHTML = '';
    items.forEach(it => {
      const opt = document.createElement('option');
      opt.value = it.key;
      const suffix = (it.kgm != null && Number.isFinite(it.kgm)) ? ` · ${fmt(it.kgm, 3)} kg/m` : '';
      opt.textContent = `${it.name}${suffix}`;
      hbSize.appendChild(opt);
    });
  }

  // ------------------------
  // Sum list
  // ------------------------
  /** @type {Array<{id:string,stdKey:string,shapeKey:string,sizeKey:string,name:string,kgm:number,length:number}>} */
  const sumList = [];

  function recalcSum(){
    if(!sumKgEl || !sumTonEl) return;
    let kg = 0;
    for(const it of sumList){
      if(Number.isFinite(it.kgm) && Number.isFinite(it.length)) kg += it.kgm * it.length;
    }
    sumKgEl.textContent = fmt(kg, 3);
    sumTonEl.textContent = fmt(kg/1000, 6);
  }

  function renderSum(){
    if(!sumRowsEl) return;
    sumRowsEl.innerHTML = '';

    for(const it of sumList){
      const tr = document.createElement('tr');
      const totalKg = it.kgm * it.length;
      const totalTon = totalKg / 1000;

      tr.innerHTML = `
        <td>${STD_LABEL[it.stdKey] || it.stdKey}</td>
        <td>${SHAPE_LABEL[it.shapeKey] || it.shapeKey}</td>
        <td class="mono">${it.name}</td>
        <td class="right mono">${fmt(it.kgm, 3)}</td>
        <td class="right">
          <input class="sum-len" type="number" inputmode="decimal" min="0" step="0.1" value="${it.length}" data-id="${it.id}" />
        </td>
        <td class="right mono">${fmt(totalKg, 3)}</td>
        <td class="right mono">${fmt(totalTon, 6)}</td>
        <td class="right"><button class="mini-btn" data-sum-remove="${it.id}">삭제</button></td>
      `;

      sumRowsEl.appendChild(tr);
    }

    recalcSum();
  }

  function sumToTSV(){
    const header = ['standard','shape','size','kg_per_m','length_m','total_kg','total_ton'];
    const rows = [header.join('\t')];
    for(const it of sumList){
      const totalKg = it.kgm * it.length;
      const totalTon = totalKg / 1000;
      rows.push([
        (STD_LABEL[it.stdKey] || it.stdKey),
        (SHAPE_LABEL[it.shapeKey] || it.shapeKey),
        it.name,
        String(it.kgm),
        String(it.length),
        String(totalKg),
        String(totalTon),
      ].join('\t'));
    }
    // totals row
    const sumKg = sumKgEl?.textContent || '';
    const sumTon = sumTonEl?.textContent || '';
    rows.push(['TOTAL','','','', '', sumKg, sumTon].join('\t'));
    return rows.join('\n');
  }

  async function copySumToClipboard(){
    if(sumList.length === 0){
      setMsg('합산 목록이 비어있습니다.');
      return;
    }
    const tsv = sumToTSV();
    try{
      await navigator.clipboard.writeText(tsv);
      setMsg('합산 표를 클립보드에 복사했습니다. 엑셀에 붙여넣기(Ctrl+V) 하세요.');
      setTimeout(()=>compute(), 1400);
    }catch(e){
      setMsg('복사에 실패했습니다(브라우저 권한).');
    }
  }

  function addToSum(){
    const L = Math.max(0, parseFloat(hbLength?.value || '0') || 0);
    const useCustom = !!hbUseCustom?.checked;
    const { stdKey, shapeKey, item } = getSelected();

    let kgm = null;
    if(useCustom){
      kgm = parseFloat(hbCustomKgm?.value || '');
      if(!Number.isFinite(kgm)) kgm = null;
    } else {
      kgm = item?.kgm ?? null;
    }

    if(!stdKey || !shapeKey || !item?.key){
      setMsg('합산 추가 실패: 선택값이 비어있습니다.');
      return;
    }
    if(kgm == null){
      setMsg('합산 추가 실패: kg/m 값을 찾지 못했습니다.');
      return;
    }

    sumList.push({
      id: Math.random().toString(16).slice(2) + Date.now().toString(16),
      stdKey,
      shapeKey,
      sizeKey: item.key,
      name: item.name,
      kgm,
      length: L,
    });

    setMsg('합산에 추가했습니다.');
    renderSum();
    setTimeout(()=>compute(), 900);
  }

  function compute(){
    if(!hbKgm || !hbTotal || !hbTotalTon) return;

    const L = Math.max(0, parseFloat(hbLength?.value || '0') || 0);
    const useCustom = !!hbUseCustom?.checked;

    const { stdKey, shapeKey, item } = getSelected();

    let kgm = null;
    if(useCustom){
      kgm = parseFloat(hbCustomKgm?.value || '');
      if(!Number.isFinite(kgm)) kgm = null;
    } else {
      kgm = item?.kgm ?? null;
    }

    if(kgm == null){
      hbKgm.textContent = '-';
      hbTotal.textContent = '-';
      hbTotalTon.textContent = '-';
      setMsg('선택한 규격/종류/사이즈의 단위중량(kg/m)을 찾지 못했습니다. “사용자 직접 입력(kg/m)”을 켜서 계산하거나, 엑셀 데이터/항목을 확인해주세요.');
      return;
    }

    const totalKg = kgm * L;
    const totalTon = totalKg / 1000;

    hbKgm.textContent = fmt(kgm, 3);
    hbTotal.textContent = fmt(totalKg, 3);
    hbTotalTon.textContent = fmt(totalTon, 6);
    setMsg('');
  }

  function initSteelTool(){
    if(!hbStandard || !hbShape || !hbSize) return;

    rebuildStandards();
    rebuildShapes();
    rebuildSizes();
    compute();

    hbStandard.addEventListener('change', ()=>{
      rebuildShapes();
      rebuildSizes();
      compute();
    });
    hbShape.addEventListener('change', ()=>{
      rebuildSizes();
      compute();
    });
    hbSize.addEventListener('change', compute);
    hbLength.addEventListener('input', compute);

    hbUseCustom.addEventListener('change', ()=>{
      const on = !!hbUseCustom.checked;
      hbCustomWrap.hidden = !on;
      compute();
    });

    hbCustomKgm.addEventListener('input', compute);

    hbAdd?.addEventListener('click', addToSum);
    sumCopy?.addEventListener('click', copySumToClipboard);

    // Sum interactions (length edit / remove)
    sumRowsEl?.addEventListener('input', (e)=>{
      const inp = e.target.closest('input.sum-len');
      if(!inp) return;
      const id = inp.getAttribute('data-id');
      const v = Math.max(0, parseFloat(inp.value || '0') || 0);
      const it = sumList.find(x => x.id === id);
      if(!it) return;
      it.length = v;
      renderSum();
    });

    sumRowsEl?.addEventListener('click', (e)=>{
      const btn = e.target.closest('[data-sum-remove]');
      if(!btn) return;
      const id = btn.getAttribute('data-sum-remove');
      const idx = sumList.findIndex(x => x.id === id);
      if(idx >= 0){
        sumList.splice(idx,1);
        renderSum();
      }
    });

    hbCopy?.addEventListener('click', async ()=>{
      const { stdKey, shapeKey, item } = getSelected();
      const L = Math.max(0, parseFloat(hbLength?.value || '0') || 0);
      const text = `CIVILARCHI STEEL MEMBER 하중 계산\n- standard: ${stdKey || '-'}\n- shape: ${shapeKey || '-'}\n- size: ${item?.key || '-'}\n- length(m): ${L}\n- kg/m: ${hbKgm.textContent}\n- total(kg): ${hbTotal.textContent}\n- total(ton): ${hbTotalTon.textContent}\n\n[SUM]\n- sum(kg): ${sumKgEl?.textContent || '-'}\n- sum(ton): ${sumTonEl?.textContent || '-'}`;
      try{
        await navigator.clipboard.writeText(text);
        setMsg('클립보드에 복사했습니다.');
        setTimeout(()=>compute(), 1200);
      }catch(e){
        setMsg('복사에 실패했습니다(브라우저 권한). 텍스트를 수동 복사해주세요.');
      }
    });
  }

  // ------------------------
  // Draft (Three.js)
  // ------------------------

  const dr = {
    inited: false,
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    root: null,
    gridGroup: null,
    memberGroup: null,
  };

  const drCanvas = document.getElementById('drCanvas');
  const drGridX = document.getElementById('drGridX');
  const drGridY = document.getElementById('drGridY');
  const drSpacingX = document.getElementById('drSpacingX');
  const drSpacingY = document.getElementById('drSpacingY');
  const drLevels = document.getElementById('drLevels');
  const drAddLevel = document.getElementById('drAddLevel');
  const drCopy = document.getElementById('drCopy');

  const drColCount = document.getElementById('drColCount');
  const drColLenM = document.getElementById('drColLenM');
  const drBeamCount = document.getElementById('drBeamCount');
  const drBeamLenM = document.getElementById('drBeamLenM');
  const drTotalLenM = document.getElementById('drTotalLenM');

  function mmToM(mm){ return mm / 1000; }

  function getLevelHeightsMm(){
    const inputs = [...(drLevels?.querySelectorAll('input[data-level]') || [])];
    const vals = inputs.map(i => Math.max(0, parseFloat(i.value||'0')||0));
    return vals;
  }

  function renderLevels(){
    if(!drLevels) return;
    const heights = getLevelHeightsMm();
    if(heights.length === 0){
      drLevels.innerHTML = '';
      return;
    }
    // keep existing order/values
    drLevels.innerHTML = '';
    heights.forEach((h, idx)=>{
      const row = document.createElement('div');
      row.style.display = 'grid';
      row.style.gridTemplateColumns = '1fr auto';
      row.style.gap = '10px';
      row.style.alignItems = 'end';
      row.innerHTML = `
        <label style="margin:0">
          <span>Level ${idx+1} 높이 (mm)</span>
          <input data-level="${idx}" type="number" min="0" step="1" value="${h}" />
        </label>
        <button class="mini-btn" data-level-del="${idx}">삭제</button>
      `;
      drLevels.appendChild(row);
    });
  }

  function initLevels(){
    if(!drLevels) return;
    // default levels
    drLevels.innerHTML = `
      <label><span>Level 1 높이 (mm)</span><input data-level="0" type="number" min="0" step="1" value="4200" /></label>
      <label><span>Level 2 높이 (mm)</span><input data-level="1" type="number" min="0" step="1" value="4200" /></label>
    `;

    drAddLevel?.addEventListener('click', ()=>{
      const hs = getLevelHeightsMm();
      hs.push(4200);
      // rebuild
      drLevels.innerHTML = '';
      hs.forEach((h, idx)=>{
        const lab = document.createElement('label');
        lab.innerHTML = `<span>Level ${idx+1} 높이 (mm)</span><input data-level="${idx}" type="number" min="0" step="1" value="${h}" />`;
        drLevels.appendChild(lab);
      });
      // convert to rich rows
      renderLevels();
      rebuildDraft();
    });

    drLevels.addEventListener('input', (e)=>{
      if(e.target && e.target.matches('input[data-level]')) rebuildDraft();
    });

    drLevels.addEventListener('click', (e)=>{
      const btn = e.target.closest('[data-level-del]');
      if(!btn) return;
      const idx = parseInt(btn.getAttribute('data-level-del'), 10);
      const hs = getLevelHeightsMm().filter((_,i)=> i !== idx);
      // rebuild
      drLevels.innerHTML = '';
      hs.forEach((h, i)=>{
        const lab = document.createElement('label');
        lab.innerHTML = `<span>Level ${i+1} 높이 (mm)</span><input data-level="${i}" type="number" min="0" step="1" value="${h}" />`;
        drLevels.appendChild(lab);
      });
      renderLevels();
      rebuildDraft();
    });

    renderLevels();
  }

  function initThree(){
    if(dr.inited) return;
    if(!drCanvas || !window.THREE) return;

    const THREE = window.THREE;

    dr.scene = new THREE.Scene();
    dr.scene.background = new THREE.Color(0xffffff);

    dr.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    dr.camera.position.set(8, 8, 8);

    dr.renderer = new THREE.WebGLRenderer({ antialias: true });
    dr.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    drCanvas.innerHTML = '';
    drCanvas.appendChild(dr.renderer.domElement);

    const light1 = new THREE.DirectionalLight(0xffffff, 0.9);
    light1.position.set(10, 20, 10);
    dr.scene.add(light1);
    dr.scene.add(new THREE.AmbientLight(0xffffff, 0.55));

    dr.controls = new THREE.OrbitControls(dr.camera, dr.renderer.domElement);
    dr.controls.enableDamping = true;

    dr.root = new THREE.Group();
    dr.scene.add(dr.root);

    dr.gridGroup = new THREE.Group();
    dr.memberGroup = new THREE.Group();
    dr.root.add(dr.gridGroup);
    dr.root.add(dr.memberGroup);

    function resize(){
      const rect = drCanvas.getBoundingClientRect();
      const w = Math.max(10, rect.width);
      const h = Math.max(10, rect.height);
      dr.camera.aspect = w / h;
      dr.camera.updateProjectionMatrix();
      dr.renderer.setSize(w, h);
    }
    window.addEventListener('resize', resize);
    resize();

    function tick(){
      requestAnimationFrame(tick);
      dr.controls?.update();
      dr.renderer.render(dr.scene, dr.camera);
    }
    tick();

    dr.inited = true;
  }

  function clearGroup(g){
    if(!g) return;
    while(g.children.length){
      const c = g.children.pop();
      g.remove(c);
    }
  }

  function calcDraft(){
    const nx = Math.max(1, parseInt(drGridX?.value || '1', 10) || 1);
    const ny = Math.max(1, parseInt(drGridY?.value || '1', 10) || 1);
    const sx = Math.max(1, parseFloat(drSpacingX?.value || '1') || 1);
    const sy = Math.max(1, parseFloat(drSpacingY?.value || '1') || 1);
    const levels = getLevelHeightsMm().filter(v => v > 0);
    const heightMm = levels.reduce((a,b)=>a+b,0);

    const colCount = nx * ny;
    const colLenMm = colCount * heightMm;

    // beams at each level (excluding base at 0)
    const beamLevels = levels.length;
    const beamCountPerLevel = (ny * Math.max(0, nx-1)) + (nx * Math.max(0, ny-1));
    const beamCount = beamLevels * beamCountPerLevel;

    const beamLenPerLevelMm = (ny * Math.max(0, nx-1) * sx) + (nx * Math.max(0, ny-1) * sy);
    const beamLenMm = beamLevels * beamLenPerLevelMm;

    return { nx, ny, sx, sy, levels, heightMm, colCount, colLenMm, beamCount, beamLenMm };
  }

  function rebuildDraft(){
    if(!drCanvas) return;
    initThree();
    const THREE = window.THREE;
    if(!dr.inited || !THREE) return;

    const d = calcDraft();

    // stats
    drColCount.textContent = String(d.colCount);
    drColLenM.textContent = fmt(mmToM(d.colLenMm), 3);
    drBeamCount.textContent = String(d.beamCount);
    drBeamLenM.textContent = fmt(mmToM(d.beamLenMm), 3);
    drTotalLenM.textContent = fmt(mmToM(d.colLenMm + d.beamLenMm), 3);

    clearGroup(dr.gridGroup);
    clearGroup(dr.memberGroup);

    // center model
    const sizeX = (d.nx-1) * d.sx;
    const sizeY = (d.ny-1) * d.sy;
    const cx = sizeX/2;
    const cy = sizeY/2;

    // grid lines (on base)
    const gridMat = new THREE.LineBasicMaterial({ color: 0x3A6EA5, transparent: true, opacity: 0.35 });
    const toV = (xmm, ymm, zmm)=> new THREE.Vector3(mmToM(xmm-cx), mmToM(zmm), mmToM(ymm-cy));

    for(let ix=0; ix<d.nx; ix++){
      const x = ix*d.sx;
      const geom = new THREE.BufferGeometry().setFromPoints([toV(x,0,0), toV(x,sizeY,0)]);
      dr.gridGroup.add(new THREE.Line(geom, gridMat));
    }
    for(let iy=0; iy<d.ny; iy++){
      const y = iy*d.sy;
      const geom = new THREE.BufferGeometry().setFromPoints([toV(0,y,0), toV(sizeX,y,0)]);
      dr.gridGroup.add(new THREE.Line(geom, gridMat));
    }

    // members (simple box as placeholder)
    const colMat = new THREE.MeshStandardMaterial({ color: 0x1F2A44, roughness: 0.8, metalness: 0.15 });
    const beamMat = new THREE.MeshStandardMaterial({ color: 0x2E2E2E, roughness: 0.85, metalness: 0.05 });

    const colW = mmToM(200); // 200mm schematic
    const beamW = mmToM(180);
    const beamH = mmToM(220);

    // columns
    const h = mmToM(d.heightMm);
    const colGeom = new THREE.BoxGeometry(colW, h, colW);
    for(let ix=0; ix<d.nx; ix++){
      for(let iy=0; iy<d.ny; iy++){
        const x = ix*d.sx;
        const y = iy*d.sy;
        const mesh = new THREE.Mesh(colGeom, colMat);
        mesh.position.copy(toV(x,y, d.heightMm/2));
        dr.memberGroup.add(mesh);
      }
    }

    // beams per level
    let zAcc = 0;
    for(const lvl of d.levels){
      zAcc += lvl;
      const z = zAcc;

      // X direction beams
      for(let iy=0; iy<d.ny; iy++){
        for(let ix=0; ix<d.nx-1; ix++){
          const x0 = ix*d.sx;
          const x1 = (ix+1)*d.sx;
          const len = mmToM(x1-x0);
          const geom = new THREE.BoxGeometry(len, beamH, beamW);
          const mesh = new THREE.Mesh(geom, beamMat);
          mesh.position.copy(toV((x0+x1)/2, iy*d.sy, z));
          dr.memberGroup.add(mesh);
        }
      }

      // Y direction beams
      for(let ix=0; ix<d.nx; ix++){
        for(let iy=0; iy<d.ny-1; iy++){
          const y0 = iy*d.sy;
          const y1 = (iy+1)*d.sy;
          const len = mmToM(y1-y0);
          const geom = new THREE.BoxGeometry(beamW, beamH, len);
          const mesh = new THREE.Mesh(geom, beamMat);
          mesh.position.copy(toV(ix*d.sx, (y0+y1)/2, z));
          dr.memberGroup.add(mesh);
        }
      }
    }

    // frame camera
    const radius = mmToM(Math.max(sizeX, sizeY, d.heightMm)) * 0.9 + 2;
    dr.camera.position.set(radius, radius*0.85, radius);
    dr.controls.target.set(0, mmToM(d.heightMm)*0.45, 0);
    dr.controls.update();
  }

  async function copyDraftToClipboard(){
    const d = calcDraft();
    const lines = [];
    lines.push(['type','count','total_length_m'].join('\t'));
    lines.push(['COLUMN', String(d.colCount), String(mmToM(d.colLenMm))].join('\t'));
    lines.push(['BEAM', String(d.beamCount), String(mmToM(d.beamLenMm))].join('\t'));
    lines.push(['TOTAL', '', String(mmToM(d.colLenMm + d.beamLenMm))].join('\t'));
    const tsv = lines.join('\n');
    try{
      await navigator.clipboard.writeText(tsv);
      setMsg('DRAFT 물량(길이) 표를 클립보드에 복사했습니다. 엑셀에 붙여넣기 하세요.');
      setTimeout(()=>compute(), 1400);
    }catch(e){
      setMsg('복사에 실패했습니다(브라우저 권한).');
    }
  }

  function initDraftUI(){
    if(!drCanvas) return;
    initLevels();

    [drGridX, drGridY, drSpacingX, drSpacingY].forEach(el=>{
      el?.addEventListener('input', rebuildDraft);
    });

    drCopy?.addEventListener('click', copyDraftToClipboard);

    // build once
    rebuildDraft();
  }

  // When switching to draft view, ensure it is initialized.
  // (router calls showView which sets body[data-view])
  const _oldShowView = showView;
  showView = function(view){
    _oldShowView(view);
    if(view === 'draft'){
      // defer to allow DOM layout
      setTimeout(()=>{
        if(!dr.inited) initDraftUI();
        else rebuildDraft();
      }, 30);
    }
  };

  // If the page loads directly into #draft
  if(currentViewFromHash() === 'draft'){
    setTimeout(()=>{ if(!dr.inited) initDraftUI(); else rebuildDraft(); }, 30);
  }

  initSteelTool();
})();
