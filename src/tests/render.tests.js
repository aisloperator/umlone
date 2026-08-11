(function (ns) {
  'use strict';

  T.group('layout and rendering');

  function fixture() { return ns.testFixture(); }

  function emptyState() {
    return {
      viewport: { x: 0, y: 0, scale: 1 },
      selectedNodes: {},
      selectedEdges: {}
    };
  }

  function drawFixture(doc, state) {
    var svg = document.createElementNS(ns.SVG_NS, 'svg');
    svg.setAttribute('width', '1200');
    svg.setAttribute('height', '900');
    document.getElementById('sandbox').appendChild(svg);
    ns.render.draw(svg, doc, doc.diagrams[0], state || emptyState());
    return svg;
  }

  function textsIn(svg) {
    return Array.prototype.slice.call(svg.querySelectorAll('text'))
      .map(function (el) { return el.textContent; });
  }

  T.test('measurement returns a positive width that grows with the string', function () {
    var short = ns.measure.width('A', 'member');
    var long = ns.measure.width('AAAAAAAAAAAAAAAAAAAA', 'member');
    T.ok(short > 0, 'a single character has width');
    T.ok(long > short * 5, 'twenty characters are much wider than one');
  });

  T.test('measurement of the empty string is zero', function () {
    T.eq(ns.measure.width('', 'member'), 0);
  });

  T.test('wrap breaks text to the given width', function () {
    var lines = ns.measure.wrap('the quick brown fox jumps over the lazy dog',
                                'comment', 80);
    T.ok(lines.length > 1, 'should need several lines');
    lines.forEach(function (line) {
      T.ok(line.length > 0, 'no empty lines');
    });
    T.eq(lines.join(' '), 'the quick brown fox jumps over the lazy dog',
         'no words lost or reordered');
  });

  T.test('a class lays out as header plus attributes plus operations', function () {
    var doc = fixture();
    var info = ns.render.layout(doc, ns.model.findElement(doc, 'c1'),
                                ns.diagram.nodeForElement(doc.diagrams[0], 'c1'));
    T.eq(info.bands.length, 3, 'header, attributes, operations');
    T.eq(info.bands[0].align, 'middle', 'the header is centred');
    T.eq(info.bands[1].align, 'start', 'members are left aligned');
  });

  T.test('hiding a compartment removes its band', function () {
    var doc = fixture();
    var node = ns.diagram.nodeForElement(doc.diagrams[0], 'c1');
    node.show.attributes = false;

    var info = ns.render.layout(doc, ns.model.findElement(doc, 'c1'), node);
    T.eq(info.bands.length, 2, 'header and operations only');
  });

  T.test('an interface announces itself in its header', function () {
    var doc = fixture();
    var info = ns.render.layout(doc, ns.model.findElement(doc, 'i1'), null);
    T.eq(info.bands[0].lines[0].text, '«interface»');
    T.eq(info.bands[0].lines[1].text, 'Payable');
  });

  T.test('an enumeration announces itself and lists its literals', function () {
    var doc = fixture();
    var info = ns.render.layout(doc, ns.model.findElement(doc, 'n1'), null);
    T.eq(info.bands[0].lines[0].text, '«enumeration»');
    T.deepEq(info.bands[1].lines.map(function (l) { return l.text; }),
             ['OPEN', 'SHIPPED']);
  });

  T.test('a stereotyped class shows its stereotype above the name', function () {
    var doc = fixture();
    var info = ns.render.layout(doc, ns.model.findElement(doc, 'c1'), null);
    T.eq(info.bands[0].lines[0].text, '«entity»');
    T.eq(info.bands[0].lines[1].text, 'Order');
  });

  T.test('an abstract class is rendered in italic', function () {
    var doc = fixture();
    ns.model.findElement(doc, 'c1').isAbstract = true;
    var info = ns.render.layout(doc, ns.model.findElement(doc, 'c1'), null);
    var nameLine = info.bands[0].lines[1];
    T.eq(nameLine.font, 'nameItalic');
    T.ok(nameLine.cls.indexOf('abstract') >= 0);
  });

  T.test('preferredSize is wide enough for the longest line', function () {
    var doc = fixture();
    var element = ns.model.findElement(doc, 'c1');
    var size = ns.render.preferredSize(doc, element, null);

    var longest = ns.measure.width(
      ns.model.formatOperation(element.operations[0]), 'member');

    T.ok(size.w >= longest, 'box must fit its widest member');
    T.ok(size.h >= 3 * ns.measure.LINE_HEIGHT, 'and be tall enough for the rows');
  });

  T.test('preferredSize never returns less than the minimum node size', function () {
    var doc = ns.model.createDocument();
    var element = ns.model.addElement(doc,
      ns.model.createElement('class', { id: 'z', name: '' }));
    var size = ns.render.preferredSize(doc, element, null);
    T.ok(size.w >= ns.validate.MIN_NODE_W);
    T.ok(size.h >= ns.validate.MIN_NODE_H);
  });

  T.test('a longer name produces a wider preferred size', function () {
    var doc = ns.model.createDocument();
    var element = ns.model.addElement(doc,
      ns.model.createElement('class', { id: 'z', name: 'A' }));
    var narrow = ns.render.preferredSize(doc, element, null).w;

    element.name = 'AVeryLongClassNameIndeedYesReally';
    var wide = ns.render.preferredSize(doc, element, null).w;

    T.ok(wide > narrow, 'expected the wider name to need a wider box');
  });

  T.test('draw emits one group per node and per edge', function () {
    var doc = fixture();
    var svg = drawFixture(doc);
    T.eq(svg.querySelectorAll('.node').length, doc.diagrams[0].nodes.length);
    T.eq(svg.querySelectorAll('.edge').length, doc.diagrams[0].edges.length);
  });

  T.test('every drawn node carries the ids hit-testing relies on', function () {
    var doc = fixture();
    var svg = drawFixture(doc);
    Array.prototype.slice.call(svg.querySelectorAll('.node')).forEach(function (group) {
      T.ok(group.getAttribute('data-node-id'), 'node id attribute missing');
      T.ok(group.getAttribute('data-element-id'), 'element id attribute missing');
    });
    Array.prototype.slice.call(svg.querySelectorAll('.edge')).forEach(function (group) {
      T.ok(group.getAttribute('data-edge-id'), 'edge id attribute missing');
    });
  });

  T.test('every edge gets a fat invisible stroke to click on', function () {
    var doc = fixture();
    var svg = drawFixture(doc);
    T.eq(svg.querySelectorAll('.edge-hit').length, doc.diagrams[0].edges.length);
  });

  T.test('clip path ids are unique across the drawing', function () {
    var doc = fixture();
    var svg = drawFixture(doc);
    var ids = Array.prototype.slice.call(svg.querySelectorAll('clipPath'))
      .map(function (el) { return el.id; });
    var unique = {};
    ids.forEach(function (id) { unique[id] = true; });
    T.eq(Object.keys(unique).length, ids.length, 'duplicate clipPath id would misclip');
  });

  T.test('a realization is dashed and a composition is not', function () {
    var doc = fixture();
    var svg = drawFixture(doc);

    var realization = svg.querySelector('[data-relationship-id="r2"] .edge-line');
    var composition = svg.querySelector('[data-relationship-id="r1"] .edge-line');

    T.ok(realization.getAttribute('class').indexOf('edge-dashed') >= 0,
         'realization should be dashed');
    T.eq(composition.getAttribute('class').indexOf('edge-dashed'), -1,
         'composition should be solid');
  });

  T.test('a composition draws a filled diamond at the whole end', function () {
    var doc = fixture();
    var svg = drawFixture(doc);
    var decoration = svg.querySelector('[data-relationship-id="r1"] .edge-decoration');
    T.ok(decoration, 'expected a decoration');
    T.ok(decoration.getAttribute('class').indexOf('filled') >= 0);
  });

  T.test('a realization draws a hollow triangle at the interface end', function () {
    var doc = fixture();
    var svg = drawFixture(doc);
    var decoration = svg.querySelector('[data-relationship-id="r2"] polygon');
    T.ok(decoration, 'expected a triangle');
    T.ok(decoration.getAttribute('class').indexOf('hollow') >= 0);
  });

  T.test('an annotation link has no arrowhead', function () {
    var doc = fixture();
    var svg = drawFixture(doc);
    T.eq(svg.querySelectorAll('[data-relationship-id="r3"] .edge-decoration').length, 0);
  });

  T.test('role and multiplicity labels are drawn for a composition', function () {
    var doc = fixture();
    var svg = drawFixture(doc);
    var labels = Array.prototype.slice.call(
      svg.querySelectorAll('[data-relationship-id="r1"] .edge-label'))
      .map(function (el) { return el.textContent; });

    T.ok(labels.indexOf('lines') >= 0, 'role should be shown');
    T.ok(labels.indexOf('1..*') >= 0, 'multiplicity should be shown');
  });

  T.test('a realization shows no role labels, because it has no ends to name', function () {
    var doc = fixture();
    var svg = drawFixture(doc);
    T.eq(svg.querySelectorAll('[data-relationship-id="r2"] .edge-label').length, 0);
  });

  T.test('class member text reaches the canvas', function () {
    var doc = fixture();
    var texts = textsIn(drawFixture(doc));
    T.ok(texts.indexOf('Order') >= 0, 'class name');
    T.ok(texts.indexOf('- /total: Money [0..1]') >= 0, 'attribute line');
    T.ok(texts.indexOf('+ recalculate(policy: TaxPolicy): void') >= 0, 'operation line');
  });

  T.test('selection draws resize handles', function () {
    var doc = fixture();
    var state = emptyState();
    var node = ns.diagram.nodeForElement(doc.diagrams[0], 'c1');
    state.selectedNodes[node.id] = true;

    var svg = drawFixture(doc, state);
    T.eq(svg.querySelectorAll('.handle').length, 8, 'eight resize handles');
    T.ok(svg.querySelector('.node.selected'), 'the node is marked selected');
  });

  T.test('selecting an edge draws a handle per bend point', function () {
    var doc = fixture();
    var state = emptyState();
    var edge = ns.diagram.edgeForRelationship(doc.diagrams[0], 'r1');
    state.selectedEdges[edge.id] = true;

    var svg = drawFixture(doc, state);
    T.eq(svg.querySelectorAll('.handle.waypoint').length, edge.waypoints.length);
  });

  T.test('the viewport transform is applied once, at the root', function () {
    var doc = fixture();
    var state = emptyState();
    state.viewport = { x: 25, y: 35, scale: 2 };

    var svg = drawFixture(doc, state);
    var root = svg.firstChild;
    T.eq(root.getAttribute('transform'), 'translate(25,35) scale(2)');
  });

  T.test('drawing twice does not accumulate elements', function () {
    var doc = fixture();
    var svg = drawFixture(doc);
    var first = svg.querySelectorAll('.node').length;

    ns.render.draw(svg, doc, doc.diagrams[0], emptyState());
    T.eq(svg.querySelectorAll('.node').length, first, 'redraw must replace, not append');
  });

  T.test('drawing with no diagram leaves an empty canvas', function () {
    var svg = document.createElementNS(ns.SVG_NS, 'svg');
    ns.render.draw(svg, ns.model.createDocument(), null, emptyState());
    T.eq(svg.childNodes.length, 0);
  });
})(UMLOne);
