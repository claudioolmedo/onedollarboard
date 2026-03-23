

const Router = {
  
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
    const EPS = 0.1; 

    const isConnected = (e1, e2) => {
      
      if (e1.type === 'trace' && (e2.type === 'pad' || e2.type === 'via' || e2.type === 'hole')) {
        for (let i = 0; i < e1.pts.length - 1; i++) {
          if (this.distPtToSeg(e2.x, e2.y, e1.pts[i].x, e1.pts[i].y, e1.pts[i+1].x, e1.pts[i+1].y) < (e1.width/2 + EPS)) return true;
        }
        
        return e1.pts.some(p => Math.hypot(p.x - e2.x, p.y - e2.y) < EPS);
      }
      if (e2.type === 'trace' && (e1.type === 'pad' || e1.type === 'via' || e1.type === 'hole')) return isConnected(e2, e1);
      
      
      if (e1.type === 'trace' && e2.type === 'trace') {
        for (let i = 0; i < e1.pts.length - 1; i++) {
          for (let j = 0; j < e2.pts.length - 1; j++) {
            if (this.distSegToSeg(e1.pts[i].x, e1.pts[i].y, e1.pts[i+1].x, e1.pts[i+1].y,
                                 e2.pts[j].x, e2.pts[j].y, e2.pts[j+1].x, e2.pts[j+1].y) < EPS) return true;
          }
        }
        return false;
      }

      
      const dx = e1.x - e2.x, dy = e1.y - e2.y;
      return (dx * dx + dy * dy) < (EPS * EPS);
    };

    
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

            if (el.type === 'pad' || el.type === 'via') {
                dist = this.distPtToSeg(el.x, el.y, p1.x, p1.y, p2.x, p2.y);
                radius = (el.pad || el.w || 1.0) / 2;
            } else if (el.type === 'trace') {
                for (let j = 0; j < el.pts.length - 1; j++) {
                    const e1 = el.pts[j], e2 = el.pts[j+1];
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
