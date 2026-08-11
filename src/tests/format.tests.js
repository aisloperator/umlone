(function (ns) {
  'use strict';

  T.group('file format');

  // A document exercising every v1 feature, built through the same API the editor uses.
  function fixture() {
    var doc = ns.model.createDocument();

    var pkg = ns.model.addElement(doc, ns.model.createElement('package', {
      id: 'p1', name: 'sales'
    }));

    var order = ns.model.addElement(doc, ns.model.createElement('class', {
      id: 'c1', name: 'Order', owner: 'p1', stereotypes: ['entity']
    }));
    order.attributes.push(ns.model.createAttribute({
      id: 'a1', name: 'total', type: 'Money', visibility: 'private',
      multiplicity: '0..1', isDerived: true
    }));
    order.operations.push(ns.model.createOperation({
      id: 'o1', name: 'recalculate', returnType: 'void',
      parameters: [ns.model.createParameter({ name: 'policy', type: 'TaxPolicy' })]
    }));

    ns.model.addElement(doc, ns.model.createElement('class', {
      id: 'c2', name: 'OrderLine', owner: 'p1'
    }));
    var payable = ns.model.addElement(doc, ns.model.createElement('interface', {
      id: 'i1', name: 'Payable'
    }));
    payable.operations.push(ns.model.createOperation({
      id: 'o2', name: 'amountDue', returnType: 'Money'
    }));
    ns.model.addElement(doc, ns.model.createElement('enumeration', {
      id: 'n1', name: 'Status', literals: ['OPEN', 'SHIPPED']
    }));
    ns.model.addElement(doc, ns.model.createElement('comment', {
      id: 'm1', body: 'Totals exclude tax.'
    }));

    var comp = ns.model.addRelationship(doc,
      ns.model.createRelationship('composition', 'c1', 'c2', { id: 'r1' }));
    comp.ends[1].role = 'lines';
    comp.ends[1].multiplicity = '1..*';
    comp.ends[1].navigable = true;

    ns.model.addRelationship(doc,
      ns.model.createRelationship('realization', 'c1', 'i1', { id: 'r2' }));
    ns.model.addRelationship(doc,
      ns.model.createRelationship('annotation', 'm1', 'c1', { id: 'r3' }));

    var diagram = ns.diagram.createDiagram('Main');
    diagram.id = 'd1';
    doc.diagrams.push(diagram);

    [['p1', 20, 20, 300, 300], ['c1', 40, 60, 200, 120], ['c2', 40, 200, 200, 90],
     ['i1', 400, 60, 180, 70], ['n1', 400, 200, 160, 90], ['m1', 640, 60, 180, 70]
    ].forEach(function (spec) {
      var element = ns.model.findElement(doc, spec[0]);
      ns.diagram.addNode(diagram, element, spec[1], spec[2], spec[3], spec[4]);
    });

    ns.diagram.syncEdges(doc, diagram);

    // One bend, so waypoint serialization is covered too.
    var edge = ns.diagram.edgeForRelationship(diagram, 'r1');
    edge.waypoints.push([300, 190]);

    return doc;
  }

  T.test('a fixture document validates cleanly', function () {
    var result = ns.validate.normalizeDocument(fixture());
    T.deepEq(result.errors, [], 'no errors');
    T.deepEq(result.warnings, [], 'no warnings');
    T.ok(result.ok);
  });

  T.test('serialize then deserialize then serialize is byte-identical', function () {
    var first = ns.io.serialize(fixture());
    var reloaded = ns.io.deserialize(first);
    T.ok(reloaded.ok, 'reloads without error: ' + reloaded.errors.join('; '));
    var second = ns.io.serialize(reloaded.doc);
    T.eq(second, first, 'round-tripping changed the bytes');
  });

  T.test('round-trip preserves every semantic detail', function () {
    var reloaded = ns.io.deserialize(ns.io.serialize(fixture())).doc;

    var order = ns.model.findElement(reloaded, 'c1');
    T.eq(order.name, 'Order');
    T.eq(order.owner, 'p1');
    T.deepEq(order.stereotypes, ['entity']);
    T.eq(order.attributes[0].multiplicity, '0..1');
    T.eq(order.attributes[0].isDerived, true);
    T.eq(order.operations[0].parameters[0].type, 'TaxPolicy');

    var enumeration = ns.model.findElement(reloaded, 'n1');
    T.deepEq(enumeration.literals, ['OPEN', 'SHIPPED']);

    T.eq(ns.model.findElement(reloaded, 'm1').body, 'Totals exclude tax.');

    var comp = ns.model.findRelationship(reloaded, 'r1');
    T.eq(comp.kind, 'composition');
    T.eq(comp.ends[1].role, 'lines');
    T.eq(comp.ends[1].multiplicity, '1..*');
    T.eq(comp.ends[1].navigable, true);
  });

  T.test('round-trip preserves geometry exactly', function () {
    var reloaded = ns.io.deserialize(ns.io.serialize(fixture())).doc;
    var diagram = reloaded.diagrams[0];
    var node = ns.diagram.nodeForElement(diagram, 'c1');
    T.eq(node.x, 40);
    T.eq(node.y, 60);
    T.eq(node.w, 200);
    T.eq(node.h, 120);
    T.deepEq(ns.diagram.edgeForRelationship(diagram, 'r1').waypoints, [[300, 190]]);
  });

  T.test('non-JSON input is reported, not thrown', function () {
    var result = ns.io.deserialize('this is not json {');
    T.ok(!result.ok);
    T.includes(result.errors, 'not valid JSON');
  });

  T.test('a foreign format is rejected by name', function () {
    var result = ns.io.deserialize('{"format":"mermaid","version":1}');
    T.ok(!result.ok);
    T.includes(result.errors, 'not a UMLOne file');
  });

  T.test('a future file version is refused rather than half-read', function () {
    var result = ns.io.deserialize('{"format":"umlone","version":99,"model":{},"diagrams":[]}');
    T.ok(!result.ok);
    T.includes(result.errors, 'newer than this editor supports');
  });

  T.test('a dangling relationship endpoint is a fatal error', function () {
    var doc = fixture();
    doc.model.relationships[0].ends[1].ref = 'does-not-exist';
    var result = ns.validate.normalizeDocument(doc);
    T.ok(!result.ok, 'should not load');
    T.includes(result.errors, 'does not match any element');
  });

  T.test('duplicate ids are a fatal error', function () {
    var doc = fixture();
    doc.model.elements[2].id = doc.model.elements[1].id;
    var result = ns.validate.normalizeDocument(doc);
    T.ok(!result.ok);
    T.includes(result.errors, 'duplicate id');
  });

  T.test('an unknown element kind is a fatal error', function () {
    var doc = fixture();
    doc.model.elements[1].kind = 'usecase';
    var result = ns.validate.normalizeDocument(doc);
    T.ok(!result.ok);
    T.includes(result.errors, 'unknown element kind');
  });

  T.test('a relationship without exactly two ends is a fatal error', function () {
    var doc = fixture();
    doc.model.relationships[0].ends = [{ ref: 'c1' }];
    var result = ns.validate.normalizeDocument(doc);
    T.ok(!result.ok);
    T.includes(result.errors, 'expected exactly 2 ends');
  });

  T.test('a malformed multiplicity is repaired with a warning, not a failure', function () {
    var doc = fixture();
    doc.model.elements[1].attributes[0].multiplicity = 'lots';
    var result = ns.validate.normalizeDocument(doc);
    T.ok(result.ok, 'still loads');
    T.includes(result.warnings, 'unparseable multiplicity');
    T.eq(ns.model.findElement(result.doc, 'c1').attributes[0].multiplicity, '');
  });

  T.test('an owner pointing at a non-package is repaired to top level', function () {
    var doc = fixture();
    ns.model.findElement(doc, 'c1').owner = 'c2';
    var result = ns.validate.normalizeDocument(doc);
    T.ok(result.ok);
    T.includes(result.warnings, 'is not a package');
    T.eq(ns.model.findElement(result.doc, 'c1').owner, null);
  });

  T.test('a cyclic package chain is broken on load', function () {
    var doc = ns.model.createDocument();
    ns.model.addElement(doc, ns.model.createElement('package', { id: 'x', owner: 'y' }));
    ns.model.addElement(doc, ns.model.createElement('package', { id: 'y', owner: 'x' }));
    doc.diagrams.push(ns.diagram.createDiagram('Main'));

    var result = ns.validate.normalizeDocument(doc);
    T.ok(result.ok, 'loads rather than hanging');
    T.includes(result.warnings, 'cyclic');
  });

  T.test('a diagram node for a missing element is pruned with a warning', function () {
    var doc = fixture();
    doc.diagrams[0].nodes.push({ id: 'ghost', ref: 'nope', x: 0, y: 0, w: 80, h: 40 });
    var result = ns.validate.normalizeDocument(doc);
    T.ok(result.ok);
    T.includes(result.warnings, 'referenced missing elements');
    T.eq(ns.diagram.findNode(result.doc.diagrams[0], 'ghost'), null);
  });

  T.test('an empty file gets a diagram so the editor has somewhere to draw', function () {
    var result = ns.io.deserialize('{"format":"umlone","version":1}');
    T.ok(result.ok);
    T.eq(result.doc.diagrams.length, 1);
    T.includes(result.warnings, 'no diagrams');
  });

  T.test('unknown fields are dropped rather than carried along', function () {
    var doc = fixture();
    doc.model.elements[1].favouriteColour = 'blue';
    var text = ns.io.serialize(doc);
    T.eq(text.indexOf('favouriteColour'), -1, 'stray field should not survive');
  });

  T.test('waypoints written as {x, y} objects are accepted and normalised', function () {
    var doc = fixture();
    ns.diagram.edgeForRelationship(doc.diagrams[0], 'r1').waypoints = [{ x: 5, y: 6 }];
    var result = ns.validate.normalizeDocument(doc);
    T.ok(result.ok);
    T.deepEq(ns.diagram.edgeForRelationship(result.doc.diagrams[0], 'r1').waypoints,
             [[5, 6]]);
  });

  T.test('multiplicity grammar accepts the legal forms and rejects the rest', function () {
    ['', '1', '0', '*', '0..1', '1..*', '2..7'].forEach(function (value) {
      T.ok(ns.model.isValidMultiplicity(value), 'should accept ' + JSON.stringify(value));
    });
    ['many', '1..', '..3', '1-3', '*..1', '5..2'].forEach(function (value) {
      T.ok(!ns.model.isValidMultiplicity(value),
           'should reject ' + JSON.stringify(value));
    });
  });

  T.test('serialize refuses to write a document it could not read back', function () {
    var doc = fixture();
    doc.model.relationships[0].ends[0].ref = 'gone';
    T.throws(function () { ns.io.serialize(doc); });
  });

  ns.testFixture = fixture;
})(UMLOne);
