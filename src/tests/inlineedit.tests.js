(function (ns) {
  'use strict';

  T.group('in-place editing');

  function setup() {
    var host = document.createElement('div');
    host.style.position = 'relative';
    document.getElementById('sandbox').appendChild(host);

    var store = new ns.commands.Store(ns.testFixture());
    var editor = ns.inlineEdit.create({
      host: host,
      store: store,
      getViewport: function () { return { x: 0, y: 0, scale: 1 }; },
      onRender: function () {},
      onSelectNode: function () {}
    });

    var diagram = store.currentDiagram();

    return {
      host: host,
      store: store,
      editor: editor,
      diagram: diagram,
      nodeIdFor: function (elementId) {
        return ns.diagram.nodeForElement(store.currentDiagram(), elementId).id;
      },
      field: function () { return host.querySelector('.inline-editor'); },
      element: function (id) { return ns.model.findElement(store.doc, id); }
    };
  }

  function press(input, key, modifiers) {
    var init = { key: key, bubbles: true, cancelable: true };
    Object.keys(modifiers || {}).forEach(function (k) { init[k] = modifiers[k]; });
    input.dispatchEvent(new KeyboardEvent('keydown', init));
  }

  // --- slots and geometry ----------------------------------------------------

  T.test('edit slots are the name then every member, in visual order', function () {
    var doc = ns.testFixture();
    var node = ns.diagram.nodeForElement(doc.diagrams[0], 'c1');
    var slots = ns.render.editSlots(doc, ns.model.findElement(doc, 'c1'), node);

    T.deepEq(slots, [
      { kind: 'name', index: 0 },
      { kind: 'attribute', index: 0 },
      { kind: 'operation', index: 0 }
    ]);
  });

  T.test('a hidden compartment contributes no slots', function () {
    var doc = ns.testFixture();
    var node = ns.diagram.nodeForElement(doc.diagrams[0], 'c1');
    node.show.attributes = false;

    var slots = ns.render.editSlots(doc, ns.model.findElement(doc, 'c1'), node);
    var kinds = slots.map(function (s) { return s.kind; });
    T.eq(kinds.indexOf('attribute'), -1, 'you cannot edit what is not drawn');
  });

  T.test('an enumeration exposes its literals as slots', function () {
    var doc = ns.testFixture();
    var node = ns.diagram.nodeForElement(doc.diagrams[0], 'n1');
    var slots = ns.render.editSlots(doc, ns.model.findElement(doc, 'n1'), node);

    T.deepEq(slots, [
      { kind: 'name', index: 0 },
      { kind: 'literal', index: 0 },
      { kind: 'literal', index: 1 }
    ]);
  });

  T.test('each empty compartment offers a placeholder row to click', function () {
    var doc = ns.testFixture();
    // OrderLine has neither attributes nor operations, so both compartments are empty.
    var node = ns.diagram.nodeForElement(doc.diagrams[0], 'c2');
    var boxes = ns.render.lineBoxes(doc, ns.model.findElement(doc, 'c2'), node);

    var placeholders = boxes.filter(function (b) { return b.placeholder; });
    T.deepEq(placeholders.map(function (b) { return b.kind; }),
             ['attribute', 'operation']);
    T.deepEq(placeholders.map(function (b) { return b.index; }), [0, 0]);
  });

  T.test('placeholders are not reachable by arrow keys', function () {
    var doc = ns.testFixture();
    var node = ns.diagram.nodeForElement(doc.diagrams[0], 'c2');
    var slots = ns.render.editSlots(doc, ns.model.findElement(doc, 'c2'), node);

    T.deepEq(slots, [{ kind: 'name', index: 0 }],
             'arrowing into an empty compartment must not create a member');
  });

  T.test('the edit box sits over the line it belongs to', function () {
    var doc = ns.testFixture();
    var element = ns.model.findElement(doc, 'c1');
    var node = ns.diagram.nodeForElement(doc.diagrams[0], 'c1');

    var name = ns.render.editBox(doc, element, node, { kind: 'name', index: 0 });
    var attr = ns.render.editBox(doc, element, node, { kind: 'attribute', index: 0 });

    T.eq(name.x, node.x, 'spans the box, in absolute diagram coordinates');
    T.eq(name.w, node.w);
    T.eq(name.align, 'middle', 'the name is centred, so the field must be too');
    T.ok(attr.y > name.y, 'the attribute row sits below the header');
    T.eq(attr.align, 'start');
  });

  // --- opening and committing ------------------------------------------------

  T.test('double-clicking a name opens a field holding that name', function () {
    var s = setup();
    T.ok(s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'name', index: 0 }));

    var input = s.field();
    T.ok(input, 'a field was created');
    T.eq(input.tagName, 'INPUT');
    T.eq(input.value, 'Order');
    T.eq(s.editor.isActive(), true);
  });

  T.test('the renderer is told which line to leave blank', function () {
    var s = setup();
    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'attribute', index: 0 });
    T.deepEq(s.editor.editingState(),
             { nodeId: s.nodeIdFor('c1'), kind: 'attribute', index: 0 });
  });

  T.test('Enter commits the new name and closes the field', function () {
    var s = setup();
    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'name', index: 0 });

    s.field().value = 'PurchaseOrder';
    press(s.field(), 'Enter');

    T.eq(s.element('c1').name, 'PurchaseOrder');
    T.eq(s.editor.isActive(), false, 'Enter ends editing');
    T.eq(s.field(), null, 'the field is gone');
  });

  T.test('Escape abandons the edit', function () {
    var s = setup();
    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'name', index: 0 });

    s.field().value = 'Discarded';
    press(s.field(), 'Escape');

    T.eq(s.element('c1').name, 'Order', 'the original name survives');
    T.eq(s.editor.isActive(), false);
  });

  T.test('committing an edit is a single undo step', function () {
    var s = setup();
    var before = JSON.stringify(s.store.doc);

    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'name', index: 0 });
    s.field().value = 'Renamed';
    press(s.field(), 'Enter');

    s.store.undo();
    T.eq(JSON.stringify(s.store.doc), before, 'one undo restores the old name');
  });

  T.test('an unchanged field leaves no undo entry', function () {
    var s = setup();
    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'name', index: 0 });
    press(s.field(), 'Enter');
    T.eq(s.store.canUndo(), false, 'opening and closing a field is not an edit');
  });

  // --- member rows -----------------------------------------------------------

  T.test('a member row shows exactly the text the diagram draws', function () {
    var s = setup();
    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'attribute', index: 0 });
    T.eq(s.field().value, ns.model.formatAttribute(s.element('c1').attributes[0]));
  });

  T.test('editing a member row writes every part back', function () {
    var s = setup();
    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'attribute', index: 0 });

    s.field().value = '# balance: Decimal [0..1] = 0';
    press(s.field(), 'Enter');

    var attr = s.element('c1').attributes[0];
    T.eq(attr.visibility, 'protected');
    T.eq(attr.name, 'balance');
    T.eq(attr.type, 'Decimal');
    T.eq(attr.multiplicity, '0..1');
    T.eq(attr.defaultValue, '0');
  });

  T.test('emptying a member row deletes it', function () {
    var s = setup();
    T.eq(s.element('c1').attributes.length, 1);

    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'attribute', index: 0 });
    s.field().value = '';
    press(s.field(), 'Enter');

    T.eq(s.element('c1').attributes.length, 0, 'the attribute is gone');
  });

  T.test('Shift+Enter adds a sibling below and keeps typing', function () {
    var s = setup();
    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'attribute', index: 0 });
    press(s.field(), 'Enter', { shiftKey: true });

    T.eq(s.element('c1').attributes.length, 2, 'a new attribute was added');
    T.eq(s.editor.isActive(), true, 'still editing');
    T.eq(s.editor.editingState().index, 1, 'now on the new row');
    T.eq(s.field().value, '', 'the new row starts empty');
  });

  T.test('a row added with Shift+Enter can be typed into straight away', function () {
    var s = setup();
    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'attribute', index: 0 });
    press(s.field(), 'Enter', { shiftKey: true });

    s.field().value = '+ shippedAt: DateTime';
    press(s.field(), 'Enter');

    var attrs = s.element('c1').attributes;
    T.eq(attrs.length, 2);
    T.eq(attrs[1].name, 'shippedAt');
    T.eq(attrs[1].type, 'DateTime');
  });

  T.test('Backspace in an empty row deletes it and moves up', function () {
    var s = setup();
    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'attribute', index: 0 });
    press(s.field(), 'Enter', { shiftKey: true });   // add a blank second row
    T.eq(s.element('c1').attributes.length, 2);

    press(s.field(), 'Backspace');                    // the blank row is already empty

    T.eq(s.element('c1').attributes.length, 1, 'the blank row was removed');
    T.eq(s.editor.isActive(), true, 'editing continues');
    T.eq(s.editor.editingState().kind, 'attribute');
    T.eq(s.editor.editingState().index, 0, 'caret moved to the row above');
  });

  T.test('Backspace in a non-empty row is ordinary text deletion', function () {
    var s = setup();
    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'attribute', index: 0 });
    press(s.field(), 'Backspace');

    T.eq(s.element('c1').attributes.length, 1, 'nothing was deleted');
    T.eq(s.editor.isActive(), true);
  });

  // --- navigation ------------------------------------------------------------

  T.test('ArrowDown walks from the name into the attributes', function () {
    var s = setup();
    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'name', index: 0 });

    press(s.field(), 'ArrowDown');

    T.eq(s.editor.editingState().kind, 'attribute');
    T.eq(s.editor.editingState().index, 0);
  });

  T.test('ArrowDown crosses from the last attribute into the operations', function () {
    var s = setup();
    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'attribute', index: 0 });

    press(s.field(), 'ArrowDown');

    T.eq(s.editor.editingState().kind, 'operation',
         'the compartment boundary should not stop the caret');
  });

  T.test('ArrowUp walks back the other way', function () {
    var s = setup();
    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'operation', index: 0 });

    press(s.field(), 'ArrowUp');
    T.eq(s.editor.editingState().kind, 'attribute');

    press(s.field(), 'ArrowUp');
    T.eq(s.editor.editingState().kind, 'name');
  });

  T.test('arrowing past the ends stays put rather than closing', function () {
    var s = setup();
    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'name', index: 0 });

    press(s.field(), 'ArrowUp');
    T.eq(s.editor.isActive(), true);
    T.eq(s.editor.editingState().kind, 'name', 'clamped at the top');
  });

  T.test('Tab and Shift+Tab move between rows', function () {
    var s = setup();
    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'name', index: 0 });

    press(s.field(), 'Tab');
    T.eq(s.editor.editingState().kind, 'attribute');

    press(s.field(), 'Tab', { shiftKey: true });
    T.eq(s.editor.editingState().kind, 'name');
  });

  T.test('navigating commits the row being left', function () {
    var s = setup();
    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'name', index: 0 });

    s.field().value = 'Committed';
    press(s.field(), 'ArrowDown');

    T.eq(s.element('c1').name, 'Committed', 'the edit was not lost on the way out');
  });

  T.test('navigating away from an emptied row skips the gap it left', function () {
    var s = setup();
    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'attribute', index: 0 });

    s.field().value = '';
    press(s.field(), 'ArrowDown');

    T.eq(s.element('c1').attributes.length, 0, 'the emptied row went');
    T.eq(s.editor.isActive(), true, 'and editing continued somewhere valid');
    T.eq(s.editor.editingState().kind, 'operation');
  });

  // --- other element kinds ---------------------------------------------------

  T.test('a note is edited as multi-line text', function () {
    var s = setup();
    s.editor.begin({ nodeId: s.nodeIdFor('m1'), kind: 'body', index: 0 });

    var input = s.field();
    T.eq(input.tagName, 'TEXTAREA', 'a note needs more than one line');
    T.eq(input.value, 'Totals exclude tax.');

    input.value = 'Line one\nLine two';
    press(input, 'Enter');
    T.eq(s.element('m1').body, 'Line one\nLine two');
  });

  T.test('Shift+Enter in a note inserts a line break instead of committing', function () {
    var s = setup();
    s.editor.begin({ nodeId: s.nodeIdFor('m1'), kind: 'body', index: 0 });
    press(s.field(), 'Enter', { shiftKey: true });
    T.eq(s.editor.isActive(), true, 'a note is the one place Enter is content');
  });

  T.test('a package name is edited in its tab', function () {
    var s = setup();
    s.editor.begin({ nodeId: s.nodeIdFor('p1'), kind: 'name', index: 0 });

    T.eq(s.field().value, 'sales');
    s.field().value = 'ordering';
    press(s.field(), 'Enter');
    T.eq(s.element('p1').name, 'ordering');
  });

  T.test('an enum literal is edited like any other row', function () {
    var s = setup();
    s.editor.begin({ nodeId: s.nodeIdFor('n1'), kind: 'literal', index: 1 });

    T.eq(s.field().value, 'SHIPPED');
    s.field().value = 'DELIVERED';
    press(s.field(), 'Enter');
    T.deepEq(s.element('n1').literals, ['OPEN', 'DELIVERED']);
  });

  T.test('editing an interface operation works the same way', function () {
    var s = setup();
    s.editor.begin({ nodeId: s.nodeIdFor('i1'), kind: 'operation', index: 0 });
    T.eq(s.field().value, '+ amountDue(): Money');
  });

  // --- growth and integrity --------------------------------------------------

  T.test('clicking an empty compartment creates the first member', function () {
    var s = setup();
    T.eq(s.element('c2').attributes.length, 0, 'OrderLine starts with none');

    s.editor.begin({ nodeId: s.nodeIdFor('c2'), kind: 'attribute', index: 0 });

    T.eq(s.element('c2').attributes.length, 1, 'a blank row was created to type into');
    T.eq(s.field().value, '', 'and it is empty');
  });

  T.test('a box grows so a newly added row is not hidden by the clip', function () {
    var s = setup();
    var nodeId = s.nodeIdFor('c1');
    var before = ns.diagram.findNode(s.store.currentDiagram(), nodeId).h;

    // Fill the box past its height.
    s.editor.begin({ nodeId: nodeId, kind: 'attribute', index: 0 });
    for (var i = 0; i < 8; i++) {
      press(s.field(), 'Enter', { shiftKey: true });
      s.field().value = '- filler' + i + ': int';
    }
    press(s.field(), 'Enter');

    var after = ns.diagram.findNode(s.store.currentDiagram(), nodeId).h;
    T.ok(after > before, 'the box should have grown to fit the new rows');
  });

  T.test('a box never shrinks on its own', function () {
    var s = setup();
    var nodeId = s.nodeIdFor('c1');

    s.store.apply('enlarge', function (doc) {
      ns.diagram.findNode(doc.diagrams[0], nodeId).h = 400;
      return true;
    });

    s.editor.begin({ nodeId: nodeId, kind: 'attribute', index: 0 });
    s.field().value = '';
    press(s.field(), 'Enter');

    T.eq(ns.diagram.findNode(s.store.currentDiagram(), nodeId).h, 400,
         'deleting a row must not undo a size the user chose');
  });

  // An enum literal is a bare string, so a row that exists but is still empty is a
  // falsy value at a real index. Testing existence by truthiness would treat it as
  // missing and add a second row alongside it.
  T.test('an existing but empty row is edited, not duplicated', function () {
    var s = setup();
    s.store.apply('blank literal', function (doc) {
      ns.model.findElement(doc, 'n1').literals.push('');
      return true;
    });

    s.editor.begin({ nodeId: s.nodeIdFor('n1'), kind: 'literal', index: 2 });

    T.eq(s.element('n1').literals.length, 3, 'no extra row was created');
    T.eq(s.field().value, '');

    s.field().value = 'CANCELLED';
    press(s.field(), 'Enter');
    T.deepEq(s.element('n1').literals, ['OPEN', 'SHIPPED', 'CANCELLED']);
  });

  T.test('an existing but empty row can be deleted with Backspace', function () {
    var s = setup();
    s.store.apply('blank literal', function (doc) {
      ns.model.findElement(doc, 'n1').literals.push('');
      return true;
    });

    s.editor.begin({ nodeId: s.nodeIdFor('n1'), kind: 'literal', index: 2 });
    press(s.field(), 'Backspace');

    T.deepEq(s.element('n1').literals, ['OPEN', 'SHIPPED']);
  });

  // The parsers build their objects key by key. If that order drifted from the order
  // validate.js normalises to, saving after an in-place edit would reorder keys and every
  // such edit would show up as a whole-member diff.
  T.test('a member edited in place still serializes canonically', function () {
    var s = setup();

    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'attribute', index: 0 });
    s.field().value = '# balance: Decimal [0..1] = 0';
    press(s.field(), 'Enter');

    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'operation', index: 0 });
    s.field().value = '+ apply(policy: TaxPolicy, out ok: bool): Money';
    press(s.field(), 'Enter');

    var text = ns.io.serialize(s.store.doc);
    T.eq(ns.io.serialize(ns.io.deserialize(text).doc), text,
         'in-place edits must not disturb the canonical key order');
  });

  T.test('the document stays valid after in-place edits', function () {
    var s = setup();
    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'name', index: 0 });
    s.field().value = 'Renamed';
    press(s.field(), 'Enter', { shiftKey: false });

    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'attribute', index: 0 });
    s.field().value = '+ x: int';
    press(s.field(), 'ArrowDown');
    press(s.field(), 'Enter');

    var result = ns.validate.normalizeDocument(s.store.doc);
    T.deepEq(result.errors, []);
  });

  T.test('beginning a second edit closes the first', function () {
    var s = setup();
    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'name', index: 0 });
    s.editor.begin({ nodeId: s.nodeIdFor('c2'), kind: 'name', index: 0 });

    T.eq(s.host.querySelectorAll('.inline-editor').length, 1,
         'only one field may exist at a time');
    T.eq(s.editor.editingState().nodeId, s.nodeIdFor('c2'));
  });

  T.test('editing a missing node is refused rather than throwing', function () {
    var s = setup();
    T.eq(s.editor.begin({ nodeId: 'no-such-node', kind: 'name', index: 0 }), false);
    T.eq(s.editor.isActive(), false);
  });
})(UMLOne);
