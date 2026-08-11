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

  T.test('each empty compartment offers a strip to click', function () {
    var doc = ns.testFixture();
    // OrderLine has neither attributes nor operations, so both compartments are empty.
    var node = ns.diagram.nodeForElement(doc.diagrams[0], 'c2');
    var boxes = ns.render.lineBoxes(doc, ns.model.findElement(doc, 'c2'), node);

    var strips = boxes.filter(function (b) { return b.insert; });
    T.deepEq(strips.map(function (b) { return b.kind; }), ['attribute', 'operation']);
    T.deepEq(strips.map(function (b) { return b.index; }), [0, 0]);
  });

  T.test('a populated compartment has a strip above and below its rows', function () {
    var doc = ns.testFixture();
    var element = ns.model.findElement(doc, 'c1');   // one attribute, one operation
    var node = ns.diagram.nodeForElement(doc.diagrams[0], 'c1');
    var boxes = ns.render.lineBoxes(doc, element, node);

    var attributeStrips = boxes.filter(function (b) {
      return b.insert && b.kind === 'attribute';
    });
    T.deepEq(attributeStrips.map(function (b) { return b.index; }), [0, 1],
             'insert-before-first and insert-after-last');
  });

  T.test('insertion strips never overlap the rows they sit between', function () {
    var doc = ns.testFixture();
    var element = ns.model.findElement(doc, 'c1');
    var node = ns.diagram.nodeForElement(doc.diagrams[0], 'c1');
    var boxes = ns.render.lineBoxes(doc, element, node);

    boxes.filter(function (b) { return b.insert; }).forEach(function (strip) {
      boxes.filter(function (b) { return !b.insert; }).forEach(function (row) {
        var disjoint = strip.y + strip.h <= row.y || row.y + row.h <= strip.y;
        T.ok(disjoint,
             'clicking a row must always mean editing it, never inserting beside it');
      });
    });
  });

  T.test('the strip below the last row is one row tall, not the whole slack', function () {
    var doc = ns.testFixture();
    var element = ns.model.findElement(doc, 'c1');
    var node = ns.diagram.nodeForElement(doc.diagrams[0], 'c1');
    node.h = 400;   // far taller than its contents

    var boxes = ns.render.lineBoxes(doc, element, node);
    var last = boxes[boxes.length - 1];

    T.ok(last.insert, 'there is still a target below the last member');
    T.eq(last.kind, 'operation', 'belonging to the last compartment');
    T.ok(last.h <= ns.measure.PAD_Y + ns.measure.LINE_HEIGHT,
         'capped at one row — a strip covering the whole slack would highlight on ' +
         'hover and read as a member that is already there');
    T.ok(last.y + last.h < 400, 'the rest of the box is left alone');
  });

  T.test('a short box still gets a usable strip below its last row', function () {
    var doc = ns.testFixture();
    var element = ns.model.findElement(doc, 'c1');
    var node = ns.diagram.nodeForElement(doc.diagrams[0], 'c1');
    node.h = ns.render.preferredSize(doc, element, node).h;   // no slack at all

    var boxes = ns.render.lineBoxes(doc, element, node);
    var last = boxes[boxes.length - 1];

    T.ok(last.insert);
    T.ok(last.h > 0, 'the padding below the last row is always a target');
  });

  T.test('insertion strips are not reachable by arrow keys', function () {
    var doc = ns.testFixture();
    var node = ns.diagram.nodeForElement(doc.diagrams[0], 'c2');
    var slots = ns.render.editSlots(doc, ns.model.findElement(doc, 'c2'), node);

    T.deepEq(slots, [{ kind: 'name', index: 0 }],
             'arrowing through a box must not create members');
  });

  T.test('the editor lands on a row, never on the strip sharing its index', function () {
    var doc = ns.testFixture();
    var element = ns.model.findElement(doc, 'c1');
    var node = ns.diagram.nodeForElement(doc.diagrams[0], 'c1');

    // The strip above the attributes and the first attribute are both "attribute 0".
    var box = ns.render.editBox(doc, element, node, { kind: 'attribute', index: 0 });
    T.eq(box.h, ns.measure.LINE_HEIGHT, 'a full row, not the padding strip');
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
    press(s.field(), 'Enter', { shiftKey: true });

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

  T.test('Enter on a filled row adds another below and keeps typing', function () {
    var s = setup();
    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'attribute', index: 0 });
    press(s.field(), 'Enter');

    T.eq(s.element('c1').attributes.length, 2, 'a new attribute was added');
    T.eq(s.editor.isActive(), true, 'still editing');
    T.eq(s.editor.editingState().index, 1, 'now on the new row');
    T.eq(s.field().value, '', 'the new row starts empty');
  });

  T.test('a whole list can be typed without touching the mouse', function () {
    var s = setup();
    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'attribute', index: 0 });

    ['+ shippedAt: DateTime', '- notes: String', '# version: int'].forEach(function (text) {
      press(s.field(), 'Enter');       // open a fresh row below
      s.field().value = text;
    });
    press(s.field(), 'Enter');          // filled row: opens one more
    press(s.field(), 'Enter');          // that one is empty: finish

    var names = s.element('c1').attributes.map(function (a) { return a.name; });
    T.deepEq(names, ['total', 'shippedAt', 'notes', 'version']);
    T.eq(s.editor.isActive(), false, 'the trailing blank row ended the list');
  });

  T.test('Enter on an empty row finishes and leaves no blank behind', function () {
    var s = setup();
    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'attribute', index: 0 });
    press(s.field(), 'Enter');                        // adds a blank row
    T.eq(s.element('c1').attributes.length, 2);

    press(s.field(), 'Enter');                        // the blank row ends editing

    T.eq(s.element('c1').attributes.length, 1, 'the blank row was tidied away');
    T.eq(s.editor.isActive(), false);
  });

  T.test('Shift+Enter stops without adding a row', function () {
    var s = setup();
    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'attribute', index: 0 });

    s.field().value = '- total: Money';
    press(s.field(), 'Enter', { shiftKey: true });

    T.eq(s.element('c1').attributes.length, 1, 'no sibling was created');
    T.eq(s.element('c1').attributes[0].name, 'total', 'but the edit was kept');
    T.eq(s.editor.isActive(), false);
  });

  T.test('Enter builds operations the same way as attributes', function () {
    var s = setup();
    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'operation', index: 0 });
    press(s.field(), 'Enter');
    s.field().value = '+ cancel(reason: String): void';
    press(s.field(), 'Enter', { shiftKey: true });

    var ops = s.element('c1').operations;
    T.eq(ops.length, 2);
    T.eq(ops[1].name, 'cancel');
    T.eq(ops[1].parameters[0].name, 'reason');
  });

  T.test('Backspace in an empty row deletes it and moves up', function () {
    var s = setup();
    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'attribute', index: 0 });
    press(s.field(), 'Enter');                        // add a blank second row
    T.eq(s.element('c1').attributes.length, 2);

    press(s.field(), 'Backspace');                    // the blank row is already empty

    T.eq(s.element('c1').attributes.length, 1, 'the blank row was removed');
    T.eq(s.editor.isActive(), true, 'editing continues');
    T.eq(s.editor.editingState().kind, 'attribute');
    T.eq(s.editor.editingState().index, 0, 'caret moved to the row above');
  });

  // --- inserting by clicking a gap -------------------------------------------

  T.test('the strip above a list inserts a member before the first', function () {
    var s = setup();
    s.editor.begin({
      nodeId: s.nodeIdFor('c1'), kind: 'attribute', index: 0, insert: true
    });

    var attrs = s.element('c1').attributes;
    T.eq(attrs.length, 2, 'a row was created rather than the existing one being edited');
    T.eq(attrs[1].name, 'total', 'the original attribute moved down');
    T.eq(s.editor.editingState().index, 0, 'editing the new first row');
    T.eq(s.field().value, '');
  });

  T.test('the strip below a list appends after the last', function () {
    var s = setup();
    s.editor.begin({
      nodeId: s.nodeIdFor('c1'), kind: 'attribute', index: 1, insert: true
    });

    s.field().value = '- appended: int';
    press(s.field(), 'Enter', { shiftKey: true });

    var names = s.element('c1').attributes.map(function (a) { return a.name; });
    T.deepEq(names, ['total', 'appended']);
  });

  T.test('an insert past the end of the list is clamped, not dropped', function () {
    var s = setup();
    s.editor.begin({
      nodeId: s.nodeIdFor('c1'), kind: 'attribute', index: 99, insert: true
    });

    T.eq(s.element('c1').attributes.length, 2);
    T.eq(s.editor.editingState().index, 1, 'appended at the end');
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
    press(s.field(), 'Enter', { shiftKey: true });
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
      press(s.field(), 'Enter');
      s.field().value = '- filler' + i + ': int';
    }
    press(s.field(), 'Enter', { shiftKey: true });

    var after = ns.diagram.findNode(s.store.currentDiagram(), nodeId).h;
    T.ok(after > before, 'the box should have grown to fit the new rows');
  });

  // Reported: after typing two operations and pressing Enter to finish, the box was left
  // with a row-sized gap at the bottom where a third operation would be — but no third
  // operation existed. Each Enter had inserted a blank row and grown the box to fit it,
  // and the final Enter deleted that blank row without the height coming back.
  T.test('finishing a list gives back the height its blank row borrowed', function () {
    var s = setup();
    var nodeId = s.nodeIdFor('c2');   // OrderLine: no members yet
    var startHeight = ns.diagram.findNode(s.store.currentDiagram(), nodeId).h;

    s.editor.begin({ nodeId: nodeId, kind: 'operation', index: 0, insert: true });
    s.field().value = '+ subtotal(): Money';
    press(s.field(), 'Enter');                       // commit, open a blank row
    s.field().value = '+ tax(): Money';
    press(s.field(), 'Enter');                       // commit, open another blank row
    press(s.field(), 'Enter');                       // blank row: finish

    var element = s.element('c2');
    T.eq(element.operations.length, 2, 'exactly the two that were typed');

    var node = ns.diagram.findNode(s.store.currentDiagram(), nodeId);
    var needed = ns.render.preferredSize(s.store.doc, element, node).h;

    T.ok(node.h < startHeight + ns.measure.LINE_HEIGHT,
         'the box must not keep the deleted row\'s height');
    T.ok(node.h >= needed, 'and must still fit what is actually there');
  });

  T.test('settling never goes below the height the box had when editing began', function () {
    var s = setup();
    var nodeId = s.nodeIdFor('c1');

    s.store.apply('enlarge', function (doc) {
      ns.diagram.findNode(doc.diagrams[0], nodeId).h = 400;
      return true;
    });

    s.editor.begin({ nodeId: nodeId, kind: 'attribute', index: 0 });
    press(s.field(), 'Enter');            // grows nothing; there is plenty of room
    press(s.field(), 'Enter');            // blank row: finish

    T.eq(ns.diagram.findNode(s.store.currentDiagram(), nodeId).h, 400,
         'a size set by dragging is not ours to take away');
  });

  T.test('settling leaves genuine growth in place', function () {
    var s = setup();
    var nodeId = s.nodeIdFor('c2');
    var startHeight = ns.diagram.findNode(s.store.currentDiagram(), nodeId).h;

    s.editor.begin({ nodeId: nodeId, kind: 'attribute', index: 0, insert: true });
    for (var i = 0; i < 10; i++) {
      s.field().value = '- filler' + i + ': int';
      press(s.field(), 'Enter');
    }
    press(s.field(), 'Enter');            // blank row: finish

    var node = ns.diagram.findNode(s.store.currentDiagram(), nodeId);
    var needed = ns.render.preferredSize(s.store.doc, s.element('c2'), node).h;

    T.eq(s.element('c2').attributes.length, 10);
    T.ok(node.h > startHeight, 'ten attributes need a taller box than we started with');
    T.ok(node.h >= needed, 'and all of them are visible');
  });

  T.test('moving to another box settles the one being left', function () {
    var s = setup();
    var first = s.nodeIdFor('c2');
    var firstStart = ns.diagram.findNode(s.store.currentDiagram(), first).h;

    s.editor.begin({ nodeId: first, kind: 'operation', index: 0, insert: true });
    s.field().value = '+ only(): void';
    press(s.field(), 'Enter');                       // opens a blank row, grows the box

    // Click into a different box without finishing the first.
    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'name', index: 0 });

    var node = ns.diagram.findNode(s.store.currentDiagram(), first);
    T.eq(s.element('c2').operations.length, 1, 'the blank row went with the field');
    T.ok(node.h < firstStart + ns.measure.LINE_HEIGHT * 2,
         'and the box it left is not stuck at the borrowed height');
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
    press(s.field(), 'Enter', { shiftKey: true });
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
    press(s.field(), 'Enter', { shiftKey: true });

    s.editor.begin({ nodeId: s.nodeIdFor('c1'), kind: 'operation', index: 0 });
    s.field().value = '+ apply(policy: TaxPolicy, out ok: bool): Money';
    press(s.field(), 'Enter', { shiftKey: true });

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
    press(s.field(), 'Enter', { shiftKey: true });

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
