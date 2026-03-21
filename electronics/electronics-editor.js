
'use strict';


const LAYER_COLORS = {
  'F.Cu':     '#c83200',
  'B.Cu':     '#0047c8',
  'F.SilkS':  '#e0e0e0',
  'Edge.Cuts':'#ffcc00',
  'F.Mask':   '#9455cc',
};
const MM_PER_PX = 1;   
const SCALE_BASE = 6;  


const state = {
  elements: [],        
  selectedIds: new Set(),
  history: [],         
  redoStack: [],
  tool: 'select',
  activeLayer: 'F.Cu',
  gridMm: 1.0,
  showGrid: true,
  zoom: 1.0,
  panX: 0,
  panY: 0,
  layerVisible: { 'F.Cu':true,'B.Cu':true,'F.SilkS':true,'Edge.Cuts':true,'F.Mask':true },
  traceWidth: 0.25,    
  dragging: false,
  panning: false,
  drawingTrace: false,
  tracePoints: [],
  selectionBox: null,
  dragStart: null,
  dragElementsStart: null,
  nextId: 1,
  measureStart: null,
  measureEnd: null,
  mouse: { x:0, y:0 },
};


const canvas  = document.getElementById('pcb-canvas');
const ctx     = canvas.getContext('2d');
const wrap    = document.getElementById('canvas-wrap');

function resizeCanvas() {
  canvas.width  = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
  render();
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();


function newId() { return state.nextId++; }


function screenToWorld(sx, sy) {
  const scale = SCALE_BASE * state.zoom;
  return {
    x: (sx - canvas.width/2 - state.panX) / scale,
    y: (sy - canvas.height/2 - state.panY) / scale,
  };
}
function worldToScreen(wx, wy) {
  const scale = SCALE_BASE * state.zoom;
  return {
    x: wx * scale + canvas.width/2 + state.panX,
    y: wy * scale + canvas.height/2 + state.panY,
  };
}
function snapToGrid(v) {
  const g = state.gridMm;
  return Math.round(v / g) * g;
}
function snapPt(pt) {
  return { x: snapToGrid(pt.x), y: snapToGrid(pt.y) };
}


function makeTrace(pts, layer, width) {
  return { id:newId(), type:'trace', layer, width, pts:[...pts] };
}
function makeVia(x, y, drill=0.8, pad=1.6) {
  return { id:newId(), type:'via', x, y, drill, pad, layer:'F.Cu' };
}
function makePad(x, y, w=1.5, h=1.0, layer='F.Cu', ref='P1') {
  return { id:newId(), type:'pad', x, y, w, h, layer, ref };
}
function makeHole(x, y, drill=1.0) {
  return { id:newId(), type:'hole', x, y, drill };
}
function makeRect(x, y, w, h, layer, filled=false) {
  return { id:newId(), type:'rect', x, y, w, h, layer, filled };
}
function makeText(x, y, text, layer, size=1.0) {
  return { id:newId(), type:'text', x, y, text, layer, size };
}
function makeComponent(type, x, y) {
  const comps = {
    'comp-r': {
      label:'R1', value:'10kΩ', elements:[
        { type:'pad', dx:-2.5, dy:0, w:1.5, h:1.0 },
        { type:'pad', dx: 2.5, dy:0, w:1.5, h:1.0 },
        { type:'rect', dx:0, dy:0, w:3.5, h:1.5, filled:false },
      ]
    },
    'comp-c': {
      label:'C1', value:'100nF', elements:[
        { type:'pad', dx:-2.0, dy:0, w:1.2, h:1.0 },
        { type:'pad', dx: 2.0, dy:0, w:1.2, h:1.0 },
        { type:'rect', dx:0, dy:0, w:3.0, h:1.8, filled:false },
      ]
    },
    'comp-led': {
      label:'D1', value:'LED', elements:[
        { type:'pad', dx:-2.54, dy:0, w:1.2, h:1.0 },
        { type:'pad', dx: 2.54, dy:0, w:1.2, h:1.0 },
        { type:'hole', dx:-2.54, dy:0, drill:0.8 },
        { type:'hole', dx: 2.54, dy:0, drill:0.8 },
        { type:'rect', dx:0, dy:0, w:5.5, h:3.0, filled:false },
      ]
    },
    'comp-ic': {
      label:'U1', value:'DIP-8', elements:[
        { type:'pad', dx:-3.81, dy:-3.81, w:1.5, h:1.5 },
        { type:'pad', dx:-3.81, dy:-1.27, w:1.5, h:1.5 },
        { type:'pad', dx:-3.81, dy: 1.27, w:1.5, h:1.5 },
        { type:'pad', dx:-3.81, dy: 3.81, w:1.5, h:1.5 },
        { type:'pad', dx: 3.81, dy:-3.81, w:1.5, h:1.5 },
        { type:'pad', dx: 3.81, dy:-1.27, w:1.5, h:1.5 },
        { type:'pad', dx: 3.81, dy: 1.27, w:1.5, h:1.5 },
        { type:'pad', dx: 3.81, dy: 3.81, w:1.5, h:1.5 },
        { type:'rect', dx:0, dy:0, w:8, h:10, filled:false },
      ]
    },
    'comp-conn': {
      label:'J1', value:'2-pin', elements:[
        { type:'hole', dx:-1.27, dy:0, drill:1.0 },
        { type:'hole', dx: 1.27, dy:0, drill:1.0 },
        { type:'pad',  dx:-1.27, dy:0, w:2.0, h:2.0 },
        { type:'pad',  dx: 1.27, dy:0, w:2.0, h:2.0 },
        { type:'rect', dx:0, dy:0, w:5, h:4, filled:false },
      ]
    },
  };
  const def = comps[type];
  if (!def) return null;
  const grp = { id:newId(), type:'group', compType:type, label:def.label, value:def.value, x, y, children:[] };
  def.elements.forEach(e => {
    let el;
    const ex = x + (e.dx||0), ey = y + (e.dy||0);
    if (e.type==='pad')  el = makePad(ex, ey, e.w, e.h, state.activeLayer);
    if (e.type==='rect') el = makeRect(ex-e.w/2, ey-e.h/2, e.w, e.h, 'F.SilkS', e.filled);
    if (e.type==='hole') el = makeHole(ex, ey, e.drill);
    if (el) grp.children.push(el);
  });
  return grp;
}


function pushHistory() {
  state.history.push(JSON.stringify(state.elements));
  if (state.history.length > 80) state.history.shift();
  state.redoStack = [];
  updateUI();
}
function undo() {
  if (!state.history.length) return;
  state.redoStack.push(JSON.stringify(state.elements));
  state.elements = JSON.parse(state.history.pop());
  state.selectedIds.clear();
  state.nextId = 1 + (state.elements.reduce((max, e) => Math.max(max, e.id || 0), 0));
  updateUI(); render();
}
function redo() {
  if (!state.redoStack.length) return;
  state.history.push(JSON.stringify(state.elements));
  state.elements = JSON.parse(state.redoStack.pop());
  state.selectedIds.clear();
  state.nextId = 1 + (state.elements.reduce((max, e) => Math.max(max, e.id || 0), 0));
  updateUI(); render();
}


function addElement(el) {
  pushHistory();
  if (el.type === 'group') {
    el.children.forEach(c => { c.groupId = el.id; state.elements.push(c); });
    state.elements.push(el);
  } else {
    state.elements.push(el);
  }
  updateStats();
  autoSave();
}


function render() {
  const W = canvas.width, H = canvas.height;
  const scale = SCALE_BASE * state.zoom;

  ctx.clearRect(0,0,W,H);

  
  ctx.fillStyle = '#070b12';
  ctx.fillRect(0,0,W,H);

  
  const boardW = 100, boardH = 80;
  const bMin = worldToScreen(-boardW/2, -boardH/2);
  const bMax = worldToScreen( boardW/2,  boardH/2);
  ctx.fillStyle = '#0a2a1a';
  ctx.fillRect(bMin.x, bMin.y, bMax.x-bMin.x, bMax.y-bMin.y);
  ctx.strokeStyle = '#ffcc00';
  ctx.lineWidth = 2;
  ctx.strokeRect(bMin.x, bMin.y, bMax.x-bMin.x, bMax.y-bMin.y);

  
  if (state.showGrid) drawGrid(scale);

  ctx.save();
  ctx.translate(W/2 + state.panX, H/2 + state.panY);
  ctx.scale(scale, scale);

  
  const layerOrder = ['Edge.Cuts','B.Cu','F.Mask','F.SilkS','F.Cu'];
  layerOrder.forEach(layer => {
    if (!state.layerVisible[layer]) return;
    state.elements.forEach(el => {
      if (el.type==='group') return;
      if (el.layer !== layer) return;
      drawElement(el, ctx, scale);
    });
  });

  
  state.elements.forEach(el => {
    if (el.type==='via' || el.type==='hole') drawElement(el, ctx, scale);
  });

  
  if (typeof drawRatsnest === 'function') drawRatsnest(ctx, scale);

  
  if (state.drawingTrace && state.tracePoints.length > 0) {
    const pts = [...state.tracePoints, state.mouse];
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i=1; i<pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.strokeStyle = LAYER_COLORS[state.activeLayer] + 'cc';
    ctx.lineWidth = state.traceWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  
  if (state.measureStart && state.measureEnd) {
    const s = state.measureStart, e = state.measureEnd;
    ctx.beginPath();
    ctx.moveTo(s.x,s.y); ctx.lineTo(e.x,e.y);
    ctx.strokeStyle = '#ffff00';
    ctx.lineWidth = 0.1;
    ctx.setLineDash([0.5,0.5]);
    ctx.stroke();
    ctx.setLineDash([]);
    const dist = Math.sqrt((e.x-s.x)**2+(e.y-s.y)**2).toFixed(2);
    ctx.fillStyle = '#ffff00';
    ctx.font = `${1/state.zoom}px Inter`;
    ctx.fillText(`${dist} mm`, (s.x+e.x)/2+0.2, (s.y+e.y)/2-0.3);
  }

  ctx.restore();

  
  state.selectedIds.forEach(id => {
    const el = state.elements.find(e=>e.id===id);
    if (el) drawSelectionHighlight(el, scale);
  });

  
  if (state.selectionBox) {
    const b = state.selectionBox;
    ctx.strokeStyle = '#00d4aa';
    ctx.lineWidth = 1;
    ctx.setLineDash([4,3]);
    ctx.fillStyle = 'rgba(0,212,170,0.05)';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.setLineDash([]);
  }

  updateCoordDisplay();
}

function drawGrid(scale) {
  const W = canvas.width, H = canvas.height;
  const g = state.gridMm;
  const step = g * scale;
  if (step < 4) return;

  const offX = (W/2 + state.panX) % step;
  const offY = (H/2 + state.panY) % step;

  ctx.strokeStyle = step > 20 ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = offX; x < W; x += step) { ctx.moveTo(x,0); ctx.lineTo(x,H); }
  for (let y = offY; y < H; y += step) { ctx.moveTo(0,y); ctx.lineTo(W,y); }
  ctx.stroke();

  if (step > 30) {
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    for (let x = offX; x < W; x += step)
      for (let y = offY; y < H; y += step)
        ctx.fillRect(x-1,y-1,2,2);
  }
}

function drawElement(el, ctx, scale) {
  const col = LAYER_COLORS[el.layer] || '#888';
  const sel = state.selectedIds.has(el.id);

  ctx.save();
  if (sel) { ctx.shadowColor = '#00d4aa'; ctx.shadowBlur = 8/scale; }

  switch(el.type) {
    case 'trace': {
      if (!el.pts || el.pts.length < 2) break;
      ctx.beginPath();
      ctx.moveTo(el.pts[0].x, el.pts[0].y);
      for (let i=1; i<el.pts.length; i++) ctx.lineTo(el.pts[i].x, el.pts[i].y);
      ctx.strokeStyle = col;
      ctx.lineWidth = el.width || 0.25;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      break;
    }
    case 'via': {
      const r = (el.pad||1.6)/2;
      const ri = (el.drill||0.8)/2;
      ctx.beginPath(); ctx.arc(el.x, el.y, r, 0, Math.PI*2);
      ctx.fillStyle = '#888'; ctx.fill();
      ctx.beginPath(); ctx.arc(el.x, el.y, ri, 0, Math.PI*2);
      ctx.fillStyle = '#070b12'; ctx.fill();
      ctx.strokeStyle = sel ? '#00d4aa' : '#aaa';
      ctx.lineWidth = 0.05; ctx.stroke();
      break;
    }
    case 'pad': {
      ctx.fillStyle = col;
      ctx.fillRect(el.x - el.w/2, el.y - el.h/2, el.w, el.h);
      if (sel) { ctx.strokeStyle='#00d4aa'; ctx.lineWidth=0.1; ctx.strokeRect(el.x-el.w/2, el.y-el.h/2, el.w, el.h); }
      break;
    }
    case 'hole': {
      const r = (el.drill||1.0)/2;
      ctx.beginPath(); ctx.arc(el.x, el.y, r+0.3, 0, Math.PI*2);
      ctx.fillStyle = '#c0a060'; ctx.fill();
      ctx.beginPath(); ctx.arc(el.x, el.y, r, 0, Math.PI*2);
      ctx.fillStyle = '#070b12'; ctx.fill();
      break;
    }
    case 'rect': {
      const lw = 0.12;
      if (el.filled) {
        ctx.fillStyle = col + '55';
        ctx.fillRect(el.x, el.y, el.w, el.h);
      }
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.strokeRect(el.x, el.y, el.w, el.h);
      break;
    }
    case 'text': {
      ctx.fillStyle = col;
      ctx.font = `${el.size||1}px Inter`;
      ctx.textBaseline = 'middle';
      ctx.fillText(el.text||'', el.x, el.y);
      break;
    }
  }
  ctx.restore();
}

function drawSelectionHighlight(el, scale) {
  if (!el) return;
  const s = worldToScreen(el.x||0, el.y||0);
  ctx.save();
  ctx.strokeStyle = '#00d4aa';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4,3]);

  if (el.type==='trace' && el.pts) {
    const pad = 3;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    el.pts.forEach(p => {
      const sp = worldToScreen(p.x,p.y);
      minX=Math.min(minX,sp.x); minY=Math.min(minY,sp.y);
      maxX=Math.max(maxX,sp.x); maxY=Math.max(maxY,sp.y);
    });
    ctx.strokeRect(minX-pad, minY-pad, maxX-minX+pad*2, maxY-minY+pad*2);
  } else if (el.type==='rect') {
    const tl = worldToScreen(el.x, el.y);
    const br = worldToScreen(el.x+el.w, el.y+el.h);
    ctx.strokeRect(tl.x-3, tl.y-3, br.x-tl.x+6, br.y-tl.y+6);
  } else {
    ctx.strokeRect(s.x-8, s.y-8, 16, 16);
  }
  ctx.setLineDash([]);
  ctx.restore();
}


function hitTest(wx, wy) {
  const tol = 1.0 / state.zoom;
  
  for (let i = state.elements.length-1; i >= 0; i--) {
    const el = state.elements[i];
    if (el.type==='group') continue;
    if (!state.layerVisible[el.layer] && el.type!=='via' && el.type!=='hole') continue;
    if (hitElement(el, wx, wy, tol)) return el;
  }
  return null;
}

function hitElement(el, wx, wy, tol) {
  switch(el.type) {
    case 'trace': {
      for (let i=0; i<el.pts.length-1; i++) {
        if (distSegment(wx,wy, el.pts[i].x,el.pts[i].y, el.pts[i+1].x,el.pts[i+1].y) < (el.width/2)+tol)
          return true;
      }
      return false;
    }
    case 'via':  return Math.hypot(wx-el.x, wy-el.y) < (el.pad||1.6)/2 + tol;
    case 'hole': return Math.hypot(wx-el.x, wy-el.y) < (el.drill||1)/2 + tol*2;
    case 'pad':  return wx>=el.x-el.w/2-tol && wx<=el.x+el.w/2+tol && wy>=el.y-el.h/2-tol && wy<=el.y+el.h/2+tol;
    case 'rect': return wx>=el.x-tol && wx<=el.x+el.w+tol && wy>=el.y-tol && wy<=el.y+el.h+tol;
    case 'text': return Math.abs(wx-el.x)<4 && Math.abs(wy-el.y)<(el.size||1);
    default: return false;
  }
}

function distSegment(px,py, ax,ay, bx,by) {
  const dx=bx-ax, dy=by-ay;
  const len2 = dx*dx+dy*dy;
  if (len2===0) return Math.hypot(px-ax,py-ay);
  const t = Math.max(0, Math.min(1, ((px-ax)*dx+(py-ay)*dy)/len2));
  return Math.hypot(px-(ax+t*dx), py-(ay+t*dy));
}


let _panStartX=0, _panStartY=0, _panOriginX=0, _panOriginY=0;
let _dragOffsets = [];

canvas.addEventListener('mousedown', onMouseDown);
canvas.addEventListener('mousemove', onMouseMove);
canvas.addEventListener('mouseup',   onMouseUp);
canvas.addEventListener('wheel',     onWheel, { passive:false });
canvas.addEventListener('contextmenu', onContextMenu);
canvas.addEventListener('dblclick',  onDblClick);

function getWorld(e) {
  const r = canvas.getBoundingClientRect();
  return screenToWorld(e.clientX - r.left, e.clientY - r.top);
}

function onMouseDown(e) {
  hideContextMenu();
  const w = getWorld(e);
  const snapped = snapPt(w);

  
  if (e.button===1 || (e.button===0 && state._spaceDown)) {
    state.panning = true;
    _panStartX = e.clientX; _panStartY = e.clientY;
    _panOriginX = state.panX; _panOriginY = state.panY;
    wrap.classList.add('panning');
    e.preventDefault(); return;
  }

  if (e.button !== 0) return;

  if (state.tool === 'select') {
    const hit = hitTest(w.x, w.y);
    if (hit) {
      if (!e.shiftKey) state.selectedIds.clear();
      state.selectedIds.add(hit.id);
      
      if (hit.groupId) {
        state.selectedIds.add(hit.groupId); 
        state.elements.filter(el=>el.groupId===hit.groupId)
          .forEach(el=>state.selectedIds.add(el.id));
      }
      state.dragging = true;
      _dragOffsets = [];
      state.selectedIds.forEach(id => {
        const el = state.elements.find(e=>e.id===id);
        if (el) {
          _dragOffsets.push({ id, dx: w.x-(el.x||0), dy: w.y-(el.y||0) });
        }
      });
      state.dragElementsStart = JSON.stringify(state.elements);
      updatePropsPanel();
    } else {
      if (!e.shiftKey) { state.selectedIds.clear(); updatePropsPanel(); }
      
      const r = canvas.getBoundingClientRect();
      state.selectionBox = { sx:e.clientX-r.left, sy:e.clientY-r.top, x:e.clientX-r.left, y:e.clientY-r.top, w:0, h:0 };
    }
  }
  else if (state.tool === 'trace') {
    if (!state.drawingTrace) {
      state.drawingTrace = true;
      state.tracePoints = [snapped];
    } else {
      state.tracePoints.push(snapped);
    }
  }
  else if (state.tool === 'via') {
    addElement(makeVia(snapped.x, snapped.y));
    render();
  }
  else if (state.tool === 'pad') {
    addElement(makePad(snapped.x, snapped.y, 1.5, 1.0, state.activeLayer));
    render();
  }
  else if (state.tool === 'hole') {
    addElement(makeHole(snapped.x, snapped.y));
    render();
  }
  else if (state.tool === 'rect') {
    state.rectStart = snapped;
    state.dragging = true;
  }
  else if (state.tool === 'text') {
    showTextInput(snapped);
  }
  else if (state.tool === 'measure') {
    if (!state.measureStart) {
      state.measureStart = snapped;
      state.measureEnd = null;
    } else {
      state.measureEnd = snapped;
      state.measureStart = null;
    }
    render();
  }
  else if (state.tool.startsWith('comp-')) {
    const grp = makeComponent(state.tool, snapped.x, snapped.y);
    if (grp) { addElement(grp); render(); }
  }
  else if (state.tool === 'lib-place') {
    
    if (typeof window.placeLibraryComponent === 'function') {
      const result = window.placeLibraryComponent(snapped.x, snapped.y);
      if (result && result.group && result.elements) {
        const grp = { ...result.group, id: newId(), children: [] };
        result.elements.forEach(e => {
          let el;
          const ex = snapped.x + (e.dx || 0), ey = snapped.y + (e.dy || 0);
          if (e.type === 'pad')  el = makePad(ex, ey, e.w, e.h, state.activeLayer, e.ref || 'P');
          if (e.type === 'rect') el = makeRect(ex - e.w/2, ey - e.h/2, e.w, e.h, 'F.SilkS', e.filled);
          if (e.type === 'hole') el = makeHole(ex, ey, e.drill);
          if (e.type === 'text') el = makeText(ex, ey, e.text, 'F.SilkS', e.size || 1.0);
          if (el) grp.children.push(el);
        });
        addElement(grp);
        render();
        if (typeof window.setStatus === 'function') {
          window.setStatus(`✅ Placed ${result.group.value || 'component'}`);
        }
      }
    }
  }
}

function onMouseMove(e) {
  const r = canvas.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  const w = screenToWorld(sx, sy);
  state.mouse = snapPt(w);

  if (state.panning) {
    state.panX = _panOriginX + (e.clientX - _panStartX);
    state.panY = _panOriginY + (e.clientY - _panStartY);
    render(); return;
  }

  if (state.dragging && state.tool==='select' && _dragOffsets.length) {
    
    
    const anchor = _dragOffsets[0];
    const elA = state.elements.find(e => e.id === anchor.id);
    if (!elA) return;

    const nx = snapToGrid(w.x - anchor.dx);
    const ny = snapToGrid(w.y - anchor.dy);
    const diffX = nx - (elA.x || 0);
    const diffY = ny - (elA.y || 0);

    if (diffX !== 0 || diffY !== 0) {
      _dragOffsets.forEach(({ id }) => {
        const el = state.elements.find(e => e.id === id);
        if (el) moveElement(el, diffX, diffY);
      });
    }
    render(); return;
  }

  if (state.dragging && state.tool==='rect' && state.rectStart) {
    const s = worldToScreen(state.rectStart.x, state.rectStart.y);
    const cur = worldToScreen(state.mouse.x, state.mouse.y);
    state.selectionBox = { x:Math.min(s.x,cur.x), y:Math.min(s.y,cur.y), w:Math.abs(cur.x-s.x), h:Math.abs(cur.y-s.y) };
    render(); return;
  }

  if (state.selectionBox && state.selectionBox.sx !== undefined) {
    const sb = state.selectionBox;
    const cx = sx, cy = sy;
    sb.x = Math.min(sb.sx, cx);
    sb.y = Math.min(sb.sy, cy);
    sb.w = Math.abs(cx - sb.sx);
    sb.h = Math.abs(cy - sb.sy);
    render(); return;
  }

  if (state.measureStart) { state.measureEnd = state.mouse; render(); return; }

  if (state.drawingTrace) { render(); return; }

  render();
}

function onMouseUp(e) {
  if (state.panning) {
    state.panning = false;
    wrap.classList.remove('panning');
    return;
  }

  if (state.dragging && state.tool==='select' && _dragOffsets.length) {
    
    if (state.dragElementsStart) {
      const after = JSON.stringify(state.elements);
      if (after !== state.dragElementsStart) {
        state.history.push(state.dragElementsStart);
        state.redoStack = [];
        autoSave();
      }
    }
    state.dragging = false;
    _dragOffsets = [];
    updatePropsPanel();
    render();
    return;
  }

  if (state.dragging && state.tool==='rect' && state.rectStart) {
    const s = state.rectStart;
    const e2 = state.mouse;
    const w = e2.x - s.x, h = e2.y - s.y;
    if (Math.abs(w) > 0.5 && Math.abs(h) > 0.5) {
      const x = Math.min(s.x,e2.x), y = Math.min(s.y,e2.y);
      addElement(makeRect(x, y, Math.abs(w), Math.abs(h), state.activeLayer));
    }
    state.rectStart = null;
    state.dragging = false;
    state.selectionBox = null;
    render(); return;
  }

  if (state.selectionBox && state.selectionBox.sx !== undefined) {
    const sb = state.selectionBox;
    const tl = screenToWorld(sb.x, sb.y);
    const br = screenToWorld(sb.x+sb.w, sb.y+sb.h);
    state.elements.forEach(el => {
      if (el.type==='group') return;
      const ex = el.x||0, ey = el.y||0;
      if (ex>=tl.x && ex<=br.x && ey>=tl.y && ey<=br.y) {
        state.selectedIds.add(el.id);
        if (el.groupId) state.selectedIds.add(el.groupId);
      }
    });
    
    state.selectedIds.forEach(id => {
      const g = state.elements.find(e => e.id === id && e.type === 'group');
      if (g) {
        state.elements.filter(e => e.groupId === g.id).forEach(c => state.selectedIds.add(c.id));
      }
    });
    state.selectionBox = null;
    updatePropsPanel();
    render();
  }
}

function onDblClick(e) {
  if (state.tool==='trace' && state.drawingTrace && state.tracePoints.length >= 2) {
    const pts = [...state.tracePoints];
    addElement(makeTrace(pts, state.activeLayer, state.traceWidth));
    state.drawingTrace = false;
    state.tracePoints = [];
    render();
  }
}

function onWheel(e) {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.12 : 1/1.12;
  const r = canvas.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  const wx = (sx - canvas.width/2 - state.panX) / (SCALE_BASE*state.zoom);
  const wy = (sy - canvas.height/2 - state.panY) / (SCALE_BASE*state.zoom);
  state.zoom = Math.min(20, Math.max(0.1, state.zoom * factor));
  
  state.panX = sx - canvas.width/2 - wx*SCALE_BASE*state.zoom;
  state.panY = sy - canvas.height/2 - wy*SCALE_BASE*state.zoom;
  updateZoomLabel();
  render();
}

function onContextMenu(e) {
  e.preventDefault();
  const w = getWorld(e);
  const hit = hitTest(w.x, w.y);
  if (hit) {
    state.selectedIds.clear();
    state.selectedIds.add(hit.id);
    if (hit.groupId) state.elements.filter(el=>el.groupId===hit.groupId).forEach(el=>state.selectedIds.add(el.id));
    showContextMenu(e.clientX, e.clientY);
    render();
  }
}


function moveElement(el, dx, dy) {
  if (el.x !== undefined) el.x += dx;
  if (el.y !== undefined) el.y += dy;
  if (el.pts) el.pts = el.pts.map(p=>({ x:p.x+dx, y:p.y+dy }));
}

function rotateSelection(angleDeg) {
  if (state.selectedIds.size === 0) return;
  pushHistory();
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);

  
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  const els = [];
  state.selectedIds.forEach(id => {
    const el = state.elements.find(e => e.id === id);
    if (el && el.x !== undefined && el.y !== undefined) {
      els.push(el);
      minX = Math.min(minX, el.x); minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x); maxY = Math.max(maxY, el.y);
    }
  });

  if (els.length === 0) return;
  const cx = (minX+maxX)/2, cy = (minY+maxY)/2;

  els.forEach(el => {
    const dx = el.x - cx, dy = el.y - cy;
    el.x = cx + (dx * cos - dy * sin);
    el.y = cy + (dx * sin + dy * cos);
    
    
    if (el.type === 'pad' || el.type === 'rect') {
      const oldW = el.w; el.w = el.h; el.h = oldW;
    }
    
    if (el.pts) {
      el.pts = el.pts.map(p => {
        const pdx = p.x - cx, pdy = p.y - cy;
        return { x: cx + (pdx * cos - pdy * sin), y: cy + (pdx * sin + pdy * cos) };
      });
    }
  });
  render(); autoSave();
}


function deleteSelected() {
  if (!state.selectedIds.size) return;
  pushHistory();
  const toDelete = new Set(state.selectedIds);
  
  state.elements.filter(el=>el.groupId && state.selectedIds.has(el.groupId))
    .forEach(el=>toDelete.add(el.id));
  state.elements = state.elements.filter(el=>!toDelete.has(el.id));
  
  
  const groups = state.elements.filter(e => e.type === 'group');
  groups.forEach(g => {
    const hasChildren = state.elements.some(e => e.groupId === g.id);
    if (!hasChildren) state.elements = state.elements.filter(e => e.id !== g.id);
  });

  state.selectedIds.clear();
  updatePropsPanel();
  updateStats();
  autoSave();
  render();
}


function duplicateSelected() {
  if (!state.selectedIds.size) return;
  pushHistory();
  const newEls = [];
  state.selectedIds.forEach(id => {
    const el = state.elements.find(e=>e.id===id);
    if (!el || el.type==='group') return;
    const clone = JSON.parse(JSON.stringify(el));
    clone.id = newId();
    if (clone.x !== undefined) clone.x += 2;
    if (clone.y !== undefined) clone.y += 2;
    newEls.push(clone);
  });
  state.elements.push(...newEls);
  state.selectedIds.clear();
  newEls.forEach(e=>state.selectedIds.add(e.id));
  updateStats(); autoSave(); render();
}


state._spaceDown = false;
document.addEventListener('keydown', e => {
  if (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
  if (e.code==='Space') { state._spaceDown=true; wrap.classList.add('tool-pan'); e.preventDefault(); return; }
  if (e.key==='Escape') {
    state.drawingTrace=false; state.tracePoints=[]; state.measureStart=null; state.measureEnd=null;
    state.selectedIds.clear(); updatePropsPanel(); render(); return;
  }
  if ((e.ctrlKey||e.metaKey) && e.key==='z') { e.preventDefault(); undo(); return; }
  if ((e.ctrlKey||e.metaKey) && (e.key==='y'||(e.shiftKey&&e.key==='z'))) { e.preventDefault(); redo(); return; }
  if ((e.ctrlKey||e.metaKey) && e.key==='a') { e.preventDefault(); selectAll(); return; }
  if (e.key==='Delete'||e.key==='Backspace') { deleteSelected(); return; }
  if (e.key==='+'||e.key==='=') { state.zoom=Math.min(20,state.zoom*1.2); updateZoomLabel(); render(); return; }
  if (e.key==='-') { state.zoom=Math.max(0.1,state.zoom/1.2); updateZoomLabel(); render(); return; }
  if (e.key==='f'||e.key==='F') { fitView(); return; }
  
  const shortcuts = {s:'select',t:'trace',v:'via',p:'pad',h:'hole',r:'rect',x:'text',m:'measure'};
  if (shortcuts[e.key.toLowerCase()] && e.key !== 'r') setTool(shortcuts[e.key.toLowerCase()]);
  
  
  if (e.key.toLowerCase() === 'r' && state.selectedIds.size > 0) {
    rotateSelection(90);
  }
});
document.addEventListener('keyup', e => {
  if (e.code==='Space') { state._spaceDown=false; wrap.classList.remove('tool-pan'); }
});


function setTool(tool) {
  if (!tool) return;
  state.tool = tool;
  state.drawingTrace = false; state.tracePoints = [];
  document.querySelectorAll('.tool-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tool===tool);
  });
  
  let toolKey = 'tool_' + tool;
  if (tool.startsWith('comp-')) {
    const cType = tool.split('-')[1];
    
    const maps = { r:'resistor', c:'capacitor', led:'led', ic:'ic', conn:'connector' };
    toolKey = 'comp_' + (maps[cType] || cType);
  }
  
  document.getElementById('status-tool').textContent = t('tool_status', t(toolKey));
  render();
}
document.querySelectorAll('.tool-btn').forEach(b => {
  b.addEventListener('click', () => setTool(b.dataset.tool));
});


const ctxMenu = document.getElementById('ctx-menu');
function showContextMenu(x,y) {
  ctxMenu.style.left = x+'px'; ctxMenu.style.top = y+'px';
  ctxMenu.classList.remove('hidden');
}
function hideContextMenu() { ctxMenu.classList.add('hidden'); }
document.getElementById('ctx-delete').onclick    = () => { deleteSelected(); hideContextMenu(); };
document.getElementById('ctx-duplicate').onclick = () => { duplicateSelected(); hideContextMenu(); };
document.getElementById('ctx-props').onclick     = () => { updatePropsPanel(); hideContextMenu(); };
document.getElementById('ctx-select-all').onclick= () => { selectAll(); hideContextMenu(); };
document.addEventListener('click', e => {
  if (!ctxMenu.contains(e.target)) hideContextMenu();
});

function selectAll() {
  state.elements.forEach(el => { if(el.type!=='group') state.selectedIds.add(el.id); });
  render();
}


function updateZoomLabel() {
  document.getElementById('zoom-label').textContent = Math.round(state.zoom*100)+'%';
}
document.getElementById('btn-zoom-in').onclick  = () => { state.zoom=Math.min(20,state.zoom*1.3); updateZoomLabel(); render(); };
document.getElementById('btn-zoom-out').onclick = () => { state.zoom=Math.max(0.1,state.zoom/1.3); updateZoomLabel(); render(); };
document.getElementById('btn-fit').onclick      = fitView;
function fitView() {
  state.zoom=1; state.panX=0; state.panY=0;
  updateZoomLabel(); render();
}

document.getElementById('btn-undo').onclick = undo;
document.getElementById('btn-redo').onclick = redo;


function updateCoordDisplay() {
  const m = state.mouse;
  document.getElementById('coord-display').textContent =
    `X: ${m.x.toFixed(2)}mm  Y: ${m.y.toFixed(2)}mm`;
}


document.getElementById('grid-select').addEventListener('change', e => {
  state.gridMm = parseFloat(e.target.value);
  document.getElementById('grid-info').textContent = `${t('grid_label')}: ${e.target.value}mm`;
  render();
});
document.getElementById('grid-visible').addEventListener('change', e => {
  state.showGrid = e.target.checked; render();
});


document.querySelectorAll('[name="active-layer"]').forEach(r => {
  r.addEventListener('change', () => { state.activeLayer = r.value; });
});
document.querySelectorAll('.eye-btn').forEach(b => {
  b.addEventListener('click', () => {
    const layer = b.dataset.layer;
    state.layerVisible[layer] = !state.layerVisible[layer];
    b.classList.toggle('active', state.layerVisible[layer]);
    render();
  });
});


function showTextInput(pos) {
  showModal(t('modal_add_text_title'), `
    <div class="modal-form-row"><label>${t('prop_text')}</label><input id="mi-text" class="prop-input-full" value="${t('default_text')}"/></div>
    <div class="modal-form-row"><label>${t('prop_size')} (mm)</label><input id="mi-size" type="number" class="prop-input-full" value="1.5" step="0.1" min="0.2"/></div>
  `, () => {
    const text = document.getElementById('mi-text').value.trim();
    const size = parseFloat(document.getElementById('mi-size').value)||1.5;
    if (text) { addElement(makeText(pos.x, pos.y, text, state.activeLayer, size)); render(); }
  });
}


function updatePropsPanel() {
  const pc = document.getElementById('props-content');
  if (state.selectedIds.size === 0) {
    pc.innerHTML = `<p style="color:#666;font-size:12px;text-align:center;margin-top:12px">${t('select_element')}</p>`;
    return;
  }
  if (state.selectedIds.size > 1) {
    pc.innerHTML = `<p style="color:#8a9ab8;font-size:12px;text-align:center;margin-top:8px">${t('prop_selected', state.selectedIds.size)}</p>
    <button class="full-btn" style="margin-top:8px" onclick="deleteSelected()">🗑️ ${t('prop_delete')}</button>`;
    return;
  }
  const id = [...state.selectedIds][0];
  const el = state.elements.find(e=>e.id===id);
  if (!el) return;

  const typeName = t('type_' + el.type);
  let html = `<div class="prop-row"><span class="prop-label">${t('prop_type')}</span><b>${typeName}</b></div>`;
  if (el.layer) html += prRow(t('prop_layer'), el.layer);
  if (el.x !== undefined) html += prInputRow(t('prop_x'), el.x.toFixed(3), 'el-x');
  if (el.y !== undefined) html += prInputRow(t('prop_y'), el.y.toFixed(3), 'el-y');
  if (el.type==='trace')  html += prInputRow(t('prop_width'), el.width.toFixed(3), 'el-w');
  if (el.type==='via')    html += prInputRow(t('prop_drill'), el.drill.toFixed(3), 'el-drill');
  if (el.type==='pad')    html += prInputRow(t('prop_width'), el.w.toFixed(3), 'el-pw') + prInputRow(t('prop_height'), el.h.toFixed(3), 'el-ph');
  if (el.type==='hole')   html += prInputRow(t('prop_drill'), el.drill.toFixed(3), 'el-drill');
  if (el.type==='text')   html += prInputRow(t('prop_text'), el.text, 'el-text') + prInputRow(t('prop_size'), el.size.toFixed(2), 'el-sz');
  if (el.ref !== undefined) html += prInputRow(t('prop_ref'), el.ref, 'el-ref');
  html += `<button class="full-btn" style="margin-top:8px;color:var(--err);border-color:var(--err)" onclick="deleteSelected()">🗑️ ${t('prop_delete')}</button>`;
  pc.innerHTML = html;

  
  const bind = (domId, prop, parse) => {
    const inp = document.getElementById(domId);
    if (!inp) return;
    inp.addEventListener('change', () => {
      pushHistory();
      el[prop] = parse ? parse(inp.value) : inp.value;
      autoSave(); render();
    });
  };
  bind('el-x','x',parseFloat); bind('el-y','y',parseFloat);
  bind('el-w', el.type==='trace'?'width':'w', parseFloat);
  bind('el-drill','drill',parseFloat);
  bind('el-pw','w',parseFloat); bind('el-ph','h',parseFloat);
  bind('el-text','text',null); bind('el-sz','size',parseFloat);
  bind('el-ref','ref',null);
}
function prRow(label, val) {
  return `<div class="prop-row"><span class="prop-label">${label}</span><span>${val}</span></div>`;
}
function prInputRow(label, val, id) {
  return `<div class="prop-row"><span class="prop-label">${label}</span><input class="prop-input" id="${id}" value="${val}"/></div>`;
}


function showModal(title, body, onOk, danger=false) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = body;
  document.getElementById('modal-ok').className = 'accent' + (danger?' danger':'');
  document.getElementById('modal-overlay').classList.remove('hidden');
  const ok = document.getElementById('modal-ok');
  const cancel = document.getElementById('modal-cancel');
  const close = () => document.getElementById('modal-overlay').classList.add('hidden');
  ok.onclick    = () => { close(); if(onOk) onOk(); };
  cancel.onclick = close;
  setTimeout(()=>{
    const first = document.querySelector('#modal-body input, #modal-body select');
    if (first) first.focus();
  }, 50);
}


function updateStats() {
  const traces = state.elements.filter(e=>e.type==='trace').length;
  const vias   = state.elements.filter(e=>e.type==='via').length;
  const comps  = state.elements.filter(e=>e.type==='group').length;
  const total  = state.elements.length;
  document.getElementById('el-count').textContent    = total;
  document.getElementById('trace-count').textContent = traces;
  document.getElementById('comp-count').textContent  = comps;
  document.getElementById('via-count').textContent   = vias;
}


const DB_KEY = 'odb_pcb_projects';

function getProjectName() {
  return document.getElementById('project-name').value.trim() || 'My Electronics Project';
}

function saveProject() {
  const name = getProjectName();
  const data = {
    name,
    savedAt: new Date().toISOString(),
    elements: state.elements,
    nextId: state.nextId,
  };
  
  let projects = loadAllProjects();
  const idx = projects.findIndex(p=>p.name===name);
  if (idx>=0) projects[idx]=data; else projects.push(data);
  localStorage.setItem(DB_KEY, JSON.stringify(projects));
  setStatus(t('status_saved', name));
  renderSavedProjects();

  
  if (typeof window.savePCBToFirebase === 'function') {
    window.savePCBToFirebase();
  }
}

function autoSave() {
  
  clearTimeout(state._autoSaveTimer);
  state._autoSaveTimer = setTimeout(saveProject, 1500);
}

function loadAllProjects() {
  try { return JSON.parse(localStorage.getItem(DB_KEY)||'[]'); } catch(e) { return []; }
}

function loadProject(data) {
  state.elements = data.elements || [];
  state.nextId   = data.nextId   || (1 + Math.max(0, ...state.elements.map(e=>e.id||0)));
  document.getElementById('project-name').value = data.name || 'My Electronics Project';
  state.selectedIds.clear();
  state.history = []; state.redoStack = [];
  updateStats(); updatePropsPanel(); render();
  setStatus(t('status_loaded', data.name));
}

function renderSavedProjects() {
  const list = document.getElementById('saved-projects-list');
  const projects = loadAllProjects();
  if (!projects.length) { list.innerHTML = `<div class="no-projects">${t('no_projects')}</div>`; return; }
  list.innerHTML = projects.map((p,i) => {
    const d = new Date(p.savedAt).toLocaleDateString();
    return `<div class="saved-project-item" onclick="loadProjectByIndex(${i})">
      <div><div class="saved-project-name">${p.name}</div><div class="saved-project-date">${d}</div></div>
      <button class="saved-project-del" onclick="event.stopPropagation();deleteProjectByIndex(${i})" title="${t('prop_delete')}">✕</button>
    </div>`;
  }).join('');
}
window.loadProjectByIndex = (i) => {
  const p = loadAllProjects()[i];
  if (p) loadProject(p);
};
window.deleteProjectByIndex = (i) => {
  let projects = loadAllProjects();
  showModal(t('modal_delete_proj', projects[i]?.name), t('modal_no_undo'), () => {
    projects.splice(i,1);
    localStorage.setItem(DB_KEY, JSON.stringify(projects));
    renderSavedProjects();
  }, true);
};


document.getElementById('btn-new').onclick = () => {
  showModal(t('modal_new_title'), `<p>${t('modal_new_msg')}</p>`, () => {
    state.elements=[]; state.selectedIds.clear(); state.history=[]; state.redoStack=[]; state.nextId=1;
    document.getElementById('project-name').value='My Electronics Project';
    updateStats(); updatePropsPanel(); render();
    
    if (typeof window.clearPCBFromFirebase === 'function') {
      window.clearPCBFromFirebase();
    }
  }, true);
};




document.getElementById('btn-drc').onclick = () => {
  const issues = [];
  const traces = state.elements.filter(e=>e.type==='trace');
  traces.forEach(t => { if (t.width < 0.1) issues.push(t('drc_thin_trace', t.width.toFixed(2))); });
  const vias = state.elements.filter(e=>e.type==='via');
  vias.forEach(v => { if (v.drill < 0.2) issues.push(t('drc_small_drill', v.drill)); });
  const drc = document.getElementById('drc-results');
  if (!issues.length) {
    drc.innerHTML = `<span class="drc-ok">${t('drc_ok')}</span>`;
  } else {
    drc.innerHTML = issues.map(i=>`<div class="drc-warn">${i}</div>`).join('');
  }
};


function setStatus(msg) {
  document.getElementById('status-msg').textContent = msg;
}
function updateUI() {
  document.getElementById('btn-undo').disabled = !state.history.length;
  document.getElementById('btn-redo').disabled = !state.redoStack.length;
}


const welcomeOverlay = document.getElementById('welcome-overlay');
if (localStorage.getItem('odb_pcb_welcome_seen')) {
  welcomeOverlay.style.display = 'none';
}
document.getElementById('welcome-close').onclick = () => {
  welcomeOverlay.style.display = 'none';
  localStorage.setItem('odb_pcb_welcome_seen', 'true');
};



state.traceWidth = 0.25;


document.getElementById('lang-select').onchange = (e) => setLanguage(e.target.value);
const savedLang = localStorage.getItem('odb_pcb_lang') || 'en';
document.getElementById('lang-select').value = savedLang;
setLanguage(savedLang);

renderSavedProjects();
updateStats();
setTool('select');
fitView();


state.ratsnest = []; 

function drawRatsnest(ctx, scale) {
  if (!state.ratsnest || state.ratsnest.length === 0) return;
  
  ctx.save();
  ctx.strokeStyle = 'rgba(0, 212, 170, 0.5)'; 
  ctx.lineWidth = 0.5 / scale; // Screen-relative thin line
  ctx.setLineDash([5 / scale, 5 / scale]);

  state.ratsnest.forEach(rat => {
    ctx.beginPath();
    ctx.moveTo(rat.p1.x, rat.p1.y);
    ctx.lineTo(rat.p2.x, rat.p2.y);
    ctx.stroke();

    
    ctx.fillStyle = 'rgba(0, 212, 170, 0.6)';
    ctx.beginPath(); ctx.arc(rat.p1.x, rat.p1.y, 1.5 / scale, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(rat.p2.x, rat.p2.y, 1.5 / scale, 0, Math.PI*2); ctx.fill();
  });
  ctx.restore();
}

async function loadRatsnest() {
  const projectID = window.PROJECT_ID;
  const dbUrl = window._PCB_DB_URL;
  if (!projectID || !dbUrl) return;

  try {
    const resp = await fetch(`${dbUrl}/projects/${projectID}/schematic.json`);
    if (!resp.ok) return;
    const schData = await resp.json();
    if (!schData || !schData.netlist) { state.ratsnest = []; render(); return; }

    const compMap = {};
    (schData.components || []).forEach(c => { 
      
      compMap[c.id] = (c.ref || ''); 
    });

    const newRats = [];
    let connectedCount = 0;
    let missingPads = 0;

    Object.entries(schData.netlist || {}).forEach(([netName, pinRefs]) => {
      const pads = [];
      pinRefs.forEach(pref => {
        let ref = null, pin = null;
        if (pref.includes(':')) {
           const parts = pref.split(':');
           ref = compMap[parts[0]];
           pin = parts[1];
        } else if (pref.includes('.')) {
           const parts = pref.split('.');
           ref = parts[0];
           pin = parts[1];
        }
        if (!ref) return;
        const pad = window.findPadAtRef(`${ref}.${pin}`);
        if (pad) {
            pads.push(pad);
        } else {
            missingPads++;
        }
      });
      
      if (pads.length > 1) {
          for (let i = 0; i < pads.length - 1; i++) {
            newRats.push({ p1: pads[i], p2: pads[i+1], netName });
            connectedCount++;
          }
          
          if (pads.length > 2) {
              newRats.push({ p1: pads[pads.length-1], p2: pads[0], netName });
          }
      }
    });

    state.ratsnest = newRats;
    if (connectedCount > 0) {
        console.info(`🔌 Ratsnest updated: ${connectedCount} connections. ${missingPads > 0 ? `⚠️ ${missingPads} pads missing.` : ''}`);
    }
    render();
  } catch (e) { console.warn('Ratsnest load failed', e); }
}

function drawRatsnest(ctx, scale) {
  if (!state.ratsnest || state.ratsnest.length === 0) return;
  
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 204, 0, 0.5)'; 
  ctx.lineWidth = 0.1; 
  ctx.setLineDash([0.4, 0.4]);

  state.ratsnest.forEach(rat => {
    ctx.beginPath();
    ctx.moveTo(rat.p1.x, rat.p1.y);
    ctx.lineTo(rat.p2.x, rat.p2.y);
    ctx.stroke();

    
    ctx.fillStyle = 'rgba(255, 204, 0, 0.6)';
    ctx.beginPath(); ctx.arc(rat.p1.x, rat.p1.y, 0.15, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(rat.p2.x, rat.p2.y, 0.15, 0, Math.PI*2); ctx.fill();
  });
  ctx.restore();
}


setInterval(loadRatsnest, 3000); 
window.loadRatsnest = loadRatsnest;


updateZoomLabel();
updateUI();
render();
setTimeout(loadRatsnest, 2000);



window.state = state;
window.updateStats = updateStats;
window.updatePropsPanel = updatePropsPanel;
window.render = render;
window.saveProject = saveProject;
window.autoSave = autoSave;
window.loadProject = loadProject;
window.deleteSelected = deleteSelected;
window.setStatus = setStatus;
window.setTool = setTool;
window.addElement = addElement;
window.newId = newId;



window._pcbNets = {};

window.addNet = function(netName, ...refs) {
  if (!window._pcbNets[netName]) window._pcbNets[netName] = [];
  refs.forEach(r => { if (!window._pcbNets[netName].includes(r)) window._pcbNets[netName].push(r); });
};

window.getNets = function() { return window._pcbNets; };

window.findPadByRef = function(refName) {
  if (!refName || !refName.includes('.')) return null;
  const dotIdx = refName.lastIndexOf('.');
  const compLabel = refName.substring(0, dotIdx);
  const pinRef = refName.substring(dotIdx + 1);

  
  
  const matchingGroups = state.elements.filter(e =>
    e.type === 'group' && (
      (e.label || '').toUpperCase() === compLabel.toUpperCase() || 
      (e.ref || '').toUpperCase() === compLabel.toUpperCase()
    )
  );

  if (matchingGroups.length === 0) {
    
    const search = compLabel.toUpperCase();
    const fuzzyMatches = state.elements.filter(e =>
      e.type === 'group' && (
        (e.label || '').toUpperCase().includes(search) ||
        (e.value || '').toUpperCase().includes(search) ||
        (e.lcsc  || '').toUpperCase().includes(search) ||
        (e.name  || '').toUpperCase().includes(search)
      )
    );
    if (fuzzyMatches.length > 0) matchingGroups.push(...fuzzyMatches);
  }

  if (matchingGroups.length === 0) {
    console.warn(`⚠️ findPadByRef: no component matching "${compLabel}"`);
    return null;
  }

  
  matchingGroups.sort((a, b) => {
    const padsA = state.elements.filter(e => e.groupId === a.id && e.type === 'pad').length;
    const padsB = state.elements.filter(e => e.groupId === b.id && e.type === 'pad').length;
    if (padsA !== padsB) return padsB - padsA;
    return b.id - a.id;
  });

  if (matchingGroups.length > 1) {
    console.info(`ℹ️ Multiple matches for "${compLabel}", using ID ${matchingGroups[0].id} (has ${state.elements.filter(e => e.groupId === matchingGroups[0].id && e.type === 'pad').length} pads)`);
  }

  const grp = matchingGroups[0];

  const pads = state.elements.filter(e => e.groupId === grp.id && e.type === 'pad');
  if (pads.length === 0) return null;

  
  const match = pads.find(p => 
    (p.ref || '').toString().toLowerCase() === pinRef.toLowerCase() ||
    (p.refName || '').toString().toLowerCase() === pinRef.toLowerCase()
  );
  if (match) return match;

  
  const idx = parseInt(pinRef);
  if (!isNaN(idx) && idx >= 1 && idx <= pads.length) {
    return pads[idx - 1];
  }

  console.warn(`⚠️ Pad "${pinRef}" not found in component "${compLabel}"`);
  return null;
};


window.generateTrace = function(fromRef, toRef, layer = 'F.Cu', width = 0.25) {
  const a = window.findPadByRef(fromRef);
  const b = window.findPadByRef(toRef);
  if (!a || !b) { console.warn(`⚠️ generateTrace: could not find pads for "${fromRef}" → "${toRef}"`); return null; }
  const mid = { x: b.x, y: a.y };
  return { id: newId(), type: 'trace', layer, width, pts: [
    { x: a.x, y: a.y }, { x: mid.x, y: mid.y }, { x: b.x, y: b.y }
  ]};
};




window.describePCB = function() {
  const groups = state.elements.filter(e => e.type === 'group');
  const traces = state.elements.filter(e => e.type === 'trace');
  const vias   = state.elements.filter(e => e.type === 'via');

  let out = `=== PCB BOARD SUMMARY ===\n`;
  out += `Components: ${groups.length}  |  Traces: ${traces.length}  |  Vias: ${vias.length}\n\n`;

  if (groups.length === 0) {
    out += `(No components placed yet. Use "append" patch to add components.)\n`;
  } else {
    out += `--- COMPONENTS ---\n`;
    groups.forEach(grp => {
      const pads = state.elements.filter(e => e.groupId === grp.id && e.type === 'pad');
      const label = grp.label || grp.ref || grp.lcsc || `id:${grp.id}`;
      const name  = grp.value || grp.name || grp.lcsc || '';
      out += `\n[${label}] ${name} @ (${(grp.x||0).toFixed(1)}, ${(grp.y||0).toFixed(1)})mm\n`;
      out += `  Addressable pads (use as "LABEL.N" in connect patches):\n`;
      pads.forEach((p, i) => {
        const pinId = p.ref || `${i+1}`;
        out += `    ${label}.${pinId}  →  x=${p.x.toFixed(2)}, y=${p.y.toFixed(2)} [${p.layer}]\n`;
      });
    });
  }

  if (Object.keys(window._pcbNets).length > 0) {
    out += `\n--- NETS ---\n`;
    Object.entries(window._pcbNets).forEach(([net, refs]) => {
      out += `  ${net}: ${refs.join(' → ')}\n`;
    });
  }

  out += `\n=== HOW TO EDIT ===\n`;
  out += `Return a JSON patch object like:\n`;
  out += `{ "action": "connect", "connections": [["${groups[0]?.label||'U1'}.1", "${groups[1]?.label||'R1'}.1"]] }\n`;
  out += `See https://onedollarboard.com/electronics/AI_DOCS.txt for full docs.\n`;

  return out;
};


function cleanProjectState() {
  if (!state.elements) return;
  
  const groups = state.elements.filter(e => e.type === 'group');
  let removedCount = 0;
  groups.forEach(g => {
    const children = state.elements.filter(e => e.groupId === g.id);
    if (children.length === 0) {
      state.elements = state.elements.filter(e => e.id !== g.id);
      removedCount++;
    }
  });
  
  const seenLabels = new Set();
  const sorted = [...state.elements].sort((a,b) => (b.id||0) - (a.id||0));
  const toKeep = [];
  const toDiscard = new Set();

  sorted.forEach(el => {
    if (el.type === 'group' && el.label) {
      if (seenLabels.has(el.label.toUpperCase())) {
        toDiscard.add(el.id);
        
        state.elements.filter(e => e.groupId === el.id).forEach(p => toDiscard.add(p.id));
      } else {
        seenLabels.add(el.label.toUpperCase());
        toKeep.push(el.id);
      }
    }
  });
  
  if (toDiscard.size > 0) {
    state.elements = state.elements.filter(el => !toDiscard.has(el.id));
    console.log(`🧹 Project cleaned: removed ${toDiscard.size} redundant/orphaned items.`);
  }
}
window.cleanProject = cleanProjectState;


window.applyAIPatch = function(patch) {
  if (!patch || !patch.action) { console.error('❌ applyAIPatch: missing action'); return; }
  cleanProjectState(); 
  pushHistory();

  if (patch.action === 'append' && Array.isArray(patch.elements)) {
    patch.elements.forEach(el => {
      
      if (el.type === 'group' && el.label) {
        const existingId = state.elements.find(e => e.type === 'group' && e.label === el.label)?.id;
        if (existingId) {
          state.elements = state.elements.filter(e => e.id !== existingId && e.groupId !== existingId);
          console.log(`♻️ Replacing existing component: ${el.label}`);
        }
      }

      el.id = newId();
      if (el.type === 'group' && Array.isArray(el.children)) {
        el.children.forEach(c => { c.id = newId(); c.groupId = el.id; state.elements.push(c); });
      }
      state.elements.push(el);
    });
    setStatus(`✅ AI updated ${patch.elements.length} element(s)`);
  }
  else if (patch.action === 'replace' && Array.isArray(patch.elements)) {
    state.elements = [];
    state.nextId = 1;
    patch.elements.forEach(el => {
      el.id = newId();
      if (el.type === 'group' && Array.isArray(el.children)) {
        el.children.forEach(c => { c.id = newId(); c.groupId = el.id; state.elements.push(c); });
      }
      state.elements.push(el);
    });
    setStatus(`✅ AI replaced design with ${patch.elements.length} element(s)`);
  }
  else if (patch.action === 'connect' && Array.isArray(patch.connections)) {
    const layer = patch.layer || 'F.Cu';
    const width = patch.width || 0.25;
    let added = 0;
    patch.connections.forEach(conn => {
      const [from, to] = Array.isArray(conn) ? conn : [conn.from, conn.to];
      const trace = window.generateTrace(from, to, layer, width);
      if (trace) { state.elements.push(trace); added++; }
    });
    setStatus(`✅ AI connected ${added} trace(s)`);
  }

  if (patch.nets && typeof patch.nets === 'object') {
    Object.entries(patch.nets).forEach(([net, refs]) => window.addNet(net, ...refs));
  }

  updateStats();
  render();
  if (typeof window.autoSave === 'function') window.autoSave();
  console.log('✅ AI Patch applied:', patch);
};


window.pcbAutoroute = async function() {
  try {
    const netlist = (window.schematic && window.schematic.state && window.schematic.state.netlist) ? window.schematic.state.netlist : {};
    if (!netlist || Object.keys(netlist).length === 0) {
      setStatus('⚠️ No netlist found (create labels in Schematic first)');
      return;
    }
    
    console.log('🔌 Running Auto-Trace on netlist:', netlist);
    setStatus('🔌 Auto-Trace running...');
    
    let totalTraces = 0;
    const gridSize = 0.5; 
    const copperTraces = [];
    
    for (const net in netlist) {
      const refs = netlist[net];
      if (refs.length < 2) continue;
      
      
      const padPositions = [];
      refs.forEach(r => {
        const p = window.findPadAtRef(r);
        if (p) padPositions.push({ x: p.x, y: p.y, ref: r });
      });
      
      if (padPositions.length < 2) continue;
      
      
      for (let i = 0; i < padPositions.length - 1; i++) {
          const start = padPositions[i];
          const end   = padPositions[i+1];
          
          const path = await runAStar(start, end, gridSize);
          if (path && path.length > 1) {
            
            const simplifiedPath = simplifyPath(path);
            for (let j = 0; j < simplifiedPath.length - 1; j++) {
              const A = simplifiedPath[j];
              const B = simplifiedPath[j+1];
              state.elements.push({
                id: newId(), type: 'trace', layer: 'F.Cu', width: 0.25,
                x1: A.x, y1: A.y, x2: B.x, y2: B.y,
                net: net
              });
              totalTraces++;
            }
          }
      }
    }
    
    updateStats();
    render();
    if (typeof window.autoSave === 'function') window.autoSave();
    setStatus(`✅ Auto-Trace complete: ${totalTraces} segments added`);
  } catch (err) {
    console.error('❌ Autoroute Error:', err);
    setStatus('❌ Auto-Trace failed (check console)');
  }
};

window.findPadAtRef = function(refStr) {
  const parts = refStr.replace(':', '.').split('.');
  const ref = parts[0].toUpperCase();
  const pin = parts[1];
  const comp = state.elements.find(el => 
    (el.type === 'component' || el.type === 'group') && 
    (el.ref || el.label || '').toUpperCase() === ref
  );
  if (!comp) return null;
  const pads = state.elements.filter(el => el.groupId === comp.id && (el.type === 'pad' || el.type === 'hole'));
  return pads.find(p => (p.pin == pin || p.ref == pin)) || null;
};

async function runAStar(start, end, grid) {
  const startG = { x: Math.round(start.x / grid), y: Math.round(start.y / grid) };
  const endG   = { x: Math.round(end.x / grid),   y: Math.round(end.y / grid) };
  
  const openSet = [startG];
  const cameFrom = new Map();
  const gScore = new Map();
  const fScore = new Map();
  
  const key = (p) => `${p.x},${p.y}`;
  gScore.set(key(startG), 0);
  fScore.set(key(startG), manhattan(startG, endG));
  
  let iters = 0;
  const MAX_ITERS = 50000;
  while (openSet.length > 0 && iters < MAX_ITERS) {
    iters++;
    openSet.sort((a,b) => (fScore.get(key(a)) || Infinity) - (fScore.get(key(b)) || Infinity));
    const current = openSet.shift();
    
    if (current.x === endG.x && current.y === endG.y) {
       return reconstructPath(cameFrom, current, grid);
    }
    
    const neighbors = [
      {x: current.x+1, y: current.y}, {x: current.x-1, y: current.y},
      {x: current.x, y: current.y+1}, {x: current.x, y: current.y-1}
    ];
    
    for (const neighbor of neighbors) {
      const g = (gScore.get(key(current)) || 0) + 1;
      
      const prev = cameFrom.get(key(current));
      if (prev && (prev.x !== neighbor.x && prev.y !== neighbor.y)) {  }
      
      if (g < (gScore.get(key(neighbor)) || Infinity)) {
        cameFrom.set(key(neighbor), current);
        gScore.set(key(neighbor), g);
        fScore.set(key(neighbor), g + manhattan(neighbor, endG));
        if (!openSet.some(p => p.x === neighbor.x && p.y === neighbor.y)) {
          openSet.push(neighbor);
        }
      }
    }
  }
  return null;
}

function manhattan(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

function reconstructPath(cameFrom, current, grid) {
  const path = [];
  const key = (p) => `${p.x},${p.y}`;
  while (current) {
    path.push({ x: current.x * grid, y: current.y * grid });
    current = cameFrom.get(key(current));
  }
  return path.reverse();
}

function simplifyPath(path) {
  if (path.length < 3) return path;
  const result = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i-1];
    const curr = path[i];
    const next = path[i+1];
    
    const isHorizontal = prev.y === curr.y && curr.y === next.y;
    const isVertical   = prev.x === curr.x && curr.x === next.x;
    if (!isHorizontal && !isVertical) result.push(curr);
  }
  result.push(path[path.length-1]);
  return result;
}

console.log('%c Electronics Editor ready! ', 'background:#00d4aa;color:#000;font-weight:bold;font-size:14px;border-radius:4px;padding:2px 8px');
