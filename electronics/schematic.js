
'use strict';

(function () {

  const sch = {
    visible: false,
    components: [],   
    nextId: 1,
    zoom: 1.0,
    panX: 0,
    panY: 0,
    dragging: null,   
    mouse: { x: 0, y: 0 },
    dirty: false,
    tool: 'label',
    highlightNet: null, 
  };

  const panel       = document.getElementById('schematic-panel');
  const cvs         = document.getElementById('sch-canvas');
  const ctx         = cvs.getContext('2d');
  const btnSch      = document.getElementById('btn-schematic');
  const btnClose    = document.getElementById('btn-sch-close');
  const btnSchSave  = document.getElementById('btn-sch-save');
  const btnSchClear = document.getElementById('btn-sch-clear');
  const btnSchLabel = document.getElementById('btn-sch-label');
  const cmdInput    = document.getElementById('sch-command-input');
  const labelModal = document.getElementById('label-modal');
  const labelInput = document.getElementById('label-input');
  const labelOk    = document.getElementById('label-ok');
  const labelCancel= document.getElementById('label-cancel');
  const labelDelete= document.getElementById('label-delete');
  const globalAiHelpBtn = document.getElementById('btnAIHelp');

  if (!panel || !cvs) return;

  btnSch?.addEventListener('click', () => toggleSchematic(!sch.visible));
  btnClose?.addEventListener('click', () => toggleSchematic(false));

  function toggleSchematic(show) {
    sch.visible = show;
    panel.style.display = show ? 'flex' : 'none';

    if (btnSch) {
      if (show) {
        btnSch.innerHTML = '🔳 PCB Editor';
        btnSch.title = 'Back to PCB Editor';
      } else {
        btnSch.innerHTML = '📐 Schematic';
        btnSch.title = 'Open Schematic View';
      }
    }

    if (show) {
      resizeCvs();
      populateFromLibrary();
      render();
    }
  }

  function resizeCvs() {
    cvs.width  = cvs.parentElement.clientWidth  || 900;
    cvs.height = cvs.parentElement.clientHeight || 600;
  }
  window.addEventListener('resize', () => { if (sch.visible) { resizeCvs(); render(); } });

  function populateFromLibrary() {
    const lib = (typeof window.getLibrary === 'function') ? window.getLibrary() : [];
    lib.forEach(comp => {
      const exists = sch.components.find(c => c.libId === comp.lcsc + '_' + comp.name);
      if (!exists) {
        addSchComponent(comp, 80 + sch.components.length * 140, 100);
      }
    });
  }

  function addSchComponent(comp, x, y) {
    const fp = comp.footprint;
    const pins = fp ? fp.pads.map(p => ({ pin: p.pin, label: p.pin })) : [];
    sch.components.push({
      id: sch.nextId++,
      libId: comp.lcsc + '_' + comp.name,
      lcsc: comp.lcsc,
      name: comp.name,
      prefix: (comp.prefix || 'U').replace('?', ''),
      ref: (comp.prefix || 'U').replace('?', '') + '?',
      x, y,
      w: 120,
      h: Math.max(60, pins.length * 18 + 30),
      pins,
    });
    sch.dirty = true;
  }

  const toScreen = (wx, wy) => ({
    x: wx * sch.zoom + sch.panX,
    y: wy * sch.zoom + sch.panY,
  });
  const toWorld = (sx, sy) => ({
    x: (sx - sch.panX) / sch.zoom,
    y: (sy - sch.panY) / sch.zoom,
  });

  function getPinPos(comp, pinIndex) {
    const rightSide = pinIndex % 2 === 0;
    const row = Math.floor(pinIndex / 2);
    return {
      x: comp.x + (rightSide ? comp.w : 0),
      y: comp.y + 26 + row * 18,
    };
  }

  function pinAtScreen(sx, sy, radius = 14) {
    for (const comp of sch.components) {
      for (let i = 0; i < comp.pins.length; i++) {
        const pp = getPinPos(comp, i);
        const sp = toScreen(pp.x, pp.y);
        const dx = sx - sp.x, dy = sy - sp.y;
        if (Math.abs(dx) < radius && Math.abs(dy) < radius) {
          return { comp, pinIndex: i, pin: comp.pins[i] };
        }
      }
    }
    return null;
  }

  function compAtScreen(sx, sy) {
    const w = toWorld(sx, sy);
    for (let i = sch.components.length - 1; i >= 0; i--) {
      const c = sch.components[i];
      if (w.x >= c.x && w.x <= c.x + c.w && w.y >= c.y && w.y <= c.y + c.h) {
        return c;
      }
    }
    return null;
  }

  function setPinNetLabel(comp, pinIndex, netName) {
    if (!comp || !comp.pins[pinIndex]) return;
    comp.pins[pinIndex].net = netName || null;
    sch.dirty = true;
    render();
    autoSaveSchematic();
  }

  function render() {
    const W = cvs.width, H = cvs.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, W, H);

    
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    const step = 20 * sch.zoom;
    const ox = sch.panX % step, oy = sch.panY % step;
    for (let x = ox; x < W; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = oy; y < H; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    
    for (const comp of sch.components) {
      drawComponent(comp);
    }
  }

  function drawComponent(comp) {
    const sp = toScreen(comp.x, comp.y);
    const sw = comp.w * sch.zoom;
    const sh = comp.h * sch.zoom;

    ctx.fillStyle = '#161b22';
    ctx.strokeStyle = '#30363d';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(sp.x, sp.y, sw, sh, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#1f2937';
    ctx.beginPath();
    ctx.roundRect(sp.x, sp.y, sw, 22 * sch.zoom, [6, 6, 0, 0]);
    ctx.fill();

    ctx.fillStyle = '#00d4aa';
    ctx.font = `bold ${Math.round(11 * sch.zoom)}px Inter,sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(comp.ref, sp.x + 8 * sch.zoom, sp.y + 11 * sch.zoom);

    const badge = comp.lcsc;
    ctx.fillStyle = '#374151';
    const bw = ctx.measureText(badge).width + 10;
    ctx.fillRect(sp.x + sw - bw - 4 * sch.zoom, sp.y + 4 * sch.zoom, bw, 14 * sch.zoom);
    ctx.fillStyle = '#9ca3af';
    ctx.font = `${Math.round(9 * sch.zoom)}px Inter,sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText(badge, sp.x + sw - 8 * sch.zoom, sp.y + 11 * sch.zoom);

    comp.pins.forEach((pin, i) => {
      const pp = getPinPos(comp, i);
      const ps = toScreen(pp.x, pp.y);
      const rightSide = i % 2 === 0;
      const pinLen = 12 * sch.zoom;
      const lineEndX = ps.x + (rightSide ? pinLen : -pinLen);

      
      ctx.strokeStyle = '#6b7280';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ps.x, ps.y);
      ctx.lineTo(lineEndX, ps.y);
      ctx.stroke();

      
      const connected = !!pin.net;
      const isHighlighted = sch.highlightNet && pin.net && pin.net.toUpperCase() === sch.highlightNet.toUpperCase();

      ctx.beginPath();
      ctx.arc(ps.x, ps.y, 4 * sch.zoom, 0, Math.PI * 2);
      ctx.fillStyle = isHighlighted ? '#ffcc00' : (connected ? '#00d4aa' : '#374151');
      ctx.strokeStyle = isHighlighted ? '#ffcc00' : (connected ? '#00d4aa' : '#6b7280');
      ctx.fill();
      ctx.stroke();

      
      ctx.fillStyle = isHighlighted ? '#ffea00' : '#d1d5db';
      ctx.font = `${isHighlighted ? 'bold ' : ''}${Math.round(9 * sch.zoom)}px Inter,sans-serif,Arial`;
      ctx.textAlign = rightSide ? 'left' : 'right';
      ctx.textBaseline = 'middle';
      const labelX = lineEndX + (rightSide ? 3 : -3) * sch.zoom;
      ctx.fillText(`${pin.label}`, labelX, ps.y);

      
      if (pin.net) {
        ctx.save();
        ctx.fillStyle = isHighlighted ? '#ffea00' : '#10b981';
        ctx.font = `bold ${Math.round(11 * sch.zoom)}px Inter,sans-serif,Arial`;
        ctx.textAlign = rightSide ? 'left' : 'right';
        ctx.textBaseline = 'middle';
        const labelWidth = ctx.measureText(pin.label).width;
        const netX = labelX + (rightSide ? (labelWidth + 10) : -(labelWidth + 10)) * sch.zoom;
        ctx.fillText(pin.net, netX, ps.y);
        ctx.strokeStyle = isHighlighted ? 'rgba(255,204,0,0.6)' : 'rgba(16, 185, 129, 0.4)';
        ctx.lineWidth = isHighlighted ? 2 : 1;
        ctx.beginPath();
        const startX = labelX + (rightSide ? labelWidth + 2 : -labelWidth - 2) * sch.zoom;
        const endX   = netX + (rightSide ? -2 : 2) * sch.zoom;
        ctx.moveTo(startX, ps.y);
        ctx.lineTo(endX, ps.y);
        ctx.stroke();
        ctx.restore();
      }
    });

    ctx.fillStyle = '#9ca3af';
    ctx.font = `${Math.round(9 * sch.zoom)}px Inter,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const nameTrunc = comp.name.length > 14 ? comp.name.slice(0, 13) + '…' : comp.name;
    ctx.fillText(nameTrunc, sp.x + sw / 2, sp.y + 23 * sch.zoom);
  }

  
  cvs.addEventListener('mousedown', (e) => {
    const { x, y } = getPos(e);
    const pinHit = pinAtScreen(x, y, 14);
    if (pinHit) {
      openLabelModal(pinHit.comp, pinHit.pinIndex, pinHit.pin.net || '');
      return;
    }
    const comp = compAtScreen(x, y);
    if (comp) {
      const w = toWorld(x, y);
      sch.dragging = { compId: comp.id, offX: w.x - comp.x, offY: w.y - comp.y };
    }
  });

  cvs.addEventListener('mousemove', (e) => {
    const { x, y } = getPos(e);
    if (sch.dragging) {
      const w = toWorld(x, y);
      const comp = sch.components.find(c => c.id === sch.dragging.compId);
      if (comp) {
        comp.x = Math.round((w.x - sch.dragging.offX) / 10) * 10;
        comp.y = Math.round((w.y - sch.dragging.offY) / 10) * 10;
        sch.dirty = true;
        render();
      }
    }
  });

  cvs.addEventListener('mouseup', () => {
    if (sch.dragging) {
      sch.dragging = null;
      autoSaveSchematic(true);
    }
  });

  cvs.addEventListener('wheel', (e) => {
    e.preventDefault();
    const { x, y } = getPos(e);
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const wBefore = toWorld(x, y);
    sch.zoom = Math.min(3, Math.max(0.3, sch.zoom * delta));
    const wAfter = toWorld(x, y);
    sch.panX += (wAfter.x - wBefore.x) * sch.zoom;
    sch.panY += (wAfter.y - wBefore.y) * sch.zoom;
    render();
  }, { passive: false });

  function getPos(e) {
    const r = cvs.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  cvs.addEventListener('contextmenu', e => e.preventDefault());

  
  btnSchSave?.addEventListener('click', () => autoSaveSchematic(true));
  btnSchClear?.addEventListener('click', () => {
    if (!confirm('Clear all labels?')) return;
    sch.components.forEach(c => c.pins.forEach(p => { if (p.net) delete p.net; }));
    sch.dirty = true; render(); autoSaveSchematic();
  });

  function openLabelModal(comp, pinIndex, current) {
    activeLabelPin = { comp, pinIndex };
    labelInput.value = current;
    labelModal.style.display = 'flex';
    setTimeout(() => { labelInput.focus(); labelInput.select(); }, 50);
  }

  function closeLabelModal() { labelModal.style.display = 'none'; activeLabelPin = null; }
  let activeLabelPin = null;

  labelOk?.addEventListener('click', () => {
    if (activeLabelPin) setPinNetLabel(activeLabelPin.comp, activeLabelPin.pinIndex, labelInput.value.trim().toUpperCase());
    closeLabelModal();
  });
  labelDelete?.addEventListener('click', () => {
    if (activeLabelPin) setPinNetLabel(activeLabelPin.comp, activeLabelPin.pinIndex, null);
    closeLabelModal();
  });
  labelCancel?.addEventListener('click', closeLabelModal);
  labelModal?.addEventListener('click', (e) => { if (e.target === labelModal) closeLabelModal(); });
  labelInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') labelOk.click(); if (e.key === 'Escape') closeLabelModal(); });

  cmdInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const cmd = cmdInput.value.trim().toLowerCase();
      if (cmd.startsWith('show ')) {
        const net = cmd.slice(5).trim();
        sch.highlightNet = net || null;
        showStatus(net ? `Highlighting Net: ${net.toUpperCase()}` : 'Highlight cleared');
        render();
      } else if (cmd === 'hide' || cmd === 'clear' || cmd === 'none') {
        sch.highlightNet = null;
        cmdInput.value = '';
        showStatus('Highlight cleared');
        render();
      }
    }
  });

  
  window.addEventListener('keydown', (e) => {
    if (!sch.visible || activeLabelPin) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key.toLowerCase() === 'l') setSchTool('label');
  });

  
  let saveTimer = null;
  function autoSaveSchematic(force = false) {
    if (!sch.dirty && !force) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveSchematicToFirebase(), force ? 100 : 1500);
  }

  async function saveSchematicToFirebase() {
    const projectID = window.PROJECT_ID;
    const dbUrl = window._PCB_DB_URL;
    if (!projectID || !dbUrl) return;
    const data = {
      updated: new Date().toISOString(),
      components: sch.components.map(c => ({
        id: c.id, libId: c.libId, lcsc: c.lcsc, name: c.name, prefix: c.prefix, ref: c.ref,
        x: c.x, y: c.y, w: c.w, h: c.h, pins: c.pins,
      })),
      netlist: buildNetlist(),
    };
    try {
      const resp = await fetch(`${dbUrl}/projects/${projectID}/schematic.json`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      });
      if (resp.ok) { sch.dirty = false; if (typeof window.setStatus === 'function') window.setStatus('Schematic saved ✓'); }
    } catch (err) {}
  }

  async function loadSchematicFromFirebase() {
    const projectID = window.PROJECT_ID;
    const dbUrl = window._PCB_DB_URL;
    if (!projectID || !dbUrl) return;
    try {
      const resp = await fetch(`${dbUrl}/projects/${projectID}/schematic.json`);
      if (!resp.ok) return;
      const data = await resp.json();
      if (data && data.components) {
        sch.components = data.components;
        const componentIds = sch.components.map(c => c.id || 0);
        sch.nextId = Math.max(0, ...componentIds) + 1;
        sch.dirty = false; render();
      }
    } catch (err) {}
  }

  function buildNetlist() {
    const nets = {};
    sch.components.forEach(c => {
      c.pins.forEach(p => {
        if (p.net) {
          const name = p.net.trim().toUpperCase();
          const key = `${c.ref}.${p.pin}`;
          if (!nets[name]) nets[name] = [];
          nets[name].push(key);
        }
      });
    });
    return nets;
  }

  window.applyAiSchematicPatch = function(patch) {
    if (!patch || !patch.action || patch.action !== 'label' || !patch.labels) return;
    if (Array.isArray(patch.labels)) {
      patch.labels.forEach(l => {
        const pinObj = findSchPinByRef(l.ref);
        if (pinObj) pinObj.comp.pins.find(p => p.pin === pinObj.pin).net = (l.net || '').trim().toUpperCase();
      });
    } else {
      Object.entries(patch.labels).forEach(([fullRef, netName]) => {
        const pinObj = findSchPinByRef(fullRef);
        if (pinObj) pinObj.comp.pins.find(p => p.pin === pinObj.pin).net = (netName || '').trim().toUpperCase();
      });
    }
    sch.dirty = true; render(); autoSaveSchematic();
  };

  function findSchPinByRef(fullRef) {
    const parts = fullRef.split('.');
    if (parts.length < 2) return null;
    const comp = sch.components.find(c => c.ref.replace('?','').toUpperCase() === parts[0].replace('?','').toUpperCase());
    if (!comp) return null;
    const pin = comp.pins.find(p => p.pin.toString() === parts[1].toString() || p.label === parts[1]);
    return pin ? { comp, pin: pin.pin } : null;
  }

  function showStatus(msg) {
    if (typeof window.setStatus === 'function') window.setStatus(msg);
  }

  window.schematic = {
    addComponent: addSchComponent,
    load: loadSchematicFromFirebase,
    save: saveSchematicToFirebase,
    syncFromServer: (data) => {
      if (sch.dragging) return;
      if (!data || !data.components) return;
      sch.components = data.components;
      sch.nextId = Math.max(sch.nextId, ...sch.components.map(c => c.id || 0)) + 1;
      render();
    },
    state: sch,
  };

  
  setTimeout(() => { if (typeof loadSchematicFromFirebase === 'function') loadSchematicFromFirebase(); }, 1200);

})();
