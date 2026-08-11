// UMLOne — in-place text editing on the diagram.
//
// SVG <text> cannot be typed into. The two ways round that are <foreignObject> holding an
// HTML input, or an HTML input positioned over the canvas. This uses the second: a real
// <input> in #canvas-host, placed over the line being edited using the same rectangle the
// renderer used to draw it. That buys the caret, selection, double-click-to-select-word,
// clipboard, undo-within-the-field, IME, and every other text behaviour a person expects,
// none of which would be free inside SVG.
//
// The line underneath is skipped while its editor is open (see `state.editing` in
// render.js), so the text never shows through the box.
//
// Members are edited as the exact string the diagram draws — `- /total: Money [0..1]` —
// and read back with model.parseAttribute / parseOperation. What you see is what you edit.

(function (ns) {
  'use strict';

  var MEMBER_KINDS = { attribute: 'attributes', operation: 'operations', literal: 'literals' };

  function listNameFor(kind) {
    return MEMBER_KINDS[kind] || null;
  }

  function create(options) {
    var host = options.host;
    var store = options.store;
    var getViewport = options.getViewport;
    var onRender = options.onRender || function () {};
    var onSelectNode = options.onSelectNode || function () {};

    var session = null;

    function isActive() {
      return !!session;
    }

    // What render.js needs in order to skip the line being edited.
    function editingState() {
      if (!session) { return null; }
      return { nodeId: session.nodeId, kind: session.kind, index: session.index };
    }

    // --- reading the current value -------------------------------------------

    function textFor(element, kind, index) {
      if (kind === 'name') { return element.name || ''; }
      if (kind === 'body') { return element.body || ''; }

      var list = element[listNameFor(kind)] || [];
      if (index >= list.length) { return ''; }
      var member = list[index];

      // Tested by position, not by truthiness: an enum literal is a string, and '' is a
      // legitimate value for a row that exists but has not been typed into yet.
      if (kind === 'literal') { return member; }

      // A freshly inserted row shows nothing rather than "+ ()", so there is nothing to
      // delete before typing.
      if (kind === 'attribute') {
        return ns.model.isBlankAttribute(member) ? '' : ns.model.formatAttribute(member);
      }
      return ns.model.isBlankOperation(member) ? '' : ns.model.formatOperation(member);
    }

    function resolve(nodeId) {
      var diagram = store.currentDiagram();
      if (!diagram) { return null; }
      var node = ns.diagram.findNode(diagram, nodeId);
      if (!node) { return null; }
      var element = ns.model.findElement(store.doc, node.ref);
      if (!element) { return null; }
      return { diagram: diagram, node: node, element: element };
    }

    function slotsFor(nodeId) {
      var found = resolve(nodeId);
      return found ? ns.render.editSlots(store.doc, found.element, found.node) : [];
    }

    function slotPosition(slots, kind, index) {
      for (var i = 0; i < slots.length; i++) {
        if (slots[i].kind === kind && slots[i].index === index) { return i; }
      }
      return 0;
    }

    // --- growing the box -----------------------------------------------------

    // Adding a member to a box that is already full would put the new row behind the clip
    // path, so the user would type into something invisible. Grow only — never shrink, or
    // deleting a row would fight a size the user chose deliberately.
    function growToFit(doc, element, nodeId) {
      var diagram = ns.diagram.findDiagram(doc, store.currentDiagramId);
      var node = diagram && ns.diagram.findNode(diagram, nodeId);
      if (!node) { return; }

      var size = ns.render.preferredSize(doc, element, node);
      if (size.w > node.w) { node.w = size.w; }
      if (size.h > node.h) { node.h = size.h; }
    }

    // --- committing ----------------------------------------------------------

    // Writes the field's text back to the model. An emptied member row is deleted: that,
    // with backspace-on-empty, is how members are removed without leaving the keyboard.
    function applyValue(text) {
      if (!session) { return false; }
      var s = session;

      return store.apply('edit ' + s.kind, function (doc) {
        var element = ns.model.findElement(doc, s.elementId);
        if (!element) { return false; }

        if (s.kind === 'name') {
          var name = text.trim();
          if (element.name === name) { return false; }
          element.name = name;
          growToFit(doc, element, s.nodeId);
          return true;
        }

        if (s.kind === 'body') {
          if (element.body === text) { return false; }
          element.body = text;
          growToFit(doc, element, s.nodeId);
          return true;
        }

        var list = element[listNameFor(s.kind)];
        if (!list) { return false; }

        var trimmed = text.trim();

        if (!trimmed) {
          if (s.index >= list.length) { return false; }
          list.splice(s.index, 1);
          return true;
        }

        var replacement;
        if (s.kind === 'literal') {
          replacement = trimmed;
        } else if (s.kind === 'attribute') {
          replacement = ns.model.parseAttribute(trimmed, list[s.index]);
        } else {
          replacement = ns.model.parseOperation(trimmed, list[s.index]);
        }

        var before = JSON.stringify(list[s.index] === undefined ? null : list[s.index]);
        if (s.index < list.length) {
          list[s.index] = replacement;
        } else {
          list.push(replacement);
        }

        if (before === JSON.stringify(replacement)) { return false; }
        growToFit(doc, element, s.nodeId);
        return true;
      });
    }

    // --- the field itself ----------------------------------------------------

    function position() {
      if (!session) { return; }

      var found = resolve(session.nodeId);
      if (!found) { close(); return; }

      var box = ns.render.editBox(store.doc, found.element, found.node, {
        kind: session.kind,
        index: session.index
      });
      if (!box) { close(); return; }

      var view = getViewport();
      var font = ns.measure.FONT[box.font] || ns.measure.FONT.member;
      var input = session.input;

      input.style.left = (view.x + box.x * view.scale) + 'px';
      input.style.top = (view.y + box.y * view.scale) + 'px';
      input.style.width = (box.w * view.scale) + 'px';
      input.style.height = (box.h * view.scale) + 'px';
      input.style.fontSize = (font.size * view.scale) + 'px';
      input.style.fontWeight = font.weight;
      input.style.fontStyle = font.style;
      input.style.textAlign = box.align === 'middle' ? 'center' : 'left';
    }

    function onKeyDown(evt) {
      // Navigation swaps one field for the next; a stray event from the outgoing field
      // must not be applied to the incoming one.
      if (!session || evt.target !== session.input) { return; }

      var isMember = !!listNameFor(session.kind);

      if (evt.key === 'Escape') {
        evt.preventDefault();
        evt.stopPropagation();
        cancel();
        return;
      }

      if (evt.key === 'Enter') {
        // In a note, Shift+Enter is a line break — the only place a newline is content.
        if (session.kind === 'body' && evt.shiftKey) { return; }

        evt.preventDefault();
        evt.stopPropagation();

        // Shift+Enter on a member row adds a sibling below and keeps typing, which is how
        // a list gets built without reaching for the mouse.
        if (isMember && evt.shiftKey) {
          insertSibling();
        } else {
          commit();
        }
        return;
      }

      if (evt.key === 'Tab') {
        evt.preventDefault();
        evt.stopPropagation();
        move(evt.shiftKey ? -1 : 1);
        return;
      }

      if (evt.key === 'ArrowUp' || evt.key === 'ArrowDown') {
        // In a note the arrows belong to the text, which is genuinely multi-line.
        if (session.kind === 'body') { return; }
        evt.preventDefault();
        evt.stopPropagation();
        move(evt.key === 'ArrowUp' ? -1 : 1);
        return;
      }

      if (evt.key === 'Backspace' && isMember && session.input.value === '') {
        evt.preventDefault();
        evt.stopPropagation();
        deleteRow();
        return;
      }

      // Everything else is ordinary typing. Stop it reaching the canvas handler, which
      // would treat Delete as "delete the selected element".
      evt.stopPropagation();
    }

    function onBlur(evt) {
      // Navigation removes the field before creating the next one; that must not be read
      // as the user clicking away. Browsers disagree about whether removing a focused
      // element fires blur and when, so this checks the event came from the field that is
      // actually open — otherwise a late blur from the outgoing field would commit the
      // incoming one's contents to the wrong row.
      if (!session || session.closing || evt.target !== session.input) { return; }
      commit();
    }

    function buildInput(box) {
      var input = document.createElement(box.multiline ? 'textarea' : 'input');
      if (!box.multiline) { input.type = 'text'; }

      input.className = 'inline-editor';
      input.spellcheck = false;
      input.setAttribute('autocomplete', 'off');
      input.setAttribute('autocorrect', 'off');
      input.setAttribute('autocapitalize', 'off');

      input.addEventListener('keydown', onKeyDown);
      input.addEventListener('blur', onBlur);
      // A click in the field is text placement, not a canvas gesture.
      input.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      input.addEventListener('dblclick', function (e) { e.stopPropagation(); });

      return input;
    }

    // --- opening and closing -------------------------------------------------

    // `target` is { nodeId, kind, index }, optionally with caret: 'end' | 'all'.
    function begin(target) {
      closeSilently();

      var found = resolve(target.nodeId);
      if (!found) { return false; }

      var index = target.index || 0;
      var listName = listNameFor(target.kind);

      // Clicking the placeholder row of an empty compartment, or arriving past the end of
      // a list, means "make one here".
      if (listName) {
        var list = found.element[listName];
        if (!list) { return false; }
        // Bounds, not truthiness — an existing but still-empty literal is a valid row.
        if (index >= list.length) {
          index = list.length;
          var created = insertBlank(found.element.id, target.kind, index, found.node.id);
          if (!created) { return false; }
          found = resolve(target.nodeId);
          if (!found) { return false; }
        }
      }

      var box = ns.render.editBox(store.doc, found.element, found.node, {
        kind: target.kind,
        index: index
      });
      if (!box) { return false; }

      session = {
        nodeId: found.node.id,
        elementId: found.element.id,
        kind: target.kind,
        index: index,
        closing: false,
        input: buildInput(box)
      };

      host.appendChild(session.input);
      position();

      session.input.value = textFor(found.element, target.kind, index);
      onSelectNode(found.node.id);
      onRender();

      // preventScroll: focusing a box that is off to one side should not jerk the page.
      try {
        session.input.focus({ preventScroll: true });
      } catch (e) {
        session.input.focus();
      }

      if (target.caret === 'end') {
        var end = session.input.value.length;
        session.input.setSelectionRange(end, end);
      } else {
        session.input.select();
      }

      return true;
    }

    // `nodeId` is passed rather than read from `session`, because the first insertion
    // happens inside begin() when there is no session yet.
    function insertBlank(elementId, kind, at, nodeId) {
      var listName = listNameFor(kind);
      var inserted = false;

      store.apply('add ' + kind, function (doc) {
        var element = ns.model.findElement(doc, elementId);
        if (!element || !element[listName]) { return false; }

        var list = element[listName];
        var position = Math.max(0, Math.min(at, list.length));

        var blank;
        if (kind === 'attribute') {
          blank = ns.model.createAttribute({ name: '', type: '' });
        } else if (kind === 'operation') {
          blank = ns.model.createOperation({ name: '' });
        } else {
          blank = '';
        }

        list.splice(position, 0, blank);
        growToFit(doc, element, nodeId);
        inserted = true;
        return true;
      });

      return inserted;
    }

    // Removes the field without writing anything back.
    function closeSilently() {
      if (!session) { return; }
      session.closing = true;
      if (session.input.parentNode) {
        session.input.parentNode.removeChild(session.input);
      }
      session = null;
    }

    function close() {
      closeSilently();
      onRender();
    }

    function commit() {
      if (!session) { return false; }
      applyValue(session.input.value);
      close();
      return true;
    }

    function cancel() {
      if (!session) { return false; }
      close();
      return true;
    }

    // --- navigation ----------------------------------------------------------

    // Commits the current row, then opens whichever slot is `delta` away. Slot positions
    // are read before and after the commit, because emptying a row deletes it and shifts
    // everything below.
    function move(delta) {
      if (!session) { return; }

      var s = session;
      var before = slotsFor(s.nodeId);
      var position = slotPosition(before, s.kind, s.index);

      applyValue(s.input.value);

      var after = slotsFor(s.nodeId);
      if (!after.length) { close(); return; }

      var wanted = Math.max(0, Math.min(after.length - 1, position + delta));
      var next = after[wanted];

      closeSilently();
      begin({ nodeId: s.nodeId, kind: next.kind, index: next.index, caret: 'end' });
    }

    function insertSibling() {
      if (!session) { return; }

      var s = session;
      applyValue(s.input.value);

      var found = resolve(s.nodeId);
      if (!found) { close(); return; }

      var listName = listNameFor(s.kind);
      var list = found.element[listName] || [];
      // s.index may have shifted if the row we just left was emptied and removed.
      var at = Math.max(0, Math.min(s.index + 1, list.length));

      if (!insertBlank(s.elementId, s.kind, at, s.nodeId)) { close(); return; }

      closeSilently();
      begin({ nodeId: s.nodeId, kind: s.kind, index: at, caret: 'end' });
    }

    // Backspace in an already-empty row: drop it and put the caret at the end of the row
    // above, exactly as a list behaves in a text editor.
    function deleteRow() {
      if (!session) { return; }

      var s = session;
      var before = slotsFor(s.nodeId);
      var position = slotPosition(before, s.kind, s.index);

      applyValue('');

      var after = slotsFor(s.nodeId);
      if (!after.length) { close(); return; }

      var wanted = Math.max(0, Math.min(after.length - 1, position - 1));
      var previous = after[wanted];

      closeSilently();
      begin({ nodeId: s.nodeId, kind: previous.kind, index: previous.index, caret: 'end' });
    }

    return {
      begin: begin,
      commit: commit,
      cancel: cancel,
      isActive: isActive,
      editingState: editingState,
      reposition: position
    };
  }

  ns.inlineEdit = { create: create, MEMBER_KINDS: MEMBER_KINDS };
})(UMLOne);
