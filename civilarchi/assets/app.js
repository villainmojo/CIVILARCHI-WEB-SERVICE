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

  function showView(view){
    for(const [k, el] of views.entries()){
      el.hidden = (k !== view);
    }
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
  const hbMsg = document.getElementById('hbMsg');
  const hbCopy = document.getElementById('hbCopy');

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

  function compute(){
    if(!hbKgm || !hbTotal) return;

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
      setMsg('선택한 규격/종류/사이즈의 단위중량(kg/m)을 찾지 못했습니다. “사용자 직접 입력(kg/m)”을 켜서 계산하거나, 엑셀 데이터/항목을 확인해주세요.');
      return;
    }

    const total = kgm * L;
    hbKgm.textContent = fmt(kgm, 3);
    hbTotal.textContent = fmt(total, 3);
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

    hbCopy?.addEventListener('click', async ()=>{
      const { stdKey, shapeKey, item } = getSelected();
      const L = Math.max(0, parseFloat(hbLength?.value || '0') || 0);
      const text = `CIVILARCHI 단위중량 계산\n- standard: ${stdKey || '-'}\n- shape: ${shapeKey || '-'}\n- size: ${item?.key || '-'}\n- length(m): ${L}\n- kg/m: ${hbKgm.textContent}\n- total(kg): ${hbTotal.textContent}`;
      try{
        await navigator.clipboard.writeText(text);
        setMsg('클립보드에 복사했습니다.');
        setTimeout(()=>compute(), 1200);
      }catch(e){
        setMsg('복사에 실패했습니다(브라우저 권한). 텍스트를 수동 복사해주세요.');
      }
    });
  }

  initSteelTool();
})();
