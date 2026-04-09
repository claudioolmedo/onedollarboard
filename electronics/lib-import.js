
'use strict';

(function() {

  
  const EASYEDA_API = 'https://easyeda.com/api/products';

  
  
  
  const EASYEDA_UNIT = 0.254; 

  
  const overlay     = document.getElementById('import-overlay');
  const inputEl     = document.getElementById('import-lcsc-input');
  const btnFetch    = document.getElementById('import-fetch');
  const btnSave     = document.getElementById('import-save');
  const btnCancel   = document.getElementById('import-cancel');
  const btnImport   = document.getElementById('btn-import');
  const progressEl  = document.getElementById('import-progress');
  const previewEl   = document.getElementById('import-preview');
  const prevName    = document.getElementById('import-prev-name');
  const prevPkg     = document.getElementById('import-prev-pkg');
  const prevMeta    = document.getElementById('import-prev-meta');
  const prevCanvas  = document.getElementById('import-prev-canvas');
  const libraryList = document.getElementById('library-list');

  let currentParsed = null; 

  
  function openImportModal() {
    overlay.classList.add('active');
    inputEl.value = '';
    inputEl.focus();
    progressEl.innerHTML = '';
    progressEl.classList.remove('active');
    previewEl.classList.remove('active');
    btnFetch.disabled = true;
    btnSave.style.display = 'none';
    currentParsed = null;
  }

  function closeImportModal() {
    overlay.classList.remove('active');
    currentParsed = null;
  }

  btnImport.addEventListener('click', openImportModal);
  btnCancel.addEventListener('click', closeImportModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeImportModal();
  });

  
  inputEl.addEventListener('input', () => {
    const v = inputEl.value.trim();
    btnFetch.disabled = !v;
    
    if (v && !v.startsWith('C') && !v.startsWith('c') && /^\d/.test(v)) {
      
    }
  });

  
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !btnFetch.disabled) {
      btnFetch.click();
    }
  });

  
  function logProgress(msg, type = '') {
    progressEl.classList.add('active');
    const cls = type === 'ok' ? 'log-ok' : type === 'err' ? 'log-err' : '';
    progressEl.innerHTML += `<div class="log-line ${cls}">${msg}</div>`;
    progressEl.scrollTop = progressEl.scrollHeight;
  }

  function clearProgress() {
    progressEl.innerHTML = '';
    progressEl.classList.remove('active');
  }

  
  async function fetchComponentData(partNum) {
    const directUrl = `${EASYEDA_API}/${partNum}/components?version=6.5.22`;

    
    if (window.location.protocol !== 'file:') {
      try {
        const proxyUrl = `/api/easyeda-proxy?lcsc=${encodeURIComponent(partNum)}`;
        logProgress('🔌 Using local proxy...');
        const resp = await fetch(proxyUrl);
        if (resp.ok) {
          const data = await resp.json();
          if (data.success) return data;
        }
      } catch (e) {  }
    }

    
    try {
      logProgress('🌐 Trying direct fetch...');
      const resp = await fetch(directUrl);
      if (resp.ok) {
        const data = await resp.json();
        if (data.success) return data;
      }
    } catch (e) {  }

    
    const proxies = [
      `https://api.allorigins.win/raw?url=${encodeURIComponent(directUrl)}`,
      `https://corsproxy.io/?${encodeURIComponent(directUrl)}`,
      `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(directUrl)}`,
    ];

    for (const proxyUrl of proxies) {
      try {
        logProgress('⚠️ Trying CORS proxy...');
        const resp = await fetch(proxyUrl);
        if (resp.ok) {
          const text = await resp.text();
          const data = JSON.parse(text);
          if (data.success) return data;
        }
      } catch (e) {  }
    }

    throw new Error(
      'Could not fetch component data. Please run the PCB editor via the dev server:\n' +
      '  npm run electronics\n' +
      'Then open http://localhost:3001/'
    );
  }

  async function fetchAndSaveComponent(partNum) {
    if (!partNum) return;
    partNum = partNum.trim().toUpperCase();
    if (!partNum.startsWith('C')) partNum = 'C' + partNum;

    try {
      const data = await fetchComponentData(partNum);
      if (!data.success || !data.result) throw new Error('Component not found');

      const result = data.result;
      const componentInfo = {
        lcsc: partNum,
        name: result.title,
        description: result.description || '',
        tags: result.tags || [],
        thumb: result.thumb ? 'https:' + result.thumb : '',
        manufacturer: result.dataStr?.head?.c_para?.Manufacturer || '',
        manufacturerPart: result.dataStr?.head?.c_para?.['Manufacturer Part'] || '',
        jlcpcbClass: result.dataStr?.head?.c_para?.['JLCPCB Part Class'] || '',
        package: result.dataStr?.head?.c_para?.package || '',
        prefix: result.dataStr?.head?.c_para?.pre || 'U?',
      };

      const pkg = result.packageDetail;
      if (!pkg || !pkg.dataStr || !pkg.dataStr.shape) throw new Error('No footprint data');

      componentInfo.packageName = pkg.title;
      componentInfo.footprint = parseEasyEDAFootprint(pkg.dataStr);
      
      if (typeof window.saveComponentToLibrary === 'function') {
        await window.saveComponentToLibrary(componentInfo);
      }
      return componentInfo;
    } catch (e) {
      console.error(`Fetch failed for ${partNum}:`, e);
      throw e;
    }
  }

  btnFetch.addEventListener('click', async () => {
    let partNum = inputEl.value.trim().toUpperCase();
    clearProgress();
    previewEl.classList.remove('active');
    btnSave.style.display = 'none';
    currentParsed = null;
    btnFetch.disabled = true;

    logProgress(`🔍 Fetching component ${partNum}...`);
    try {
      const info = await fetchAndSaveComponent(partNum);
      logProgress(`✅ Found and saved: ${info.name}`, 'ok');
      showPreview(info);
    } catch (error) {
      logProgress(`❌ Error: ${error.message}`, 'err');
    } finally {
      btnFetch.disabled = false;
    }
  });

  
  function parseEasyEDAFootprint(dataStr) {
    const shapes = dataStr.shape || [];
    const head = dataStr.head || {};
    const canvasStr = dataStr.canvas || '';

    
    let originX = head.x || 0;
    let originY = head.y || 0;

    const pads = [];
    const outlines = [];
    const holes = [];
    const tracks = [];

    shapes.forEach(shapeStr => {
      if (typeof shapeStr !== 'string') return;

      if (shapeStr.startsWith('PAD~')) {
        const pad = parsePad(shapeStr, originX, originY);
        if (pad) pads.push(pad);
      }
      else if (shapeStr.startsWith('HOLE~')) {
        const hole = parseHole(shapeStr, originX, originY);
        if (hole) holes.push(hole);
      }
      else if (shapeStr.startsWith('TRACK~')) {
        const track = parseTrack(shapeStr, originX, originY);
        if (track) tracks.push(track);
      }
      else if (shapeStr.startsWith('SOLIDREGION~99~')) {
        
        const outline = parseSolidRegion(shapeStr, originX, originY);
        if (outline) outlines.push(outline);
      }
      else if (shapeStr.startsWith('CIRCLE~')) {
        
        const circle = parseCircle(shapeStr, originX, originY);
        if (circle) outlines.push(circle);
      }
    });

    
    const allPts = [];
    pads.forEach(p => { allPts.push({x:p.cx, y:p.cy}); });
    holes.forEach(h => { allPts.push({x:h.x, y:h.y}); });

    if (allPts.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      allPts.forEach(p => {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      });
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;

      pads.forEach(p => { p.cx -= cx; p.cy -= cy; });
      holes.forEach(h => { h.x -= cx; h.y -= cy; });
      tracks.forEach(t => t.points.forEach(p => { p.x -= cx; p.y -= cy; }));
      outlines.forEach(o => {
        if (o.type === 'polygon') o.points.forEach(p => { p.x -= cx; p.y -= cy; });
        else if (o.type === 'circle') { o.cx -= cx; o.cy -= cy; }
      });
    }

    return { pads, outlines, holes, tracks };
  }

  function parsePad(str, ox, oy) {
    
    const parts = str.split('~');
    if (parts.length < 10) return null;

    const shape = parts[1]; 
    const cx = (parseFloat(parts[2]) - ox) * EASYEDA_UNIT;
    const cy = (parseFloat(parts[3]) - oy) * EASYEDA_UNIT;
    const w  = parseFloat(parts[4]) * EASYEDA_UNIT;
    const h  = parseFloat(parts[5]) * EASYEDA_UNIT;
    const layer = parseInt(parts[6]) || 1;
    const pin = parts[8] || '?';
    const rotation = parseFloat(parts[10]) || 0;

    
    let drill = 0;
    
    for (let i = 14; i < parts.length; i++) {
      const v = parseFloat(parts[i]);
      if (v > 0 && v < 5 && !isNaN(v)) {
        
        if (parts[i-1] === 'Y' || parts[i-1] === 'N') continue;
        
      }
    }

    
    const drillMatch = str.match(/~(\d+\.?\d*)~[\d.,]+$/);

    return {
      shape: shape === 'ELLIPSE' ? 'circle' : 'rect',
      cx, cy,
      w: Math.abs(w),
      h: Math.abs(h),
      pin,
      layer: layer === 1 ? 'F.Cu' : layer === 2 ? 'B.Cu' : layer === 11 ? 'F.Cu' : 'F.Cu',
      rotation,
      drill: 0, 
    };
  }

  function parseHole(str, ox, oy) {
    
    const parts = str.split('~');
    if (parts.length < 4) return null;
    return {
      x: (parseFloat(parts[1]) - ox) * EASYEDA_UNIT,
      y: (parseFloat(parts[2]) - oy) * EASYEDA_UNIT,
      drill: parseFloat(parts[3]) * EASYEDA_UNIT,
    };
  }

  function parseTrack(str, ox, oy) {
    
    const parts = str.split('~');
    if (parts.length < 5) return null;
    const width = parseFloat(parts[1]) * EASYEDA_UNIT;
    const layer = parseInt(parts[2]) || 1;
    const pointsStr = parts[4] || '';
    const nums = pointsStr.trim().split(/\s+/).map(parseFloat);
    const points = [];
    for (let i = 0; i < nums.length - 1; i += 2) {
      if (!isNaN(nums[i]) && !isNaN(nums[i+1])) {
        points.push({
          x: (nums[i] - ox) * EASYEDA_UNIT,
          y: (nums[i+1] - oy) * EASYEDA_UNIT,
        });
      }
    }
    return { width: Math.max(0.1, width), layer, points };
  }

  function parseSolidRegion(str, ox, oy) {
    
    const parts = str.split('~');
    if (parts.length < 4) return null;
    const pathData = parts[3] || '';
    const points = [];
    const coords = pathData.match(/[\d.]+/g);
    if (coords) {
      for (let i = 0; i < coords.length - 1; i += 2) {
        points.push({
          x: (parseFloat(coords[i]) - ox) * EASYEDA_UNIT,
          y: (parseFloat(coords[i+1]) - oy) * EASYEDA_UNIT,
        });
      }
    }
    return { type: 'polygon', points };
  }

  function parseCircle(str, ox, oy) {
    
    const parts = str.split('~');
    if (parts.length < 5) return null;
    return {
      type: 'circle',
      cx: (parseFloat(parts[1]) - ox) * EASYEDA_UNIT,
      cy: (parseFloat(parts[2]) - oy) * EASYEDA_UNIT,
      r: parseFloat(parts[3]) * EASYEDA_UNIT,
    };
  }

  
  function showPreview(info) {
    previewEl.classList.add('active');
    prevName.textContent = info.name;
    prevPkg.textContent = `📦 ${info.packageName} · LCSC: ${info.lcsc}`;
    prevMeta.textContent = `${info.manufacturer} · ${info.jlcpcbClass} · ${info.tags.join(', ')}`;

    const fp = info.footprint;
    const cvs = prevCanvas;
    const ctx = cvs.getContext('2d');
    const W = cvs.width, H = cvs.height;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#070b12';
    ctx.fillRect(0, 0, W, H);

    
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    fp.pads.forEach(p => {
      minX = Math.min(minX, p.cx - p.w/2); minY = Math.min(minY, p.cy - p.h/2);
      maxX = Math.max(maxX, p.cx + p.w/2); maxY = Math.max(maxY, p.cy + p.h/2);
    });
    fp.holes.forEach(h => {
      minX = Math.min(minX, h.x - h.drill/2); minY = Math.min(minY, h.y - h.drill/2);
      maxX = Math.max(maxX, h.x + h.drill/2); maxY = Math.max(maxY, h.y + h.drill/2);
    });
    fp.outlines.forEach(o => {
      if (o.type === 'polygon') o.points.forEach(p => {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      });
    });

    if (!isFinite(minX)) return;

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const margin = 20;
    const scale = Math.min((W - margin*2) / rangeX, (H - margin*2) / rangeY);
    const offX = W/2 - (minX + maxX)/2 * scale;
    const offY = H/2 - (minY + maxY)/2 * scale;

    const tx = (x) => x * scale + offX;
    const ty = (y) => y * scale + offY;

    
    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth = 1.5;
    fp.outlines.forEach(o => {
      if (o.type === 'polygon' && o.points.length > 2) {
        ctx.beginPath();
        ctx.moveTo(tx(o.points[0].x), ty(o.points[0].y));
        o.points.forEach(p => ctx.lineTo(tx(p.x), ty(p.y)));
        ctx.closePath();
        ctx.stroke();
      } else if (o.type === 'circle') {
        ctx.beginPath();
        ctx.arc(tx(o.cx), ty(o.cy), Math.abs(o.r * scale), 0, Math.PI * 2);
        ctx.stroke();
      }
    });

    
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    fp.tracks.forEach(t => {
      if (t.points.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(tx(t.points[0].x), ty(t.points[0].y));
      for (let i = 1; i < t.points.length; i++) {
        ctx.lineTo(tx(t.points[i].x), ty(t.points[i].y));
      }
      ctx.stroke();
    });

    
    fp.pads.forEach(p => {
      ctx.fillStyle = '#c83200';
      if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(tx(p.cx), ty(p.cy), Math.max(2, p.w/2 * scale), 0, Math.PI * 2);
        ctx.fill();
      } else {
        const pw = Math.max(3, p.w * scale);
        const ph = Math.max(3, p.h * scale);
        ctx.fillRect(tx(p.cx) - pw/2, ty(p.cy) - ph/2, pw, ph);
      }
      
      ctx.fillStyle = '#fff';
      ctx.font = '9px Inter';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.pin, tx(p.cx), ty(p.cy));
    });

    
    fp.holes.forEach(h => {
      ctx.beginPath();
      ctx.arc(tx(h.x), ty(h.y), Math.max(3, h.drill/2 * scale), 0, Math.PI * 2);
      ctx.fillStyle = '#888';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(tx(h.x), ty(h.y), Math.max(1.5, h.drill/4 * scale), 0, Math.PI * 2);
      ctx.fillStyle = '#070b12';
      ctx.fill();
    });
  }

  
  btnSave.addEventListener('click', async () => {
    if (!currentParsed) return;

    logProgress('💾 Saving to library...', '');
    btnSave.disabled = true;

    try {
      if (typeof window.saveComponentToLibrary === 'function') {
        await window.saveComponentToLibrary(currentParsed);
        logProgress('✅ Component saved to library!', 'ok');
        closeImportModal();
        renderLibrary();
      } else {
        
        const lib = JSON.parse(localStorage.getItem('odb_pcb_library') || '[]');
        currentParsed.importedAt = new Date().toISOString();
        lib.push(currentParsed);
        localStorage.setItem('odb_pcb_library', JSON.stringify(lib));
        logProgress('✅ Component saved to local library!', 'ok');
        closeImportModal();
        renderLibrary();
      }
    } catch (error) {
      logProgress(`❌ Save error: ${error.message}`, 'err');
    } finally {
      btnSave.disabled = false;
    }
  });

  
  function renderLibrary() {
    const lib = getLibrary();
    const sidebarList = document.getElementById('sidebar-library-list');
    if (!sidebarList) return;

    if (!lib.length) {
      sidebarList.innerHTML = '<div class="no-lib-msg">No parts.<br>Click <b>Import</b></div>';
      return;
    }

    sidebarList.innerHTML = lib.map((comp, i) => {
      const key = comp.lcsc || comp.name;
      return `
        <div class="sidebar-lib-item" data-lib-index="${i}" title="Place ${comp.name}" data-key="${key}">
          <div class="sidebar-lib-icon">📦</div>
          <div class="sidebar-lib-name">${comp.name}</div>
          <div class="sidebar-lib-del" data-key="${key}" title="Remove from Library">✕</div>
        </div>
      `;
    }).join('');

    
    sidebarList.querySelectorAll('.sidebar-lib-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('sidebar-lib-del')) return;
        const idx = parseInt(el.dataset.libIndex);
        selectLibraryComponent(idx);
      });
    });

    
    sidebarList.querySelectorAll('.sidebar-lib-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = btn.getAttribute('data-key');
        removeFromLibrary(key);
      });
    });
  }

  function getLibrary() {
    
    if (window._pcbLibrary && window._pcbLibrary.length) {
      return window._pcbLibrary;
    }
    try {
      return JSON.parse(localStorage.getItem('odb_pcb_library') || '[]');
    } catch(e) { return []; }
  }

  
  function confirmJS(title, msg, type = 'danger') {
    return new Promise((resolve) => {
      const modal  = document.getElementById('confirm-modal');
      const box    = modal?.querySelector('.confirm-box');
      const titleEl = document.getElementById('confirm-title');
      const msgEl   = document.getElementById('confirm-msg');
      const btnOk   = document.getElementById('confirm-ok');
      const btnCan  = document.getElementById('confirm-cancel');

      if (!modal || !titleEl || !msgEl || !btnOk || !btnCan) {
        
        resolve(confirm(`${title}\n\n${msg}`));
        return;
      }

      titleEl.innerText = title;
      msgEl.innerText   = msg;
      btnOk.className   = `confirm-btn ${type === 'danger' ? 'confirm-btn-ok' : 'confirm-btn-accent'}`;
      btnOk.innerText   = type === 'danger' ? 'Delete' : 'Confirm';

      modal.style.display = 'flex';

      const cleanup = (val) => {
        btnOk.removeEventListener('click', onOk);
        btnCan.removeEventListener('click', onCan);
        modal.style.display = 'none';
        resolve(val);
      };

      const onOk = () => cleanup(true);
      const onCan = () => cleanup(false);

      btnOk.addEventListener('click', onOk, { once: true });
      btnCan.addEventListener('click', onCan, { once: true });
    });
  }

  async function removeFromLibrary(key) {
    const lib = getLibrary();
    const comp = lib.find(c => (c.lcsc || c.name) === key);
    if (!comp) return;

    const confirmed = await confirmJS('Remove from Library?', `Are you sure you want to remove "${comp.name}"?`);
    if (!confirmed) return;

    if (comp === selectedLibComp) {
      selectedLibComp = null;
      if (typeof window.setTool === 'function') window.setTool('select');
    }

    if (typeof window.removeComponentFromLibrary === 'function') {
      window.removeComponentFromLibrary(key);
    } else {
      const newLib = lib.filter(c => (c.lcsc || c.name) !== key);
      localStorage.setItem('odb_pcb_library', JSON.stringify(newLib));
      if (window._pcbLibrary) window._pcbLibrary = newLib;
      renderLibrary();
    }
  }

  
  let selectedLibComp = null;

  function selectLibraryComponent(idx) {
    const lib = getLibrary();
    const comp = lib[idx];
    if (!comp) return;

    selectedLibComp = comp;

    
    const sidebarList = document.getElementById('sidebar-library-list');
    if (sidebarList) {
      sidebarList.querySelectorAll('.sidebar-lib-item').forEach(el => el.classList.remove('active'));
      const el = sidebarList.querySelector(`[data-lib-index="${idx}"]`);
      if (el) el.classList.add('active');
    }

    
    if (typeof window.setTool === 'function') {
      window.setTool('lib-place');
    }
    if (typeof window.setStatus === 'function') {
      window.setStatus(`📦 Click on canvas to place "${comp.name}"`);
    }
  }

  
  window.placeLibraryComponent = function(worldX, worldY) {
    if (!selectedLibComp || !selectedLibComp.footprint) return null;

    const fp = selectedLibComp.footprint;
    const elements = [];

    
    const grp = {
      type: 'group',
      compType: 'lib-' + selectedLibComp.lcsc,
      label: selectedLibComp.prefix || 'U?',
      value: selectedLibComp.name,
      lcsc: selectedLibComp.lcsc,
      x: worldX,
      y: worldY,
      children: [],
    };

    
    fp.pads.forEach(pad => {
      elements.push({
        type: 'pad',
        dx: pad.cx,
        dy: pad.cy,
        w: Math.max(0.3, pad.w),
        h: Math.max(0.3, pad.h),
        ref: pad.pin,
        shape: pad.shape,
      });
    });

    
    fp.holes.forEach(hole => {
      elements.push({
        type: 'hole',
        dx: hole.x,
        dy: hole.y,
        drill: Math.max(0.3, hole.drill),
      });
    });

    
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    fp.pads.forEach(p => {
      minX = Math.min(minX, p.cx - p.w/2); minY = Math.min(minY, p.cy - p.h/2);
      maxX = Math.max(maxX, p.cx + p.w/2); maxY = Math.max(maxY, p.cy + p.h/2);
    });
    fp.holes.forEach(h => {
      minX = Math.min(minX, h.x - h.drill/2); minY = Math.min(minY, h.y - h.drill/2);
      maxX = Math.max(maxX, h.x + h.drill/2); maxY = Math.max(maxY, h.y + h.drill/2);
    });
    fp.outlines.forEach(o => {
      if (o.type === 'polygon') o.points.forEach(p => {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      });
    });

    if (isFinite(minX)) {
      elements.push({
        type: 'rect',
        dx: (minX + maxX) / 2,
        dy: (minY + maxY) / 2,
        w: maxX - minX,
        h: maxY - minY,
        filled: false,
      });
    }

    
    elements.push({
      type: 'text',
      dx: 0,
      dy: isFinite(maxY) ? maxY + 1.5 : 3,
      text: selectedLibComp.prefix.replace('?','') + '?',
      size: 1.0,
    });

    return { group: grp, elements: elements };
  };

  
  window.renderLibrary = renderLibrary;
  window.openImportModal = openImportModal;
  window.getLibrary = getLibrary;
  window.fetchAndSaveComponent = fetchAndSaveComponent;

  
  document.addEventListener('DOMContentLoaded', () => {
    renderLibrary();
  });

  
  if (document.readyState !== 'loading') {
    renderLibrary();
  }

})();
