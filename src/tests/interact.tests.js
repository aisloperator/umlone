(function (ns) {
  'use strict';

  T.group('double-click detection');

  // Regression cover for a bug that made in-place editing completely unreachable in
  // Firefox: drawing is a full rebuild, so selecting a node destroyed and recreated the
  // element the first click landed on, and a `dblclick` event only fires when both clicks
  // share a target. Recognition now happens at pointerdown, from captured coordinates,
  // and must not depend on any DOM surviving between the two presses.

  var isDouble = ns.interact.isDoublePress;

  function press(overrides) {
    var base = { time: 1000, x: 100, y: 100, nodeId: 'n1', edgeId: null };
    Object.keys(overrides || {}).forEach(function (k) { base[k] = overrides[k]; });
    return base;
  }

  T.test('two quick presses in the same spot on the same node are a double-click', function () {
    T.eq(isDouble(press(), press({ time: 1200 })), true);
  });

  T.test('a slow second press is not', function () {
    T.eq(isDouble(press(), press({ time: 1000 + ns.interact.DOUBLE_CLICK_MS + 1 })), false);
  });

  T.test('a press exactly at the time limit still counts', function () {
    T.eq(isDouble(press(), press({ time: 1000 + ns.interact.DOUBLE_CLICK_MS })), true);
  });

  T.test('a second press too far away is not a double-click', function () {
    var far = ns.interact.DOUBLE_CLICK_SLOP + 1;
    T.eq(isDouble(press(), press({ time: 1100, x: 100 + far })), false);
    T.eq(isDouble(press(), press({ time: 1100, y: 100 + far })), false);
  });

  T.test('small jitter between the two presses is tolerated', function () {
    T.eq(isDouble(press(), press({ time: 1100, x: 102, y: 103 })), true);
  });

  T.test('presses on different nodes are not a double-click', function () {
    T.eq(isDouble(press(), press({ time: 1100, nodeId: 'n2' })), false);
  });

  T.test('presses on different edges are not a double-click', function () {
    var first = press({ nodeId: null, edgeId: 'g1' });
    T.eq(isDouble(first, press({ time: 1100, nodeId: null, edgeId: 'g2' })), false);
    T.eq(isDouble(first, press({ time: 1100, nodeId: null, edgeId: 'g1' })), true);
  });

  T.test('moving from a node to empty canvas is not a double-click', function () {
    T.eq(isDouble(press(), press({ time: 1100, nodeId: null })), false);
  });

  T.test('the first press of all has nothing to pair with', function () {
    T.eq(isDouble(null, press()), false);
  });

  T.test('a drag ends far from where it began, so the next press stands alone', function () {
    var down = press({ time: 1000, x: 100, y: 100 });
    var afterDrag = press({ time: 1200, x: 300, y: 260 });
    T.eq(isDouble(down, afterDrag), false,
         'no separate drag bookkeeping is needed; distance covers it');
  });

  // --- zoom ------------------------------------------------------------------

  T.group('zoom');

  // A real element with real layout: the zoom maths reads getBoundingClientRect, which is
  // zero-sized for anything the browser has not laid out.
  function zoomSetup() {
    var host = document.createElement('div');
    host.style.position = 'relative';
    host.style.width = '600px';
    host.style.height = '400px';
    document.getElementById('sandbox').appendChild(host);

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.width = '600px';
    svg.style.height = '400px';
    host.appendChild(svg);

    var interactions = ns.interact.create({
      svg: svg,
      host: host,
      store: new ns.commands.Store(ns.testFixture()),
      onRender: function () {}
    });

    return interactions;
  }

  // What the middle of the view is looking at, in diagram coordinates.
  function centreOfView(interactions) {
    var view = interactions.state.viewport;
    return {
      x: (300 - view.x) / view.scale,
      y: (200 - view.y) / view.scale
    };
  }

  T.test('zoomTo(1) returns to 100% from either direction', function () {
    var a = zoomSetup();
    a.zoomBy(2.5);
    a.zoomTo(1);
    T.eq(a.state.viewport.scale, 1);

    var b = zoomSetup();
    b.zoomBy(1 / 2.5);
    b.zoomTo(1);
    T.eq(b.state.viewport.scale, 1);
  });

  T.test('resetting to 100% keeps the middle of the view on the same spot', function () {
    var interactions = zoomSetup();
    interactions.zoomBy(2);
    var before = centreOfView(interactions);
    interactions.zoomTo(1);
    var after = centreOfView(interactions);

    // Half a pixel of slack, not none: settling on a view snaps it to the pixel grid.
    T.near(after.x, before.x, 0.5, 'the view must not jump sideways on reset');
    T.near(after.y, before.y, 0.5);
  });

  // A 1px border centred on a whole pixel is drawn as two half-lit rows; centred on a
  // boundary it covers one row solidly. Diagram coordinates are whole numbers, so a
  // viewport on a half pixel is the difference between a box with edges and a box with
  // smudges — which is what came back from Fit followed by 1:1 before this.
  function isAligned(view) {
    return Math.abs(view.x - (Math.round(view.x - 0.5) + 0.5)) < 1e-9 &&
           Math.abs(view.y - (Math.round(view.y - 0.5) + 0.5)) < 1e-9;
  }

  T.test('alignToPixels lands on a half pixel, moving by at most half a pixel', function () {
    [0, 40, -619.5, 220.4375, 168, 1e6 + 0.31].forEach(function (v) {
      var aligned = ns.interact.alignToPixels({ x: v, y: -v });
      T.eq(isAligned(aligned), true, v + ' did not land on a half pixel');
      T.eq(Math.abs(aligned.x - v) <= 0.5, true, v + ' moved more than half a pixel');
    });
  });

  T.test('a fresh viewport is already aligned', function () {
    T.eq(isAligned(zoomSetup().state.viewport), true);
  });

  T.test('Fit leaves the viewport aligned', function () {
    var interactions = zoomSetup();
    interactions.fitToContent();
    T.eq(isAligned(interactions.state.viewport), true);
  });

  // The reported bug: Fit divides the leftover space in half and multiplies by the scale
  // it chose, leaving an offset with an arbitrary fraction. Restoring the scale does not
  // restore the offset, so the box came back at a true 100% with washed-out edges.
  T.test('1:1 after Fit leaves the viewport aligned', function () {
    var interactions = zoomSetup();
    interactions.fitToContent();
    interactions.zoomTo(1);

    T.eq(interactions.state.viewport.scale, 1);
    T.eq(isAligned(interactions.state.viewport), true,
         'a true 100% still draws badly if the pan offset is a quarter of a pixel');
  });

  T.test('the zoom buttons leave the viewport aligned too', function () {
    var interactions = zoomSetup();
    interactions.fitToContent();
    interactions.zoomBy(1.2);
    T.eq(isAligned(interactions.state.viewport), true);
    interactions.zoomBy(1 / 1.2);
    T.eq(isAligned(interactions.state.viewport), true);
  });

  T.test('zoomTo is clamped like every other zoom', function () {
    var interactions = zoomSetup();
    interactions.zoomTo(1000);
    T.eq(interactions.state.viewport.scale <= 4, true);
    interactions.zoomTo(0.0001);
    T.eq(interactions.state.viewport.scale >= 0.2, true);
  });

  T.test('Ctrl+0 resets the zoom', function () {
    var interactions = zoomSetup();
    interactions.zoomBy(2);
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: '0', ctrlKey: true, bubbles: true, cancelable: true
    }));
    T.eq(interactions.state.viewport.scale, 1);
  });
})(UMLOne);
