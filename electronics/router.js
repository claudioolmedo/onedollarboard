

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
  }
};

window.Router = Router;
