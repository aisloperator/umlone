(function (ns) {
  'use strict';

  T.group('automatic layout');

  // Small purpose-built documents. The shared fixture is a fair test of a whole diagram,
  // but a claim about where a supertype goes is easier to trust when the document contains
  // exactly one supertype.
  function build(spec) {
    var doc = ns.model.createDocument();
    var diagram = ns.diagram.createDiagram('Main');
    doc.diagrams.push(diagram);

    spec.elements.forEach(function (item) {
      ns.model.addElement(doc, ns.model.createElement(item.kind || 'class', {
        id: item.id,
        name: item.name || item.id,
        owner: item.owner || null
      }));
    });

    (spec.relationships || []).forEach(function (rel, index) {
      ns.model.addRelationship(doc,
        ns.model.createRelationship(rel.kind, rel.from, rel.to, { id: 'rel' + index }));
    });

    // All at the same place, so nothing about the result can be inherited from where the
    // boxes started.
    spec.elements.forEach(function (item) {
      ns.diagram.addNode(diagram, ns.model.findElement(doc, item.id),
                         0, 0, item.w || 120, item.h || 60);
    });

    ns.diagram.syncEdges(doc, diagram);
    return doc;
  }

  function arrange(doc) {
    return ns.layout.arrange(doc, doc.diagrams[0]);
  }

  function at(doc, result, elementId) {
    return result[ns.diagram.nodeForElement(doc.diagrams[0], elementId).id];
  }

  function overlap(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w &&
           a.y < b.y + b.h && b.y < a.y + a.h;
  }

  function encloses(outer, inner) {
    return inner.x >= outer.x && inner.y >= outer.y &&
           inner.x + inner.w <= outer.x + outer.w &&
           inner.y + inner.h <= outer.y + outer.h;
  }

  // --- what inheritance decides ----------------------------------------------

  T.test('every box on the diagram is given a place', function () {
    var doc = build({ elements: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
    T.eq(Object.keys(arrange(doc)).length, 3);
  });

  T.test('a supertype is drawn above its subtypes', function () {
    var doc = build({
      elements: [{ id: 'shape' }, { id: 'circle' }, { id: 'square' }],
      relationships: [
        { kind: 'generalization', from: 'circle', to: 'shape' },
        { kind: 'generalization', from: 'square', to: 'shape' }
      ]
    });
    var result = arrange(doc);

    T.eq(at(doc, result, 'shape').y < at(doc, result, 'circle').y, true,
         'the supertype ended up level with or below its subtype');
    T.eq(at(doc, result, 'shape').y < at(doc, result, 'square').y, true);
  });

  T.test('subtypes of the same supertype share a row', function () {
    var doc = build({
      elements: [{ id: 'shape' }, { id: 'circle' }, { id: 'square' }],
      relationships: [
        { kind: 'generalization', from: 'circle', to: 'shape' },
        { kind: 'generalization', from: 'square', to: 'shape' }
      ]
    });
    var result = arrange(doc);

    T.eq(at(doc, result, 'circle').y, at(doc, result, 'square').y);
    T.eq(overlap(at(doc, result, 'circle'), at(doc, result, 'square')), false,
         'two boxes in the same row were placed on top of each other');
  });

  T.test('a chain of inheritance gets a row each, deepest last', function () {
    var doc = build({
      elements: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      relationships: [
        { kind: 'generalization', from: 'b', to: 'a' },
        { kind: 'generalization', from: 'c', to: 'b' }
      ]
    });
    var result = arrange(doc);

    T.eq(at(doc, result, 'a').y < at(doc, result, 'b').y, true);
    T.eq(at(doc, result, 'b').y < at(doc, result, 'c').y, true);
  });

  // A class that both implements an interface and inherits from a base belongs below both,
  // not one row under the first one found.
  T.test('a box sits below its deepest supertype, not its nearest', function () {
    var doc = build({
      elements: [{ id: 'top' }, { id: 'middle' }, { id: 'other' }, { id: 'leaf' }],
      relationships: [
        { kind: 'generalization', from: 'middle', to: 'top' },
        { kind: 'generalization', from: 'leaf', to: 'middle' },
        { kind: 'generalization', from: 'leaf', to: 'other' }
      ]
    });
    var result = arrange(doc);

    T.eq(at(doc, result, 'leaf').y > at(doc, result, 'middle').y, true);
    T.eq(at(doc, result, 'leaf').y > at(doc, result, 'other').y, true);
  });

  T.test('realization counts as inheritance, association does not', function () {
    var doc = build({
      elements: [{ id: 'iface', kind: 'interface' }, { id: 'impl' }],
      relationships: [{ kind: 'realization', from: 'impl', to: 'iface' }]
    });
    var result = arrange(doc);
    T.eq(at(doc, result, 'iface').y < at(doc, result, 'impl').y, true);

    var flat = build({
      elements: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      relationships: [
        { kind: 'association', from: 'a', to: 'b' },
        { kind: 'association', from: 'b', to: 'c' }
      ]
    });
    var arranged = arrange(flat);
    var ys = ['a', 'b', 'c'].map(function (id) { return at(flat, arranged, id).y; });

    T.eq(ys[0] === ys[1] && ys[1] === ys[2], false,
         'associations were treated as a hierarchy would be, or as nothing at all');
  });

  // --- the invariants that make a picture readable ---------------------------

  T.test('no two boxes end up on top of each other', function () {
    var doc = build({
      elements: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'lonely' }],
      relationships: [
        { kind: 'generalization', from: 'b', to: 'a' },
        { kind: 'generalization', from: 'c', to: 'a' },
        { kind: 'association', from: 'c', to: 'd' }
      ]
    });
    var result = arrange(doc);
    var boxes = Object.keys(result).map(function (id) { return result[id]; });

    boxes.forEach(function (a, i) {
      boxes.slice(i + 1).forEach(function (b) {
        T.eq(overlap(a, b), false, 'two boxes overlap');
      });
    });
  });

  T.test('an element related to nothing is still placed, clear of the rest', function () {
    var doc = build({
      elements: [{ id: 'a' }, { id: 'b' }, { id: 'lonely' }],
      relationships: [{ kind: 'generalization', from: 'b', to: 'a' }]
    });
    var result = arrange(doc);
    var lonely = at(doc, result, 'lonely');

    T.ok(lonely, 'an unconnected element was dropped');
    T.eq(overlap(lonely, at(doc, result, 'a')), false);
    T.eq(overlap(lonely, at(doc, result, 'b')), false);
  });

  T.test('everything lands on the grid', function () {
    var doc = build({
      elements: [{ id: 'a', w: 133, h: 47 }, { id: 'b', w: 91, h: 63 }],
      relationships: [{ kind: 'generalization', from: 'b', to: 'a' }]
    });
    var result = arrange(doc);

    Object.keys(result).forEach(function (id) {
      T.eq(result[id].x % 5, 0, 'x is off the grid');
      T.eq(result[id].y % 5, 0, 'y is off the grid');
    });
  });

  T.test('arranging the same diagram twice gives the same answer', function () {
    var doc = ns.testFixture();
    T.deepEq(arrange(doc), arrange(doc));
  });

  T.test('arranging changes nothing by itself', function () {
    var doc = ns.testFixture();
    var before = JSON.stringify(doc);
    arrange(doc);
    T.eq(JSON.stringify(doc), before,
         'arrange reports where boxes should go; moving them is the caller\'s job');
  });

  // Inheritance cycles cannot occur in a valid model, and a file that has one must not
  // take the editor down with it.
  T.test('a cycle of generalizations does not hang', function () {
    var doc = build({
      elements: [{ id: 'a' }, { id: 'b' }],
      relationships: [
        { kind: 'generalization', from: 'a', to: 'b' },
        { kind: 'generalization', from: 'b', to: 'a' }
      ]
    });
    var result = arrange(doc);
    T.eq(Object.keys(result).length, 2);
  });

  // --- packages ---------------------------------------------------------------

  T.test('a package is laid out around its contents', function () {
    var doc = build({
      elements: [
        { id: 'p', kind: 'package' },
        { id: 'a', owner: 'p' },
        { id: 'b', owner: 'p' },
        { id: 'outside' }
      ],
      relationships: [{ kind: 'generalization', from: 'b', to: 'a' }]
    });
    var result = arrange(doc);
    var pkg = at(doc, result, 'p');

    T.eq(encloses(pkg, at(doc, result, 'a')), true, 'a member sits outside its package');
    T.eq(encloses(pkg, at(doc, result, 'b')), true, 'a member sits outside its package');
    T.eq(overlap(pkg, at(doc, result, 'outside')), false,
         'an unrelated box was placed over the package');
  });

  T.test('a package leaves room for its own tab', function () {
    var doc = build({
      elements: [{ id: 'p', kind: 'package' }, { id: 'a', owner: 'p' }]
    });
    var result = arrange(doc);

    T.eq(at(doc, result, 'a').y >= at(doc, result, 'p').y + ns.render.PACKAGE_TAB_H, true,
         'a member was drawn over the package name');
  });

  T.test('a package grows to hold what is in it', function () {
    var doc = build({
      elements: [
        { id: 'p', kind: 'package', w: 40, h: 30 },
        { id: 'a', owner: 'p', w: 200, h: 100 }
      ]
    });
    var result = arrange(doc);
    var pkg = at(doc, result, 'p');

    T.eq(pkg.w > 200, true, 'the package stayed smaller than its contents');
    T.eq(pkg.h > 100, true);
  });

  T.test('inheritance inside a package is laid out inside it', function () {
    var doc = build({
      elements: [
        { id: 'p', kind: 'package' },
        { id: 'base', owner: 'p' },
        { id: 'sub', owner: 'p' }
      ],
      relationships: [{ kind: 'generalization', from: 'sub', to: 'base' }]
    });
    var result = arrange(doc);

    T.eq(at(doc, result, 'base').y < at(doc, result, 'sub').y, true);
    T.eq(encloses(at(doc, result, 'p'), at(doc, result, 'sub')), true);
  });

  // --- as a command ------------------------------------------------------------

  T.test('arranging is one undo step', function () {
    var doc = ns.testFixture();
    var store = new ns.commands.Store(doc);
    var node = store.currentDiagram().nodes[0];
    var was = { x: node.x, y: node.y };

    T.eq(ns.commands.autoLayout(store, store.currentDiagramId), true);
    var moved = store.currentDiagram().nodes[0];
    T.eq(moved.x !== was.x || moved.y !== was.y, true, 'nothing moved');

    store.undo();
    var back = store.currentDiagram().nodes[0];
    T.eq(back.x, was.x);
    T.eq(back.y, was.y);
    T.eq(store.canUndo(), false, 'the rearrangement left more than one thing to undo');
  });

  T.test('arranging drops the bends in the lines', function () {
    var store = new ns.commands.Store(ns.testFixture());
    var withBend = store.currentDiagram().edges.filter(function (edge) {
      return edge.waypoints.length;
    });
    T.eq(withBend.length > 0, true, 'the fixture should have a bend to drop');

    ns.commands.autoLayout(store, store.currentDiagramId);

    store.currentDiagram().edges.forEach(function (edge) {
      T.eq(edge.waypoints.length, 0,
           'a bend placed against the old positions was kept');
    });
  });

  T.test('arranging an already arranged diagram does nothing at all', function () {
    var store = new ns.commands.Store(ns.testFixture());
    ns.commands.autoLayout(store, store.currentDiagramId);

    T.eq(ns.commands.autoLayout(store, store.currentDiagramId), false,
         'pressing the button twice should not leave two things to undo');
  });

  T.test('an empty diagram is not something to undo', function () {
    var store = new ns.commands.Store(ns.model.createDocument());
    ns.commands.addDiagram(store, 'Empty');
    T.eq(ns.commands.autoLayout(store, store.currentDiagramId), false);
  });
})(UMLOne);
