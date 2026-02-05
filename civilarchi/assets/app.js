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
  // H-beam tool (skeleton)
  // NOTE: Unit weight tables must be verified per standard.
  // ------------------------

  const STD = {
    // Placeholder minimal structure. We'll fill exact tables once you provide the official list/CSV.
    // key -> { label, sizes: [{key,label,kgm}] }
    'KR-KS(placeholder)': {
      label: 'KR · KS (placeholder)',
      sizes: [
        { key: 'H-300x300', label: 'H-300×300 (placeholder)', kgm: null },
        { key: 'H-400x200', label: 'H-400×200 (placeholder)', kgm: null },
      ]
    },
    'US-AISC(placeholder)': {
      label: 'US · AISC W-shape (placeholder)',
      sizes: [
        { key: 'W12x26', label: 'W12×26 (placeholder)', kgm: null },
      ]
    }
  };

  const hbStandard = document.getElementById('hbStandard');
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
    const stdKey = hbStandard?.value;
    const sizeKey = hbSize?.value;
    const std = STD[stdKey];
    const size = std?.sizes?.find(s => s.key === sizeKey) || null;
    return { stdKey, sizeKey, std, size };
  }

  function rebuildSizes(){
    if(!hbStandard || !hbSize) return;
    const stdKey = hbStandard.value;
    const std = STD[stdKey];

    hbSize.innerHTML = '';
    (std?.sizes || []).forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.key;
      opt.textContent = s.label;
      hbSize.appendChild(opt);
    });
  }

  function compute(){
    if(!hbKgm || !hbTotal) return;

    const L = Math.max(0, parseFloat(hbLength?.value || '0') || 0);
    const useCustom = !!hbUseCustom?.checked;

    const { stdKey, size } = getSelected();

    let kgm = null;
    if(useCustom){
      kgm = parseFloat(hbCustomKgm?.value || '')
      if(!Number.isFinite(kgm)) kgm = null;
    } else {
      kgm = size?.kgm ?? null;
    }

    if(kgm == null){
      hbKgm.textContent = '-';
      hbTotal.textContent = '-';
      setMsg('현재 선택한 규격/사이즈의 kg/m 테이블이 비어있습니다. 사용자 직접 입력(kg/m)을 켜거나, 정확한 표(CSV/리스트)를 주시면 반영하겠습니다.');
      return;
    }

    const total = kgm * L;
    hbKgm.textContent = fmt(kgm, 3);
    hbTotal.textContent = fmt(total, 3);
    setMsg('');
  }

  function initHBeam(){
    if(!hbStandard || !hbSize) return;

    hbStandard.innerHTML = '';
    Object.entries(STD).forEach(([key, v])=>{
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = v.label;
      hbStandard.appendChild(opt);
    });

    rebuildSizes();
    compute();

    hbStandard.addEventListener('change', ()=>{ rebuildSizes(); compute(); });
    hbSize.addEventListener('change', compute);
    hbLength.addEventListener('input', compute);

    hbUseCustom.addEventListener('change', ()=>{
      const on = !!hbUseCustom.checked;
      hbCustomWrap.hidden = !on;
      compute();
    });

    hbCustomKgm.addEventListener('input', compute);

    hbCopy?.addEventListener('click', async ()=>{
      const { stdKey, size } = getSelected();
      const L = Math.max(0, parseFloat(hbLength?.value || '0') || 0);
      const text = `CIVILARCHI H-beam\n- standard: ${stdKey}\n- size: ${size?.key || '-'}\n- length(m): ${L}\n- kg/m: ${hbKgm.textContent}\n- total(kg): ${hbTotal.textContent}`;
      try{
        await navigator.clipboard.writeText(text);
        setMsg('클립보드에 복사했습니다.');
        setTimeout(()=>compute(), 1200);
      }catch(e){
        setMsg('복사에 실패했습니다(브라우저 권한). 텍스트를 수동 복사해주세요.');
      }
    });
  }

  initHBeam();
})();
