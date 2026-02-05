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

  // When switching to draft view, tell the module to (re)render.
  const _oldShowView = showView;
  function ensureDraftModule(){
    if(window.__civilarchiDraftLoaded) return;
    // Some clients may have cached HTML that referenced an older draft script.
    // Dynamically load the latest module as a fallback.
    const existing = document.querySelector('script[data-civilarchi-draft]');
    if(existing) return;
    const s = document.createElement('script');
    s.type = 'module';
    s.src = '/civilarchi/assets/draft.js?v=20260205_0306';
    s.setAttribute('data-civilarchi-draft','1');
    s.onload = ()=>{ window.__civilarchiDraftLoaded = true; };
    document.body.appendChild(s);
  }

  showView = function(view){
    _oldShowView(view);
    if(view === 'draft'){
      ensureDraftModule();
      window.dispatchEvent(new Event('civilarchi:draft:show'));
    }
  };

  // If the page loads directly into #draft
  if(currentViewFromHash() === 'draft'){
    setTimeout(()=>{
      ensureDraftModule();
      window.dispatchEvent(new Event('civilarchi:draft:show'));
    }, 30);
  }

  // Simple toast bridge for module scripts
  window.addEventListener('civilarchi:toast', (e)=>{
    const msg = e?.detail;
    if(typeof msg === 'string' && msg.trim()){
      setMsg(msg);
      setTimeout(()=>compute(), 1200);
    }
  });

  initSteelTool();
})();
