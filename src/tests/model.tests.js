(function (ns) {
  'use strict';

  T.group('model and diagram');

  function fixture() { return ns.testFixture(); }

  T.test('deleting an element removes every relationship touching it', function () {
    var doc = fixture();
    T.eq(ns.model.relationshipsFor(doc, 'c1').length, 3, 'Order starts with 3');

    ns.model.removeElement(doc, 'c1');

    T.eq(ns.model.findElement(doc, 'c1'), null);
    T.eq(ns.model.relationshipsFor(doc, 'c1').length, 0);
    T.eq(doc.model.relationships.length, 0, 'all three referenced Order');
  });

  T.test('deleting a package orphans its contents instead of destroying them', function () {
    var doc = fixture();
    ns.model.removeElement(doc, 'p1');

    T.eq(ns.model.findElement(doc, 'p1'), null, 'package is gone');
    T.ok(ns.model.findElement(doc, 'c1'), 'Order survives');
    T.eq(ns.model.findElement(doc, 'c1').owner, null, 'and is now top level');
    T.eq(ns.model.findElement(doc, 'c2').owner, null);
  });

  T.test('cascade delete then prune clears the views too', function () {
    var doc = fixture();
    var diagram = doc.diagrams[0];
    T.ok(ns.diagram.nodeForElement(diagram, 'c1'), 'node exists first');

    ns.model.removeElement(doc, 'c1');
    var removed = ns.diagram.prune(doc);

    T.ok(removed > 0, 'prune reported the removals');
    T.eq(ns.diagram.nodeForElement(diagram, 'c1'), null, 'node gone');
    T.eq(ns.diagram.edgeForRelationship(diagram, 'r1'), null, 'edge gone');
  });

  T.test('prune drops a duplicate node for one element', function () {
    var doc = fixture();
    var diagram = doc.diagrams[0];
    diagram.nodes.push(ns.diagram.createNode('c1', 900, 900, 100, 100));
    T.eq(diagram.nodes.filter(function (n) { return n.ref === 'c1'; }).length, 2);

    ns.diagram.prune(doc);

    T.eq(diagram.nodes.filter(function (n) { return n.ref === 'c1'; }).length, 1,
         'one node per element per diagram');
  });

  T.test('prune drops an edge whose endpoint is not on this diagram', function () {
    var doc = fixture();
    var diagram = doc.diagrams[0];
    diagram.nodes = diagram.nodes.filter(function (n) { return n.ref !== 'c2'; });

    ns.diagram.prune(doc);

    T.eq(ns.diagram.edgeForRelationship(diagram, 'r1'), null,
         'composition needs both ends visible');
    T.ok(ns.model.findRelationship(doc, 'r1'), 'the relationship itself survives');
  });

  T.test('removing a node keeps the element and other diagrams intact', function () {
    var doc = fixture();
    var second = ns.diagram.createDiagram('Second');
    doc.diagrams.push(second);
    ns.diagram.addNode(second, ns.model.findElement(doc, 'c1'), 10, 10, 120, 60);

    var diagram = doc.diagrams[0];
    var node = ns.diagram.nodeForElement(diagram, 'c1');
    ns.diagram.removeNode(doc, diagram, node.id);

    T.eq(ns.diagram.nodeForElement(diagram, 'c1'), null, 'gone from this diagram');
    T.ok(ns.model.findElement(doc, 'c1'), 'element still in the model');
    T.ok(ns.diagram.nodeForElement(second, 'c1'), 'still on the other diagram');
  });

  T.test('addNode refuses to place an element on the same diagram twice', function () {
    var doc = fixture();
    var diagram = doc.diagrams[0];
    var before = diagram.nodes.length;
    ns.diagram.addNode(diagram, ns.model.findElement(doc, 'c1'), 500, 500, 100, 100);
    T.eq(diagram.nodes.length, before, 'no second node was added');
  });

  T.test('canOwn refuses self-ownership and cycles', function () {
    var doc = fixture();
    ns.model.addElement(doc, ns.model.createElement('package', {
      id: 'p2', name: 'inner', owner: 'p1'
    }));

    T.ok(!ns.model.canOwn(doc, 'p1', 'p1'), 'cannot own itself');
    T.ok(!ns.model.canOwn(doc, 'p1', 'p2'), 'cannot be owned by its own child');
    T.ok(ns.model.canOwn(doc, 'c1', 'p2'), 'a class may go in the inner package');
  });

  T.test('childrenOf lists only direct contents', function () {
    var doc = fixture();
    var names = ns.model.childrenOf(doc, 'p1').map(function (el) { return el.name; });
    T.deepEq(names.sort(), ['Order', 'OrderLine']);
  });

  T.test('routePoints clips a straight edge to both borders', function () {
    var doc = ns.model.createDocument();
    ns.model.addElement(doc, ns.model.createElement('class', { id: 'a', name: 'A' }));
    ns.model.addElement(doc, ns.model.createElement('class', { id: 'b', name: 'B' }));
    var rel = ns.model.addRelationship(doc,
      ns.model.createRelationship('association', 'a', 'b', { id: 'r' }));

    var diagram = ns.diagram.createDiagram('D');
    doc.diagrams.push(diagram);
    ns.diagram.addNode(diagram, ns.model.findElement(doc, 'a'), 0, 0, 100, 100);
    ns.diagram.addNode(diagram, ns.model.findElement(doc, 'b'), 300, 0, 100, 100);
    var edge = ns.diagram.addEdge(diagram, rel);

    var points = ns.diagram.routePoints(doc, diagram, edge);
    T.eq(points.length, 2);
    T.near(points[0].x, 100, 0.001, 'leaves A at its right edge');
    T.near(points[0].y, 50);
    T.near(points[1].x, 300, 0.001, 'arrives at B on its left edge');
    T.near(points[1].y, 50);
  });

  T.test('routePoints threads through waypoints in order', function () {
    var doc = fixture();
    var diagram = doc.diagrams[0];
    var edge = ns.diagram.edgeForRelationship(diagram, 'r1');
    var points = ns.diagram.routePoints(doc, diagram, edge);
    T.eq(points.length, 3, 'start, one bend, end');
    T.eq(points[1].x, 300);
    T.eq(points[1].y, 190);
  });

  T.test('a self-relationship routes as a loop, not a zero-length line', function () {
    var doc = ns.model.createDocument();
    ns.model.addElement(doc, ns.model.createElement('class', { id: 'a', name: 'A' }));
    var rel = ns.model.addRelationship(doc,
      ns.model.createRelationship('aggregation', 'a', 'a', { id: 'r' }));

    var diagram = ns.diagram.createDiagram('D');
    doc.diagrams.push(diagram);
    ns.diagram.addNode(diagram, ns.model.findElement(doc, 'a'), 0, 0, 120, 80);
    var edge = ns.diagram.addEdge(diagram, rel);

    var points = ns.diagram.routePoints(doc, diagram, edge);
    T.ok(points.length > 2, 'loop has intermediate points');
    T.ok(ns.geometry.polylineLength(points) > 50, 'and real length');
  });

  T.test('drawOrder puts packages behind everything else', function () {
    var doc = fixture();
    var order = ns.diagram.drawOrder(doc, doc.diagrams[0]);
    T.eq(order[0].ref, 'p1', 'the package is drawn first');
  });

  T.test('bringToFront and sendToBack move a node within the draw order', function () {
    var doc = fixture();
    var diagram = doc.diagrams[0];
    var node = ns.diagram.nodeForElement(diagram, 'c1');

    ns.diagram.bringToFront(diagram, node.id);
    T.eq(diagram.nodes[diagram.nodes.length - 1].id, node.id);

    ns.diagram.sendToBack(diagram, node.id);
    T.eq(diagram.nodes[0].id, node.id);
  });

  T.test('bounds covers nodes and bend points', function () {
    var doc = fixture();
    var box = ns.diagram.bounds(doc.diagrams[0]);
    T.eq(box.x, 20, 'starts at the package');
    T.ok(box.w >= 800, 'wide enough to include the note at x=640');
  });

  T.test('member formatting matches UML notation', function () {
    T.eq(ns.model.formatAttribute({
      name: 'total', type: 'Money', visibility: 'private',
      multiplicity: '0..1', defaultValue: '0', isDerived: true
    }), '- /total: Money [0..1] = 0');

    T.eq(ns.model.formatOperation({
      name: 'move', returnType: 'void', visibility: 'public',
      parameters: [
        { name: 'dx', type: 'int', direction: 'in' },
        { name: 'ok', type: 'bool', direction: 'out' }
      ]
    }), '+ move(dx: int, out ok: bool): void');

    T.eq(ns.model.formatStereotypes(['entity', 'root']), '«entity, root»');
    T.eq(ns.model.formatStereotypes([]), '');
  });

  T.test('every relationship kind declares its end semantics', function () {
    ns.model.RELATIONSHIP_KINDS.forEach(function (kind) {
      var semantics = ns.model.endSemantics(kind);
      T.ok(semantics && semantics.source && semantics.target,
           kind + ' needs source/target wording');
    });
  });

  T.test('every relationship kind has a draw style', function () {
    ns.model.RELATIONSHIP_KINDS.forEach(function (kind) {
      T.ok(ns.render.EDGE_STYLE[kind], kind + ' has no entry in EDGE_STYLE');
    });
  });
})(UMLOne);
