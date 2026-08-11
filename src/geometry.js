// UMLOne — pure geometry. No DOM, no document, no state: everything here takes plain
// numbers and returns plain numbers, which is why it is also the easiest part to test.

(function (ns) {
  'use strict';

  function rect(x, y, w, h) {
    return { x: x, y: y, w: w, h: h };
  }

  function center(r) {
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }

  function contains(r, p) {
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  }

  function containsRect(outer, inner) {
    return inner.x >= outer.x &&
           inner.y >= outer.y &&
           inner.x + inner.w <= outer.x + outer.w &&
           inner.y + inner.h <= outer.y + outer.h;
  }

  function intersects(a, b) {
    return !(b.x > a.x + a.w || b.x + b.w < a.x || b.y > a.y + a.h || b.y + b.h < a.y);
  }

  function expand(r, by) {
    return rect(r.x - by, r.y - by, r.w + by * 2, r.h + by * 2);
  }

  // Rect spanning two arbitrary corners — used by marquee select and by drag-to-create,
  // where the second point can be above/left of the first.
  function fromPoints(a, b) {
    return rect(Math.min(a.x, b.x), Math.min(a.y, b.y),
                Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  }

  function union(rects) {
    if (!rects.length) { return null; }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    rects.forEach(function (r) {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w);
      maxY = Math.max(maxY, r.y + r.h);
    });
    return rect(minX, minY, maxX - minX, maxY - minY);
  }

  // Where the ray from the rect's centre towards `toward` crosses the rect's border.
  //
  // This is what keeps edges glued to boxes: endpoints are never stored, they are
  // recomputed from the current rect every time we draw. Move a box and its edges follow
  // with no stored state to update.
  function borderPoint(r, toward) {
    var c = center(r);
    var dx = toward.x - c.x;
    var dy = toward.y - c.y;

    if (dx === 0 && dy === 0) {
      return c; // degenerate: fully concentric, nothing sensible to pick
    }

    var scaleX = dx === 0 ? Infinity : (r.w / 2) / Math.abs(dx);
    var scaleY = dy === 0 ? Infinity : (r.h / 2) / Math.abs(dy);
    var scale = Math.min(scaleX, scaleY);

    return { x: c.x + dx * scale, y: c.y + dy * scale };
  }

  // A relationship from an element to itself has no meaningful centre-to-centre
  // direction, so the general router would collapse it to a zero-length line. Self-loops
  // get their own explicit path off the top-right corner instead.
  function selfLoopPoints(r, reach) {
    var out = reach || 34;
    var x1 = r.x + r.w * 0.72;
    var x2 = r.x + r.w + out;
    var y1 = r.y - out;
    var y2 = r.y + r.h * 0.28;
    return [
      { x: x1, y: r.y },
      { x: x1, y: y1 },
      { x: x2, y: y1 },
      { x: x2, y: y2 },
      { x: r.x + r.w, y: y2 }
    ];
  }

  function distance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  // Perpendicular distance from p to segment ab, clamped to the segment. Used for edge
  // hit-testing and for deciding which segment a new bend point belongs to.
  function distanceToSegment(p, a, b) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var lengthSq = dx * dx + dy * dy;

    if (lengthSq === 0) {
      return distance(p, a);
    }

    var t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));
    return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
  }

  function distanceToPolyline(p, points) {
    var best = Infinity;
    for (var i = 0; i < points.length - 1; i++) {
      best = Math.min(best, distanceToSegment(p, points[i], points[i + 1]));
    }
    return best;
  }

  // Index of the segment nearest to p, so an inserted waypoint lands in the right place
  // in the list rather than at the end.
  function nearestSegmentIndex(p, points) {
    var best = Infinity;
    var bestIndex = 0;
    for (var i = 0; i < points.length - 1; i++) {
      var d = distanceToSegment(p, points[i], points[i + 1]);
      if (d < best) {
        best = d;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  function polylineLength(points) {
    var total = 0;
    for (var i = 0; i < points.length - 1; i++) {
      total += distance(points[i], points[i + 1]);
    }
    return total;
  }

  // Point at `t` (0..1) along a polyline, plus the direction there — labels need both a
  // position and, for the arrowheads, an angle.
  function pointAt(points, t) {
    if (points.length === 0) { return { x: 0, y: 0, angle: 0 }; }
    if (points.length === 1) { return { x: points[0].x, y: points[0].y, angle: 0 }; }

    var target = polylineLength(points) * Math.max(0, Math.min(1, t));
    var travelled = 0;

    for (var i = 0; i < points.length - 1; i++) {
      var a = points[i];
      var b = points[i + 1];
      var segment = distance(a, b);

      if (travelled + segment >= target || i === points.length - 2) {
        var local = segment === 0 ? 0 : (target - travelled) / segment;
        local = Math.max(0, Math.min(1, local));
        return {
          x: a.x + (b.x - a.x) * local,
          y: a.y + (b.y - a.y) * local,
          angle: Math.atan2(b.y - a.y, b.x - a.x)
        };
      }
      travelled += segment;
    }

    var last = points[points.length - 1];
    return { x: last.x, y: last.y, angle: 0 };
  }

  // Offset a point perpendicular to a direction. Multiplicity labels sit beside the line,
  // not on it.
  function offsetPerpendicular(point, angle, by) {
    return {
      x: point.x + Math.cos(angle + Math.PI / 2) * by,
      y: point.y + Math.sin(angle + Math.PI / 2) * by
    };
  }

  function snap(value, grid) {
    return grid > 0 ? Math.round(value / grid) * grid : value;
  }

  ns.geometry = {
    rect: rect,
    center: center,
    contains: contains,
    containsRect: containsRect,
    intersects: intersects,
    expand: expand,
    fromPoints: fromPoints,
    union: union,
    borderPoint: borderPoint,
    selfLoopPoints: selfLoopPoints,
    distance: distance,
    distanceToSegment: distanceToSegment,
    distanceToPolyline: distanceToPolyline,
    nearestSegmentIndex: nearestSegmentIndex,
    polylineLength: polylineLength,
    pointAt: pointAt,
    offsetPerpendicular: offsetPerpendicular,
    snap: snap
  };
})(UMLOne);
