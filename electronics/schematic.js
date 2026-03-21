
'use strict';

(function () {

  
  const sch = {
    visible: false,
    components: [],   
    wires: [],        
    nextId: 1,
    zoom: 1.0,
    panX: 0,
    panY: 0,
    dragging: null,   
    wiring: null,     
    mouse: { x: 0, y: 0 },
    dirty: false,
    tool: 'wire', 
  };

  
  const panel       = document.getElementById('schematic-panel');
  const cvs         = document.getElementById('sch-canvas');
  const ctx         = cvs.getContext('2d');
  const btnSch      = document.getElementById('btn-schematic');
  const btnClose    = document.getElementById('btn-sch-close');
  const btnSchSave  = document.getElementById('btn-sch-save');
  const btnSchClear = document.getElementById('btn-sch-clear');
  const btnSchWire  = document.getElementById('btn-sch-wire');
  const btnSchLabel = document.getElementById('btn-sch-label');
  const labelModal = document.getElementById('label-modal');
  const labelOk    = document.getElementById('label-ok');
  const labelCancel= document.getElementById('label-cancel');
  const labelDelete= document.getElementById('label-delete');
  const btnSchAi   = document.getElementById('btn-sch-ai');
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
          console.log(`📍 Pin hit: ${comp.ref}.${comp.pins[i].pin}`);
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
    ctx.lineWidth = 1;
    const step = 20 * sch.zoom;
    const ox = sch.panX % step, oy = sch.panY % step;
    for (let x = ox; x < W; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = oy; y < H; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    
    for (const wire of sch.wires) {
      const fc = sch.components.find(c => c.id === wire.from.compId);
      const tc = sch.components.find(c => c.id === wire.to.compId);
      if (!fc || !tc) continue;
      const fi = fc.pins.findIndex(p => p.pin === wire.from.pin);
      const ti = tc.pins.findIndex(p => p.pin === wire.to.pin);
      if (fi < 0 || ti < 0) continue;
      const fp = toScreen(...Object.values(getPinPos(fc, fi)));
      const tp = toScreen(...Object.values(getPinPos(tc, ti)));
      ctx.strokeStyle = '#00d4aa';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(fp.x, fp.y);
      
      const mx = (fp.x + tp.x) / 2;
      ctx.lineTo(mx, fp.y);
      ctx.lineTo(mx, tp.y);
      ctx.lineTo(tp.x, tp.y);
      ctx.stroke();
      
      [fp, tp].forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#00d4aa';
        ctx.fill();
      });
    }

    
    for (const comp of sch.components) {
      drawComponent(comp);
    }

    
    if (sch.wiring) {
      const fromSc = toScreen(sch.wiring.fromX, sch.wiring.fromY);
      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(fromSc.x, fromSc.y);
      const mx = (fromSc.x + sch.wiring.mouseX) / 2;
      ctx.lineTo(mx, fromSc.y);
      ctx.lineTo(mx, sch.wiring.mouseY);
      ctx.lineTo(sch.wiring.mouseX, sch.wiring.mouseY);
      ctx.stroke();
      ctx.setLineDash([]);
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

      
      const connected = isConnected(comp, pin.pin);
      ctx.beginPath();
      ctx.arc(ps.x, ps.y, 4 * sch.zoom, 0, Math.PI * 2);
      ctx.fillStyle = connected ? '#00d4aa' : '#374151';
      ctx.strokeStyle = connected ? '#00d4aa' : '#6b7280';
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();

      
      ctx.fillStyle = '#d1d5db';
      ctx.font = `${Math.round(9 * sch.zoom)}px Inter,sans-serif,Arial`;
      ctx.textAlign = rightSide ? 'left' : 'right';
      ctx.textBaseline = 'middle';
      const labelX = lineEndX + (rightSide ? 3 : -3) * sch.zoom;
      ctx.fillText(`${pin.label}`, labelX, ps.y);

      
      if (pin.net) {
        ctx.save();
        ctx.fillStyle = '#10b981'; 
        ctx.font = `bold ${Math.round(10 * sch.zoom)}px Inter,sans-serif,Arial`;
        ctx.textAlign = rightSide ? 'left' : 'right';
        ctx.textBaseline = 'middle';
        
        const labelWidth = ctx.measureText(pin.label).width;
        const netX = labelX + (rightSide ? (labelWidth + 10) : -(labelWidth + 10)) * sch.zoom;
        ctx.fillText(pin.net, netX, ps.y);

        
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
        ctx.lineWidth = 1;
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

  function isConnected(comp, pin) {
    
    const hasWire = sch.wires.some(w =>
      (w.from.compId === comp.id && w.from.pin === pin) ||
      (w.to.compId === comp.id && w.to.pin === pin)
    );
    if (hasWire) return true;
    
    const pObj = comp.pins.find(p => p.pin === pin);
    return !!(pObj && pObj.net);
  }

  
  cvs.addEventListener('mousedown', onDown);
  cvs.addEventListener('mousemove', onMove);
  cvs.addEventListener('mouseup', onUp);
  cvs.addEventListener('wheel', onWheel, { passive: false });

  function getPos(e) {
    const r = cvs.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onDown(e) {
    const { x, y } = getPos(e);

    
    if (e.button === 2) {
      sch.wiring = null;
      render();
      return;
    }

    
    if (sch.wiring) {
      const hit = pinAtScreen(x, y, 14); 
      if (hit) {
        if (!(hit.comp.id === sch.wiring.fromCompId && hit.pin.pin === sch.wiring.fromPin)) {
          
          sch.wires.push({
            id: sch.nextId++,
            from: { compId: sch.wiring.fromCompId, pin: sch.wiring.fromPin },
            to:   { compId: hit.comp.id,            pin: hit.pin.pin },
          });
          sch.wiring = null;
          sch.dirty = true;
          render();
          autoSaveSchematic();
          showStatus('Wire connected ✓');
        } else {
          
          sch.wiring = null;
          render();
        }
      } else {
        
        sch.wiring = null;
        render();
      }
      return;
    }

    
    const pinHit = pinAtScreen(x, y, 14);
    if (pinHit) {
      if (sch.tool === 'label') {
        openLabelModal(pinHit.comp, pinHit.pinIndex, pinHit.pin.net || '');
        return;
      }
      
      const pp = getPinPos(pinHit.comp, pinHit.pinIndex);
      sch.wiring = {
        fromCompId: pinHit.comp.id,
        fromPin: pinHit.pin.pin,
        fromX: pp.x,
        fromY: pp.y,
        mouseX: x,
        mouseY: y,
      };
      showStatus(`Wiring from ${pinHit.comp.ref} pin ${pinHit.pin.pin}...`);
      return;
    }

    
    const comp = compAtScreen(x, y);
    if (comp) {
      const w = toWorld(x, y);
      sch.dragging = { compId: comp.id, offX: w.x - comp.x, offY: w.y - comp.y };
    }
  }

  function onMove(e) {
    const { x, y } = getPos(e);
    if (sch.wiring) {
      sch.wiring.mouseX = x;
      sch.wiring.mouseY = y;
      render();
      return;
    }
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
  }

  function onUp(e) {
    if (sch.dragging) {
      sch.dragging = null;
      if (sch.dirty) autoSaveSchematic();
    }
  }

  function onWheel(e) {
    e.preventDefault();
    const { x, y } = getPos(e);
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const wBefore = toWorld(x, y);
    sch.zoom = Math.min(3, Math.max(0.3, sch.zoom * delta));
    const wAfter = toWorld(x, y);
    sch.panX += (wAfter.x - wBefore.x) * sch.zoom;
    sch.panY += (wAfter.y - wBefore.y) * sch.zoom;
    render();
  }

  cvs.addEventListener('contextmenu', e => e.preventDefault());

  
  cvs.addEventListener('dblclick', (e) => {
    const { x, y } = getPos(e);
    
    
    const pinHit = pinAtScreen(x, y, 12);
    if (pinHit) {
      const idx = sch.wires.findIndex(w =>
        (w.from.compId === pinHit.comp.id && w.from.pin === pinHit.pin.pin) ||
        (w.to.compId === pinHit.comp.id && w.to.pin === pinHit.pin.pin)
      );
      if (idx >= 0) {
        sch.wires.splice(idx, 1);
        sch.dirty = true;
        render();
        autoSaveSchematic();
      }
    }
  });

  
  btnSchSave?.addEventListener('click', () => {
    autoSaveSchematic(true);
  });

  btnSchClear?.addEventListener('click', () => {
    if (!confirm('Clear all wires and labels from schematic?')) return;
    sch.wires = [];
    sch.components.forEach(c => c.pins.forEach(p => { if (p.net) delete p.net; }));
    sch.dirty = true;
    render();
    autoSaveSchematic();
  });

  function setSchTool(tool) {
    sch.tool = tool;
    btnSchWire?.classList.toggle('active', tool === 'wire');
    btnSchLabel?.classList.toggle('active', tool === 'label');
    showStatus(`Tool: ${tool.toUpperCase()}`);
    render();
  }
  btnSchWire?.addEventListener('click', () => setSchTool('wire'));
  btnSchLabel?.addEventListener('click', () => setSchTool('label'));
  btnSchAi?.addEventListener('click', () => {
    
    if (globalAiHelpBtn) globalAiHelpBtn.click();
  });

  
  let activeLabelPin = null; 

  function openLabelModal(comp, pinIndex, current) {
    activeLabelPin = { comp, pinIndex };
    labelInput.value = current;
    labelModal.style.display = 'flex';
    setTimeout(() => { labelInput.focus(); labelInput.select(); }, 50);
  }

  function closeLabelModal() {
    labelModal.style.display = 'none';
    activeLabelPin = null;
  }

  labelOk?.addEventListener('click', () => {
    if (activeLabelPin) {
      setPinNetLabel(activeLabelPin.comp, activeLabelPin.pinIndex, labelInput.value.trim().toUpperCase());
    }
    closeLabelModal();
  });

  labelDelete?.addEventListener('click', () => {
    if (activeLabelPin) {
      setPinNetLabel(activeLabelPin.comp, activeLabelPin.pinIndex, null);
    }
    closeLabelModal();
  });

  labelCancel?.addEventListener('click', closeLabelModal);
  labelModal?.addEventListener('click', (e) => { if (e.target === labelModal) closeLabelModal(); });

  labelInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') labelOk.click();
    if (e.key === 'Escape') closeLabelModal();
  });

  
  window.addEventListener('keydown', (e) => {
    if (!sch.visible || activeLabelPin) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key.toLowerCase() === 'w') setSchTool('wire');
    if (e.key.toLowerCase() === 'l') setSchTool('label');
    if (e.key === 'Delete' || e.key === 'Backspace') {
       
       
    }
  });

  
  let saveTimer = null;

  function autoSaveSchematic(force = false) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveSchematicToFirebase(), force ? 0 : 1500);
  }

  async function saveSchematicToFirebase() {
    const projectID = window.PROJECT_ID;
    if (!projectID) return;

    
    const data = {
      updated: new Date().toISOString(),
      components: sch.components.map(c => ({
        id:     c.id,
        libId:  c.libId,
        lcsc:   c.lcsc,
        name:   c.name,
        prefix: c.prefix,
        ref:    c.ref,
        x: c.x, y: c.y,
        w: c.w, h: c.h,
        pins: c.pins,
      })),
      wires: sch.wires,
      netlist: buildNetlist(),
    };

    
    const dbUrl = window._PCB_DB_URL;
    if (!dbUrl) {
      
      localStorage.setItem(`sch_${projectID}`, JSON.stringify(data));
      console.log('📐 Schematic saved to localStorage');
      return;
    }

    try {
      const resp = await fetch(`${dbUrl}/projects/${projectID}/schematic.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (resp.ok) {
        console.log('📐 Schematic saved to Firebase');
        sch.dirty = false;
        showStatus('Schematic saved ✓');
      }
    } catch (err) {
      localStorage.setItem(`sch_${projectID}`, JSON.stringify(data));
      console.warn('⚠️ Schematic saved to localStorage (offline)');
    }
  }

  async function loadSchematicFromFirebase() {
    const projectID = window.PROJECT_ID;
    if (!projectID) return;

    const dbUrl = window._PCB_DB_URL;

    let data = null;

    if (dbUrl) {
      try {
        const resp = await fetch(`${dbUrl}/projects/${projectID}/schematic.json`);
        if (resp.ok) data = await resp.json();
      } catch (err) {  }
    }

    if (!data) {
      try {
        data = JSON.parse(localStorage.getItem(`sch_${projectID}`) || 'null');
      } catch (e) {  }
    }

    if (data && data.components) {
      sch.components = data.components;
      sch.wires = data.wires || [];
      
      const maxId = Math.max(0, ...sch.components.map(c => c.id), ...sch.wires.map(w => w.id));
      sch.nextId = maxId + 1;
      render();
      console.log('📐 Schematic loaded from Firebase');
    }
  }

  
  function buildNetlist() {
    
    const pinToNet = {}; 
    const nets = {};     
    let nextNetId = 1;

    
    function union(p1, p2) {
      let n1 = pinToNet[p1];
      let n2 = pinToNet[p2];

      if (!n1 && !n2) {
        const id = 'NET' + (nextNetId++);
        pinToNet[p1] = pinToNet[p2] = id;
        nets[id] = [p1, p2];
      } else if (n1 && !n2) {
        pinToNet[p2] = n1;
        nets[n1].push(p2);
      } else if (!n1 && n2) {
        pinToNet[p1] = n2;
        nets[n2].push(p1);
      } else if (n1 !== n2) {
        
        nets[n2].forEach(p => pinToNet[p] = n1);
        nets[n1] = nets[n1].concat(nets[n2]);
        delete nets[n2];
      }
    }

    
    sch.wires.forEach(w => {
      union(`${w.from.compId}:${w.from.pin}`, `${w.to.compId}:${w.to.pin}`);
    });

    
    const labeledPins = {}; 
    sch.components.forEach(c => {
      c.pins.forEach(p => {
        if (p.net) {
          const name = p.net.trim().toUpperCase();
          const key = `${c.id}:${p.pin}`;
          if (!labeledPins[name]) labeledPins[name] = [];
          labeledPins[name].push(key);
        }
      });
    });

    Object.entries(labeledPins).forEach(([name, keys]) => {
      const first = keys[0];
      
      keys.forEach(k => {
        
        if (!pinToNet[k]) {
          const id = name; 
          pinToNet[k] = id;
          if (!nets[id]) nets[id] = [];
          nets[id].push(k);
        }
        
        union(first, k);
      });
    });

    return nets;
  }

  function showStatus(msg) {
    if (typeof window.setStatus === 'function') window.setStatus(msg);
  }

  
  window.applyAiSchematicPatch = function(patch) {
    if (!patch || !patch.action) return;
    console.log('🤖 Applying AI Schematic Patch:', patch.action);

    if (patch.action === 'connect' && Array.isArray(patch.connections)) {
      patch.connections.forEach(conn => {
        if (!Array.isArray(conn) || conn.length < 2) return;
        const [refA, refB] = conn;
        const pA = findSchPinByRef(refA);
        const pB = findSchPinByRef(refB);
        if (pA && pB) {
          
          const exists = sch.wires.some(w => 
            (w.from.compId === pA.comp.id && w.from.pin === pA.pin && w.to.compId === pB.comp.id && w.to.pin === pB.pin) ||
            (w.from.compId === pB.comp.id && w.from.pin === pB.pin && w.to.compId === pA.comp.id && w.to.pin === pA.pin)
          );
          if (!exists) {
            sch.wires.push({
              id: sch.nextId++,
              from: { compId: pA.comp.id, pin: pA.pin },
              to:   { compId: pB.comp.id, pin: pB.pin }
            });
            console.log(`✅ Wired ${refA} to ${refB}`);
          }
        }
      });
      sch.dirty = true; render(); autoSaveSchematic();
    }

    if (patch.action === 'layout' && patch.positions) {
      Object.entries(patch.positions).forEach(([ref, pos]) => {
        const comp = findSchCompByRef(ref);
        if (comp && pos.x !== undefined && pos.y !== undefined) {
          comp.x = pos.x; comp.y = pos.y;
        }
      });
      sch.dirty = true; render(); autoSaveSchematic();
    }
    
    if (patch.action === 'replace' && patch.wires) {
      sch.wires = patch.wires;
      sch.dirty = true; render(); autoSaveSchematic();
    }

    if (patch.action === 'label' && patch.labels) {
      if (Array.isArray(patch.labels)) {
        patch.labels.forEach(l => {
          if (l.ref && l.net) setLabelOnRef(l.ref, l.net);
        });
      } else {
        Object.entries(patch.labels).forEach(([fullRef, netName]) => {
          setLabelOnRef(fullRef, netName);
        });
      }
      sch.dirty = true; render(); autoSaveSchematic();
    }

    function setLabelOnRef(fullRef, netName) {
      const pinObj = findSchPinByRef(fullRef);
      if (pinObj) {
        const comp = pinObj.comp;
        const pinIdx = comp.pins.findIndex(p => p.pin === pinObj.pin);
        if (pinIdx >= 0) {
          comp.pins[pinIdx].net = (netName || '').trim().toUpperCase();
        }
      }
    }
  };

  function findSchCompByRef(ref) {
    
    return sch.components.find(c => c.ref.replace('?','').toUpperCase() === ref.replace('?','').toUpperCase()) 
        || sch.components.find(c => c.ref.toUpperCase().includes(ref.toUpperCase()));
  }

  function findSchPinByRef(fullRef) {
    
    const parts = fullRef.split('.');
    if (parts.length < 2) return null;
    const compRef = parts[0];
    const pinName = parts[1];
    const comp = findSchCompByRef(compRef);
    if (!comp) return null;
    const pin = comp.pins.find(p => p.pin.toString() === pinName.toString() || p.label === pinName);
    return pin ? { comp, pin: pin.pin } : null;
  }

  
  setTimeout(() => {
    const projectID = window.PROJECT_ID;
    const dbUrl = window._PCB_DB_URL;
    if (projectID && dbUrl) {
      
      
      
      setInterval(async () => {
        try {
          const resp = await fetch(`${dbUrl}/projects/${projectID}/schematic/aiPatch.json`);
          if (resp.ok) {
            const patch = await resp.json();
            if (patch && patch.action && !patch._applied) {
              window.applyAiSchematicPatch(patch);
              
              await fetch(`${dbUrl}/projects/${projectID}/schematic/aiPatch/_applied.json`, {
                method: 'PUT',
                body: JSON.stringify(true)
              });
              await fetch(`${dbUrl}/projects/${projectID}/schematic/aiPatch/_appliedAt.json`, {
                method: 'PUT',
                body: JSON.stringify(new Date().toISOString())
              });
            }
          }
        } catch (e) {  }
      }, 5000);
    }
  }, 3000);

  
  window.schematic = {
    addComponent: addSchComponent,
    load:  loadSchematicFromFirebase,
    save:  saveSchematicToFirebase,
    applyPatch: window.applyAiSchematicPatch,
    state: sch,
  };

  
  setTimeout(loadSchematicFromFirebase, 1200);

})();
