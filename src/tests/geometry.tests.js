(function (ns) {
  'use strict';

  var geo = ns.geometry;
  T.group('geometry');

  T.test('borderPoint leaves through the right edge for a horizontal neighbour', function () {
    var box = geo.rect(0, 0, 100, 50);          // centre (50, 25)
    var p = geo.borderPoint(box, { x: 500, y: 25 });
    T.near(p.x, 100, 0.001, 'should exit at the right edge');
    T.near(p.y, 25, 0.001, 'should stay on the centre line');
  });

  T.test('borderPoint leaves through the top edge for a vertical neighbour', function () {
    var box = geo.rect(0, 0, 100, 50);
    var p = geo.borderPoint(box, { x: 50, y: -500 });
    T.near(p.x, 50);
    T.near(p.y, 0, 0.001, 'should exit at the top edge');
  });

  T.test('borderPoint hits the corner on the box diagonal', function () {
    var box = geo.rect(0, 0, 100, 100);
    var p = geo.borderPoint(box, { x: 1000, y: 1000 });
    T.near(p.x, 100);
    T.near(p.y, 100);
  });

  T.test('borderPoint on a concentric point does not produce NaN', function () {
    var box = geo.rect(0, 0, 100, 50);
    var p = geo.borderPoint(box, { x: 50, y: 25 });
    T.ok(isFinite(p.x) && isFinite(p.y), 'coordinates stay finite');
  });

  T.test('self-loop points leave and return to the box', function () {
    var box = geo.rect(0, 0, 100, 60);
    var points = ns.geometry.selfLoopPoints(box);
    T.ok(points.length >= 4, 'has enough points to form a loop');
    T.ok(geo.polylineLength(points) > 0, 'has non-zero length');
    var outside = points.some(function (p) {
      return !geo.contains(box, p);
    });
    T.ok(outside, 'the loop travels outside the box');
  });

  T.test('distanceToSegment clamps to the segment ends', function () {
    var a = { x: 0, y: 0 };
    var b = { x: 10, y: 0 };
    T.near(geo.distanceToSegment({ x: 5, y: 3 }, a, b), 3);
    T.near(geo.distanceToSegment({ x: -4, y: 0 }, a, b), 4, 0.001,
           'beyond the start clamps to the start');
    T.near(geo.distanceToSegment({ x: 14, y: 0 }, a, b), 4, 0.001,
           'beyond the end clamps to the end');
  });

  T.test('distanceToSegment survives a zero-length segment', function () {
    var a = { x: 3, y: 4 };
    T.near(geo.distanceToSegment({ x: 0, y: 0 }, a, a), 5);
  });

  T.test('nearestSegmentIndex picks the segment the point sits beside', function () {
    var points = [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 100 }
    ];
    T.eq(geo.nearestSegmentIndex({ x: 50, y: 2 }, points), 0);
    T.eq(geo.nearestSegmentIndex({ x: 98, y: 50 }, points), 1);
    T.eq(geo.nearestSegmentIndex({ x: 150, y: 102 }, points), 2);
  });

  T.test('pointAt walks the whole polyline', function () {
    var points = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    T.near(geo.pointAt(points, 0).x, 0);
    T.near(geo.pointAt(points, 0.5).x, 50);
    T.near(geo.pointAt(points, 1).x, 100);
  });

  T.test('pointAt clamps t outside 0..1', function () {
    var points = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    T.near(geo.pointAt(points, -5).x, 0);
    T.near(geo.pointAt(points, 5).x, 100);
  });

  T.test('fromPoints normalises a rectangle dragged up and to the left', function () {
    var r = geo.fromPoints({ x: 100, y: 100 }, { x: 40, y: 20 });
    T.eq(r.x, 40);
    T.eq(r.y, 20);
    T.eq(r.w, 60);
    T.eq(r.h, 80);
  });

  T.test('containsRect is strict about edges', function () {
    var outer = geo.rect(0, 0, 100, 100);
    T.ok(geo.containsRect(outer, geo.rect(10, 10, 50, 50)));
    T.ok(geo.containsRect(outer, geo.rect(0, 0, 100, 100)), 'exact fit counts');
    T.ok(!geo.containsRect(outer, geo.rect(60, 60, 50, 50)), 'overhang does not');
  });

  T.test('intersects detects only real overlap', function () {
    var a = geo.rect(0, 0, 10, 10);
    T.ok(geo.intersects(a, geo.rect(5, 5, 10, 10)));
    T.ok(!geo.intersects(a, geo.rect(20, 20, 5, 5)));
  });

  T.test('union spans every rect given', function () {
    var box = geo.union([geo.rect(10, 10, 10, 10), geo.rect(100, 50, 20, 20)]);
    T.eq(box.x, 10);
    T.eq(box.y, 10);
    T.eq(box.w, 110);
    T.eq(box.h, 60);
  });

  T.test('snap rounds to the grid and passes through when the grid is zero', function () {
    T.eq(geo.snap(13, 5), 15);
    T.eq(geo.snap(12, 5), 10);
    T.eq(geo.snap(12.3, 0), 12.3);
  });
})(UMLOne);
