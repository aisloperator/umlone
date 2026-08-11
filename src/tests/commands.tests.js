(function (ns) {
  'use strict';

  T.group('store, undo and commands');

  function newStore() {
    return new ns.commands.Store(ns.testFixture());
  }

  function snapshot(store) {
    return JSON.stringify(store.doc);
  }

  T.test('a fresh store is clean and points at the first diagram', function () {
    var store = newStore();
    T.eq(store.dirty, false);
    T.eq(store.canUndo(), false);
    T.eq(store.canRedo(), false);
    T.eq(store.currentDiagramId, 'd1');
  });

  T.test('undo restores the document exactly', function () {
    var store = newStore();
    var before = snapshot(store);

    store.apply('rename', function (doc) {
      ns.model.findElement(doc, 'c1').name = 'PurchaseOrder';
      return true;
    });

    T.eq(ns.model.findElement(store.doc, 'c1').name, 'PurchaseOrder');
    T.ok(store.canUndo());

    store.undo();
    T.eq(snapshot(store), before, 'undo did not restore byte-for-byte');
  });

  T.test('redo reapplies the change exactly', function () {
    var store = newStore();
    store.apply('rename', function (doc) {
      ns.model.findElement(doc, 'c1').name = 'PurchaseOrder';
      return true;
    });
    var after = snapshot(store);

    store.undo();
    store.redo();

    T.eq(snapshot(store), after);
    T.eq(store.canRedo(), false, 'redo stack is spent');
  });

  T.test('a new edit clears the redo stack', function () {
    var store = newStore();
    store.apply('one', function (doc) { doc.model.elements[1].name = 'A'; return true; });
    store.undo();
    T.ok(store.canRedo());

    store.apply('two', function (doc) { doc.model.elements[1].name = 'B'; return true; });
    T.eq(store.canRedo(), false, 'the old redo branch should be discarded');
  });

  T.test('an edit that returns false leaves no history and no dirty flag', function () {
    var store = newStore();
    var before = snapshot(store);

    var applied = store.apply('no-op', function () { return false; });

    T.eq(applied, false);
    T.eq(store.canUndo(), false, 'nothing should be on the undo stack');
    T.eq(store.dirty, false);
    T.eq(snapshot(store), before);
  });

  T.test('a continuous gesture collapses into one undo step', function () {
    var store = newStore();
    var before = snapshot(store);
    var token = 'drag-1';

    for (var i = 1; i <= 10; i++) {
      var x = i * 10;
      store.applyContinuous(token, 'move', function (doc) {
        ns.diagram.nodeForElement(doc.diagrams[0], 'c1').x = x;
      });
    }
    store.endGesture();

    T.eq(ns.diagram.nodeForElement(store.doc.diagrams[0], 'c1').x, 100);
    T.eq(store.undoStack.length, 1, 'ten moves should be one history entry');

    store.undo();
    T.eq(snapshot(store), before, 'one undo returns to the start of the drag');
  });

  T.test('two gestures are two undo steps', function () {
    var store = newStore();
    store.applyContinuous('a', 'move', function (doc) {
      ns.diagram.nodeForElement(doc.diagrams[0], 'c1').x = 111;
    });
    store.endGesture();
    store.applyContinuous('b', 'move', function (doc) {
      ns.diagram.nodeForElement(doc.diagrams[0], 'c1').x = 222;
    });
    store.endGesture();

    T.eq(store.undoStack.length, 2);
    store.undo();
    T.eq(ns.diagram.nodeForElement(store.doc.diagrams[0], 'c1').x, 111);
  });

  T.test('replacing the document clears history and the dirty flag', function () {
    var store = newStore();
    store.apply('edit', function (doc) { doc.model.elements[1].name = 'X'; return true; });
    T.ok(store.dirty);

    store.replace(ns.testFixture(), 'thing.uml.json');

    T.eq(store.canUndo(), false);
    T.eq(store.canRedo(), false);
    T.eq(store.dirty, false);
    T.eq(store.fileName, 'thing.uml.json');
  });

  T.test('markSaved clears dirty without touching history', function () {
    var store = newStore();
    store.apply('edit', function (doc) { doc.model.elements[1].name = 'X'; return true; });
    store.markSaved('out.uml.json');

    T.eq(store.dirty, false);
    T.ok(store.canUndo(), 'saving is not an undo boundary');
  });

  T.test('undoing past a diagram deletion moves the view somewhere valid', function () {
    var store = newStore();
    ns.commands.addDiagram(store, 'Second');
    T.eq(store.doc.diagrams.length, 2);

    store.setCurrentDiagram(store.doc.diagrams[1].id);
    store.undo(); // removes the diagram we are looking at

    T.eq(store.doc.diagrams.length, 1);
    T.ok(ns.diagram.findDiagram(store.doc, store.currentDiagramId),
         'current diagram must still exist');
  });

  T.test('createElementOn adds both the element and its view', function () {
    var store = newStore();
    var created = ns.commands.createElementOn(store, 'class', 700, 700);

    T.ok(created, 'returned ids');
    var element = ns.model.findElement(store.doc, created.elementId);
    T.eq(element.kind, 'class');
    T.ok(element.name, 'gets a default name');

    var node = ns.diagram.findNode(store.currentDiagram(), created.nodeId);
    T.eq(node.x, 700);
    T.eq(node.y, 700);
  });

  T.test('a new element dropped inside a package joins it', function () {
    var store = newStore();
    // The package node sits at 20,20 and is 300x300.
    var created = ns.commands.createElementOn(store, 'class', 60, 100);
    T.eq(ns.model.findElement(store.doc, created.elementId).owner, 'p1');
  });

  T.test('a new element dropped outside every package stays top level', function () {
    var store = newStore();
    var created = ns.commands.createElementOn(store, 'class', 900, 900);
    T.eq(ns.model.findElement(store.doc, created.elementId).owner, null);
  });

  T.test('a new package adopts the boxes it encloses', function () {
    var store = newStore();
    var created = ns.commands.createElementOn(store, 'package', 380, 40);
    // Default package size is 260x180, so it covers the Payable interface at 400,60.
    T.eq(ns.model.findElement(store.doc, 'i1').owner, created.elementId);
  });

  T.test('connect creates a relationship and an edge on the current diagram', function () {
    var store = newStore();
    var problem = ns.commands.connect(store, 'dependency', 'c2', 'i1');

    T.eq(problem, null, 'no complaint expected');
    var rel = store.doc.model.relationships.filter(function (r) {
      return r.kind === 'dependency';
    })[0];
    T.ok(rel, 'relationship created');
    T.ok(ns.diagram.edgeForRelationship(store.currentDiagram(), rel.id), 'edge created');
  });

  T.test('connect refuses to make something generalize itself', function () {
    var store = newStore();
    var before = store.doc.model.relationships.length;
    var problem = ns.commands.connect(store, 'generalization', 'c1', 'c1');

    T.ok(problem, 'should report a problem');
    T.eq(store.doc.model.relationships.length, before, 'and change nothing');
  });

  T.test('a note link is swapped so it starts at the note', function () {
    var store = newStore();
    ns.commands.connect(store, 'annotation', 'c2', 'm1');

    var rel = store.doc.model.relationships.filter(function (r) {
      return r.kind === 'annotation' && r.id !== 'r3';
    })[0];
    T.ok(rel, 'relationship created');
    T.eq(rel.ends[0].ref, 'm1', 'the note must be the source end');
    T.eq(rel.ends[1].ref, 'c2');
  });

  T.test('a note link between two non-notes is refused', function () {
    var store = newStore();
    var problem = ns.commands.connect(store, 'annotation', 'c1', 'c2');
    T.ok(problem, 'should report a problem');
  });

  T.test('an association is created navigable at the target end', function () {
    var store = newStore();
    ns.commands.connect(store, 'association', 'c2', 'i1');
    var rel = store.doc.model.relationships.filter(function (r) {
      return r.kind === 'association';
    })[0];
    T.eq(rel.ends[1].navigable, true);
  });

  T.test('deleteFromModel removes the element everywhere', function () {
    var store = newStore();
    var node = ns.diagram.nodeForElement(store.currentDiagram(), 'c2');

    ns.commands.deleteFromModel(store, [node.id], []);

    T.eq(ns.model.findElement(store.doc, 'c2'), null);
    T.eq(ns.model.findRelationship(store.doc, 'r1'), null, 'its composition went too');
    T.eq(ns.diagram.nodeForElement(store.currentDiagram(), 'c2'), null);
  });

  T.test('removeFromDiagram keeps the element in the model', function () {
    var store = newStore();
    var node = ns.diagram.nodeForElement(store.currentDiagram(), 'c2');

    ns.commands.removeFromDiagram(store, [node.id], []);

    T.ok(ns.model.findElement(store.doc, 'c2'), 'element survives');
    T.ok(ns.model.findRelationship(store.doc, 'r1'), 'relationship survives');
    T.eq(ns.diagram.nodeForElement(store.currentDiagram(), 'c2'), null, 'view is gone');
  });

  T.test('showOnDiagram puts a hidden element back and reconnects its edges', function () {
    var store = newStore();
    var node = ns.diagram.nodeForElement(store.currentDiagram(), 'c2');
    ns.commands.removeFromDiagram(store, [node.id], []);
    T.eq(ns.diagram.edgeForRelationship(store.currentDiagram(), 'r1'), null);

    ns.commands.showOnDiagram(store, 'c2', 500, 500);

    T.ok(ns.diagram.nodeForElement(store.currentDiagram(), 'c2'), 'back on the diagram');
    T.ok(ns.diagram.edgeForRelationship(store.currentDiagram(), 'r1'),
         'its composition edge came back too');
  });

  T.test('the last diagram cannot be deleted', function () {
    var store = newStore();
    T.eq(store.doc.diagrams.length, 1);
    var applied = ns.commands.removeDiagram(store, 'd1');
    T.eq(applied, false);
    T.eq(store.doc.diagrams.length, 1);
  });

  T.test('addDiagram switches to the diagram it created', function () {
    var store = newStore();
    var id = ns.commands.addDiagram(store, 'Second');
    T.eq(store.currentDiagramId, id);
    T.eq(store.currentDiagram().name, 'Second');
  });

  T.test('sizeToFit grows a box that is too small for its contents', function () {
    var store = newStore();
    var node = ns.diagram.nodeForElement(store.currentDiagram(), 'c1');

    store.apply('shrink', function (doc) {
      ns.diagram.nodeForElement(doc.diagrams[0], 'c1').w = 40;
      return true;
    });

    ns.commands.sizeToFit(store, [node.id]);

    T.ok(ns.diagram.nodeForElement(store.currentDiagram(), 'c1').w > 100,
         'should widen to fit "+ recalculate(policy: TaxPolicy): void"');
  });

  T.test('every edit leaves the document loadable', function () {
    var store = newStore();
    ns.commands.createElementOn(store, 'enumeration', 800, 40);
    ns.commands.connect(store, 'dependency', 'c1', 'i1');
    ns.commands.addDiagram(store, 'Second');

    var result = ns.validate.normalizeDocument(store.doc);
    T.deepEq(result.errors, [], 'document should still validate');
  });
})(UMLOne);
