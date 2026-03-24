

const Router = {
  EPS: 0.1, 

  
  getOctilinearPath(p1, p2, mode = 0) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    
    if (absDx < 0.001 && absDy < 0.001) return [p1];

    
    if (absDx < 0.001 || absDy < 0.001 || Math.abs(absDx - absDy) < 0.001) {
      return [p1, p2];
    }

    let corner = { x: 0, y: 0 };

    if (mode === 0) {
      
      if (absDx > absDy) {
        
        corner.x = p1.x + Math.sign(dx) * absDy;
        corner.y = p1.y + Math.sign(dy) * absDy;
      } else {
        
        corner.x = p1.x + Math.sign(dx) * absDx;
        corner.y = p1.y + Math.sign(dy) * absDx;
      }
    } else {
      
      if (absDx > absDy) {
        
        corner.x = p2.x - Math.sign(dx) * absDy;
        corner.y = p1.y;
      } else {
        
        corner.x = p1.x;
        corner.y = p2.y - Math.sign(dy) * absDx;
      }
    }

    return [p1, corner, p2];
  },

  
  snapTo45(p, center) {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const angle = Math.atan2(dy, dx);
    const octant = Math.round(angle / (Math.PI / 4));
    const snappedAngle = octant * (Math.PI / 4);
    const dist = Math.hypot(dx, dy);
    return {
      x: center.x + Math.cos(snappedAngle) * dist,
      y: center.y + Math.sin(snappedAngle) * dist
    };
  },

  
  findConnectedIslands(elements, netName) {
    if (!netName) return [];
    const targetNet = netName.toUpperCase();
    
    
    
    const candidateElts = elements.filter(el => {
      if (el.net && el.net.toUpperCase() === targetNet) return true;
      if (!el.net && (el.type === 'trace' || el.type === 'via')) return true; 
      if (typeof window.getPadNet === 'function' && (el.type === 'pad' || el.type === 'hole')) {
        const pNet = window.getPadNet(el);
        return pNet && pNet.toUpperCase() === targetNet;
      }
      return false;
    });

    if (candidateElts.length === 0) return [];

    const dsu = new Router.DSU(candidateElts.length);
    const EPS = this.EPS;

    const isConnected = (e1, e2) => this.areElementsConductivelyConnected(e1, e2, EPS);

    
    for (let i = 0; i < candidateElts.length; i++) {
      for (let j = i + 1; j < candidateElts.length; j++) {
        if (isConnected(candidateElts[i], candidateElts[j])) {
          dsu.union(i, j);
        }
      }
    }

    
    const islandsMap = new Map();
    candidateElts.forEach((el, idx) => {
      const root = dsu.find(idx);
      if (!islandsMap.has(root)) islandsMap.set(root, []);
      islandsMap.get(root).push(el);
    });

    
    const allIslands = Array.from(islandsMap.values());
    const validIslands = allIslands.filter(island => {
       return island.some(el => {
         if (el.net && el.net.toUpperCase() === targetNet) return true;
         if (typeof window.getPadNet === 'function' && (el.type === 'pad' || el.type === 'hole')) {
            const pNet = window.getPadNet(el);
            return pNet && pNet.toUpperCase() === targetNet;
         }
         return false;
       });
    });

    return validIslands;
  },

  getTracePoints(trace) {
    if (Array.isArray(trace?.pts) && trace.pts.length > 0) return trace.pts;
    
    if (trace && Number.isFinite(trace.x1) && Number.isFinite(trace.y1) && Number.isFinite(trace.x2) && Number.isFinite(trace.y2)) {
      return [{ x: trace.x1, y: trace.y1 }, { x: trace.x2, y: trace.y2 }];
    }
    return [];
  },

  getElementLayers(el) {
    if (!el) return [];
    if (el.type === 'via') return ['F.Cu', 'B.Cu'];
    if (el.layer === '*' || el.layer === 'All' || el.layer === 'ALL') return ['F.Cu', 'B.Cu'];
    if (typeof el.layer === 'string' && el.layer) return [el.layer];
    return ['F.Cu'];
  },

  layersOverlap(a, b) {
    const la = this.getElementLayers(a);
    const lb = this.getElementLayers(b);
    return la.some(l => lb.includes(l));
  },

  isPadLike(el) {
    return el && (el.type === 'pad' || el.type === 'via' || el.type === 'hole');
  },

  getPadRadius(el) {
    return (el.pad || Math.max(el.w || 0, el.h || 0) || 1.0) / 2;
  },

  pointInsidePadCopper(px, py, el) {
    if (!this.isPadLike(el)) return false;
    if (el.type === 'pad' && Number.isFinite(el.w) && Number.isFinite(el.h)) {
      const hw = el.w / 2;
      const hh = el.h / 2;
      return Math.abs(px - el.x) <= hw && Math.abs(py - el.y) <= hh;
    }
    return Math.hypot(px - el.x, py - el.y) <= this.getPadRadius(el);
  },

  distPtToPadCopper(px, py, el) {
    if (!this.isPadLike(el)) return Infinity;
    if (this.pointInsidePadCopper(px, py, el)) return 0;
    if (el.type === 'pad' && Number.isFinite(el.w) && Number.isFinite(el.h)) {
      const hw = el.w / 2;
      const hh = el.h / 2;
      const dx = Math.max(Math.abs(px - el.x) - hw, 0);
      const dy = Math.max(Math.abs(py - el.y) - hh, 0);
      return Math.hypot(dx, dy);
    }
    return Math.max(0, Math.hypot(px - el.x, py - el.y) - this.getPadRadius(el));
  },

  areElementsConductivelyConnected(e1, e2, eps = 0.1) {
    if (!e1 || !e2) return false;
    if (!this.layersOverlap(e1, e2)) return false;

    
    if (e1.type === 'trace' && this.isPadLike(e2)) {
      const pts = this.getTracePoints(e1);
      if (pts.length < 2) return false;
      for (let i = 0; i < pts.length - 1; i++) {
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const segDist = this.distPtToSeg(e2.x, e2.y, p1.x, p1.y, p2.x, p2.y);
        if (segDist <= (e1.width || 0.2) / 2 + this.getPadRadius(e2) + eps) return true;
        if (this.pointInsidePadCopper(p1.x, p1.y, e2) || this.pointInsidePadCopper(p2.x, p2.y, e2)) return true;
      }
      return false;
    }
    if (e2.type === 'trace' && this.isPadLike(e1)) return this.areElementsConductivelyConnected(e2, e1, eps);

    
    if (e1.type === 'trace' && e2.type === 'trace') {
      const pts1 = this.getTracePoints(e1);
      const pts2 = this.getTracePoints(e2);
      if (pts1.length < 2 || pts2.length < 2) return false;
      for (let i = 0; i < pts1.length - 1; i++) {
        for (let j = 0; j < pts2.length - 1; j++) {
          const d = this.distSegToSeg(
            pts1[i].x, pts1[i].y, pts1[i + 1].x, pts1[i + 1].y,
            pts2[j].x, pts2[j].y, pts2[j + 1].x, pts2[j + 1].y
          );
          const limit = ((e1.width || 0.2) + (e2.width || 0.2)) / 2 + eps;
          if (d <= limit) return true;
        }
      }
      return false;
    }

    
    if (this.isPadLike(e1) && this.isPadLike(e2)) {
      const d = Math.hypot((e1.x || 0) - (e2.x || 0), (e1.y || 0) - (e2.y || 0));
      return d <= (this.getPadRadius(e1) + this.getPadRadius(e2) + eps);
    }

    return false;
  },

  
  distPtToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
    const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
    if (t < 0) return Math.hypot(px - ax, py - ay);
    if (t > 1) return Math.hypot(px - bx, py - by);
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  },

  
  distSegToSeg(ax, ay, bx, by, cx, cy, dx, dy) {
    
    const det = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
    if (det !== 0) {
      const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / det;
      const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / det;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
    }
    
    return Math.min(
      this.distPtToSeg(ax, ay, cx, cy, dx, dy),
      this.distPtToSeg(bx, by, cx, cy, dx, dy),
      this.distPtToSeg(cx, cy, ax, ay, bx, by),
      this.distPtToSeg(dx, dy, ax, ay, bx, by)
    );
  },

  
  getViolations(path, traceWidth, elements, netName, clearance = 0.2) {
    const collisions = new Set();
    const targetNet = netName ? netName.toUpperCase() : null;

    for (let i = 0; i < path.length - 1; i++) {
        const p1 = path[i], p2 = path[i+1];
        
        elements.forEach(el => {
            
            if (targetNet && el.net && el.net.toUpperCase() === targetNet) return;
            if (targetNet && typeof window.getPadNet === 'function' && (el.type === 'pad' || el.type === 'hole')) {
                const pNet = window.getPadNet(el);
                if (pNet && pNet.toUpperCase() === targetNet) return;
            }

            let dist = Infinity;
            let radius = 0;

            
            if (!this.layersOverlap({ type: 'trace', layer: 'F.Cu' }, el) && !this.layersOverlap({ type: 'trace', layer: 'B.Cu' }, el)) {
                return;
            }

            if (el.type === 'pad' || el.type === 'via' || el.type === 'hole') {
                
                const ds = this.distPtToSeg(el.x, el.y, p1.x, p1.y, p2.x, p2.y);
                const r = this.getPadRadius(el);
                dist = Math.max(0, ds - r);
                radius = 0;
            } else if (el.type === 'trace') {
                const tpts = this.getTracePoints(el);
                for (let j = 0; j < tpts.length - 1; j++) {
                    const e1 = tpts[j], e2 = tpts[j+1];
                    dist = Math.min(dist, this.distSegToSeg(p1.x, p1.y, p2.x, p2.y, e1.x, e1.y, e2.x, e2.y));
                }
                radius = (el.width || 0.2) / 2;
            }

            if (dist < (traceWidth / 2 + radius + clearance)) {
                collisions.add(el.id);
            }
        });
    }
    return Array.from(collisions);
  },

  
  DSU: class {
    constructor(n) {
      this.parent = Array.from({ length: n }, (_, i) => i);
    }
    find(i) {
      if (this.parent[i] === i) return i;
      return this.parent[i] = this.find(this.parent[i]);
    }
    union(i, j) {
      const rootI = this.find(i);
      const rootJ = this.find(j);
      if (rootI !== rootJ) this.parent[rootI] = rootJ;
    }
  }
};

window.Router = Router;
