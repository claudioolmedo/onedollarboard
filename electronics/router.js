

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
    
    
    const netElts = elements.filter(el => {
      if (el.net === netName) return true;
      if (typeof window.getPadNet === 'function' && (el.type === 'pad' || el.type === 'hole')) {
        return window.getPadNet(el) === netName;
      }
      return false;
    });

    if (netElts.length === 0) return [];

    const dsu = new Router.DSU(netElts.length);
    const EPS = 0.01; 

    function isPointAt(px, py, el) {
      if (el.type === 'pad' || el.type === 'hole' || el.type === 'via') {
        return Math.hypot(px - el.x, py - el.y) < EPS;
      }
      if (el.type === 'trace' && el.pts) {
        return el.pts.some(p => Math.hypot(px - p.x, py - p.y) < EPS);
      }
      return false;
    }

    
    for (let i = 0; i < netElts.length; i++) {
      const e1 = netElts[i];
      for (let j = i + 1; j < netElts.length; j++) {
        const e2 = netElts[j];
        
        let connected = false;

        
        if (e1.type === 'trace' && e2.type === 'trace') {
          connected = e1.pts.some(p => isPointAt(p.x, p.y, e2));
        } 
        
        else if (e1.type === 'trace') {
          connected = isPointAt(e2.x, e2.y, e1);
        }
        else if (e2.type === 'trace') {
          connected = isPointAt(e1.x, e1.y, e2);
        }
        
        else {
          connected = Math.hypot(e1.x - e2.x, e1.y - e2.y) < EPS;
        }

        if (connected) dsu.union(i, j);
      }
    }

    
    const islandsMap = new Map();
    netElts.forEach((el, idx) => {
      const root = dsu.find(idx);
      if (!islandsMap.has(root)) islandsMap.set(root, []);
      islandsMap.get(root).push(el);
    });

    return Array.from(islandsMap.values());
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
