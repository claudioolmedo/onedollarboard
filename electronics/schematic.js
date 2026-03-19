
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
  };

  
  const panel       = document.getElementById('schematic-panel');
  const cvs         = document.getElementById('sch-canvas');
  const ctx         = cvs.getContext('2d');
  const btnSch      = document.getElementById('btn-schematic');
  const btnClose    = document.getElementById('btn-sch-close');
  const btnSchSave  = document.getElementById('btn-sch-save');
  const btnSchClear = document.getElementById('btn-sch-clear');

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

  function pinAtScreen(sx, sy, radius = 10) {
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
      ctx.font = `${Math.round(9 * sch.zoom)}px Inter,sans-serif`;
      ctx.textAlign = rightSide ? 'left' : 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${pin.label}`, lineEndX + (rightSide ? 3 : -3) * sch.zoom, ps.y);
    });

    
    ctx.fillStyle = '#9ca3af';
    ctx.font = `${Math.round(9 * sch.zoom)}px Inter,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const nameTrunc = comp.name.length > 14 ? comp.name.slice(0, 13) + '…' : comp.name;
    ctx.fillText(nameTrunc, sp.x + sw / 2, sp.y + 23 * sch.zoom);
  }

  function isConnected(comp, pin) {
    return sch.wires.some(w =>
      (w.from.compId === comp.id && w.from.pin === pin) ||
      (w.to.compId === comp.id && w.to.pin === pin)
    );
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
    if (!confirm('Clear all wires from schematic?')) return;
    sch.wires = [];
    sch.dirty = true;
    render();
    autoSaveSchematic();
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
    
    const nets = {};
    let netId = 1;

    sch.wires.forEach(wire => {
      const fromKey = `${wire.from.compId}:${wire.from.pin}`;
      const toKey   = `${wire.to.compId}:${wire.to.pin}`;

      
      let fromNet = Object.keys(nets).find(n => nets[n].includes(fromKey));
      let toNet   = Object.keys(nets).find(n => nets[n].includes(toKey));

      if (!fromNet && !toNet) {
        const nId = 'NET' + (netId++);
        nets[nId] = [fromKey, toKey];
      } else if (fromNet && !toNet) {
        nets[fromNet].push(toKey);
      } else if (!fromNet && toNet) {
        nets[toNet].push(fromKey);
      } else if (fromNet !== toNet) {
        
        nets[fromNet] = [...nets[fromNet], ...nets[toNet]];
        delete nets[toNet];
      }
    });

    return nets;
  }

  function showStatus(msg) {
    if (typeof window.setStatus === 'function') window.setStatus(msg);
  }

  
  window.schematic = {
    addComponent: addSchComponent,
    load:  loadSchematicFromFirebase,
    save:  saveSchematicToFirebase,
    state: sch,
  };

  
  setTimeout(loadSchematicFromFirebase, 1200);

})();
