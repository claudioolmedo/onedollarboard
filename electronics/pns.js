

const PNS = {
  
  MODE_WALKAROUND: 'walkaround',
  MODE_SHOVE: 'shove',
  MODE_HIGHLIGHT: 'highlight',

  
  route(p1, p2, width, elements, netName, settings = {}) {
    const clearance = settings.clearance || 0.2;
    const mode = settings.mode || this.MODE_WALKAROUND;
    const posture = settings.posture || 0; 

    
    let path = Router.getOctilinearPath(p1, p2, posture);

    if (mode === this.MODE_HIGHLIGHT) return path;

    
    if (mode === this.MODE_WALKAROUND) {
      return this.walkaround(path, width, elements, netName, clearance);
    }

    return path;
  },

  
  walkaround(path, width, elements, netName, clearance) {
    let currentPath = [...path];
    const targetNet = netName ? netName.toUpperCase() : null;
    const margin = (width / 2) + clearance;

    
    for (let iter = 0; iter < 5; iter++) {
      let collision = this.findFirstCollision(currentPath, width, elements, targetNet, clearance);
      if (!collision) break;

      
      const hull = this.getObstacleHull(collision.element, margin);
      if (!hull) break;

      
      currentPath = this.applyDetour(currentPath, collision.segmentIdx, hull);
      currentPath = this.optimizePath(currentPath);
    }

    return currentPath;
  },

  findFirstCollision(path, width, elements, targetNet, clearance) {
    for (let i = 0; i < path.length - 1; i++) {
      const p1 = path[i], p2 = path[i + 1];
      const violations = Router.getViolations([p1, p2], width, elements, targetNet, clearance);
      if (violations.length > 0) {
        const el = elements.find(e => e.id === violations[0]);
        return { segmentIdx: i, element: el };
      }
    }
    return null;
  },

  
  getObstacleHull(el, margin) {
    if (el.type === 'pad' || el.type === 'via') {
      const r = (el.pad || el.w || 1.6) / 2 + margin;
      const c = { x: el.x, y: el.y };
      
      
      const points = [];
      const s = r / Math.cos(Math.PI / 8); 
      for (let i = 0; i < 8; i++) {
        const angle = i * (Math.PI / 4) + (Math.PI / 8);
        points.push({ x: c.x + Math.cos(angle) * s, y: c.y + Math.sin(angle) * s });
      }
      return { type: 'octagon', center: c, pts: points, r: r };
    }
    return null;
  },

  
  applyDetour(path, segmentIdx, hull) {
    if (!hull || !hull.pts) return path;

    const p1 = path[segmentIdx];
    const p2 = path[segmentIdx + 1];

    
    let startIdx = -1, endIdx = -1;
    let minDist1 = Infinity, minDist2 = Infinity;

    hull.pts.forEach((pt, idx) => {
        const d1 = Math.hypot(pt.x - p1.x, pt.y - p1.y);
        const d2 = Math.hypot(pt.x - p2.x, pt.y - p2.y);
        if (d1 < minDist1) { minDist1 = d1; startIdx = idx; }
        if (d2 < minDist2) { minDist2 = d2; endIdx = idx; }
    });

    const detour = [];
    const side = (p2.x - p1.x) * (hull.center.y - p1.y) - (p2.y - p1.y) * (hull.center.x - p1.x) > 0 ? 1 : -1;

    
    let cur = startIdx;
    for (let i = 0; i < 4; i++) {
        detour.push(hull.pts[cur]);
        if (cur === endIdx) break;
        cur = (cur + side + 8) % 8;
    }

    const first = detour[0], last = detour[detour.length - 1];
    
    
    
    const entry = Router.getOctilinearPath(p1, first, 0);
    const exit = Router.getOctilinearPath(last, p2, 1);

    const newPath = [
      ...path.slice(0, segmentIdx), 
      ...entry, 
      ...detour.slice(1, -1),
      ...exit,
      ...path.slice(segmentIdx + 2)
    ];

    return this.optimizePath(newPath);
  },

  
  optimizePath(path) {
    if (path.length < 3) return path;
    const optimized = [path[0]];
    
    for (let i = 1; i < path.length - 1; i++) {
        const p1 = optimized[optimized.length - 1];
        const p2 = path[i];
        const p3 = path[i + 1];

        
        const area = Math.abs(p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
        if (area > 0.001) {
            optimized.push(p2);
        }
    }
    optimized.push(path[path.length - 1]);
    return optimized;
  }
};

window.PNS = PNS;
