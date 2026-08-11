// UMLOne — the document store and undo stack.
//
// Every change to the document goes through `store.apply`. That is not a style
// preference: apply() snapshots before it mutates, so routing all edits through it makes
// undo correct by construction rather than by remembering to add it each time. Nothing
// outside this file should assign to store.doc.
//
// Undo is snapshot-based. Inverse operations would use less memory, but they are a
// well-known source of subtle bugs (a half-written inverse silently corrupts state), and
// a class diagram serializes to a few tens of kilobytes. Copying that is not measurable
// next to a redraw.

(function (ns) {
  'use strict';

  var HISTORY_LIMIT = 100;

  function Store(doc) {
    ns.Emitter.call(this);
    this.doc = doc || ns.model.createDocument();
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.fileName = null;
    this.currentDiagramId = this.doc.diagrams.length ? this.doc.diagrams[0].id : null;
  }

  Store.prototype = Object.create(ns.Emitter.prototype);
  Store.prototype.constructor = Store;

  Store.prototype.currentDiagram = function () {
    return ns.diagram.findDiagram(this.doc, this.currentDiagramId);
  };

  Store.prototype.setCurrentDiagram = function (id) {
    if (this.currentDiagramId === id) { return; }
    this.currentDiagramId = id;
    this.emit('diagram-changed', id);
    this.emit('change', { reason: 'diagram-changed' });
  };

  // Runs `mutate(doc)` with undo already taken care of. Return false from `mutate` to
  // abandon the edit — the snapshot is discarded and no change is announced, which keeps
  // no-op gestures (a drag that moved nothing, a cancelled dialog) out of the history.
  Store.prototype.apply = function (label, mutate) {
    var snapshot = ns.clone(this.doc);
    var result = mutate(this.doc);

    if (result === false) {
      return false;
    }

    this.undoStack.push({ label: label, doc: snapshot });
    if (this.undoStack.length > HISTORY_LIMIT) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
    this.dirty = true;

    this.emit('change', { reason: label });
    return true;
  };

  // For continuous gestures (dragging a box). The first call snapshots; subsequent calls
  // with the same token mutate without pushing more history, so one drag is one undo
  // rather than one per mouse-move.
  Store.prototype.applyContinuous = function (token, label, mutate) {
    if (this._gestureToken !== token) {
      this._gestureToken = token;
      this.undoStack.push({ label: label, doc: ns.clone(this.doc) });
      if (this.undoStack.length > HISTORY_LIMIT) {
        this.undoStack.shift();
      }
      this.redoStack.length = 0;
    }

    mutate(this.doc);
    this.dirty = true;
    this.emit('change', { reason: label, continuous: true });
  };

  Store.prototype.endGesture = function () {
    this._gestureToken = null;
  };

  Store.prototype.canUndo = function () { return this.undoStack.length > 0; };
  Store.prototype.canRedo = function () { return this.redoStack.length > 0; };

  Store.prototype.undo = function () {
    if (!this.undoStack.length) { return false; }
    var entry = this.undoStack.pop();
    this.redoStack.push({ label: entry.label, doc: ns.clone(this.doc) });
    this.doc = entry.doc;
    this.dirty = true;
    this._ensureCurrentDiagram();
    this.emit('change', { reason: 'undo:' + entry.label });
    return true;
  };

  Store.prototype.redo = function () {
    if (!this.redoStack.length) { return false; }
    var entry = this.redoStack.pop();
    this.undoStack.push({ label: entry.label, doc: ns.clone(this.doc) });
    this.doc = entry.doc;
    this.dirty = true;
    this._ensureCurrentDiagram();
    this.emit('change', { reason: 'redo:' + entry.label });
    return true;
  };

  // Undoing past the creation of the diagram you are looking at would leave the editor
  // pointing at nothing.
  Store.prototype._ensureCurrentDiagram = function () {
    if (!ns.diagram.findDiagram(this.doc, this.currentDiagramId)) {
      this.currentDiagramId = this.doc.diagrams.length ? this.doc.diagrams[0].id : null;
      this.emit('diagram-changed', this.currentDiagramId);
    }
  };

  // Replaces the whole document — opening a file, or File > New. History does not carry
  // across, because undoing into a document the user has closed is more confusing than
  // helpful.
  Store.prototype.replace = function (doc, fileName) {
    this.doc = doc;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.dirty = false;
    this.fileName = fileName || null;
    this.currentDiagramId = doc.diagrams.length ? doc.diagrams[0].id : null;
    this.emit('replaced', doc);
    this.emit('diagram-changed', this.currentDiagramId);
    this.emit('change', { reason: 'replace' });
  };

  Store.prototype.markSaved = function (fileName) {
    this.dirty = false;
    if (fileName) { this.fileName = fileName; }
    this.emit('change', { reason: 'saved' });
  };

  // --- composite operations --------------------------------------------------
  //
  // These touch both halves of the document at once, so they live together here rather
  // than being reassembled correctly at each call site.

  function createElementOn(store, kind, x, y) {
    var created = null;

    store.apply('add ' + kind, function (doc) {
      var diagram = ns.diagram.findDiagram(doc, store.currentDiagramId);
      if (!diagram) { return false; }

      var element = ns.model.createElement(kind, defaultNameFor(doc, kind));
      ns.model.addElement(doc, element);

      var size = ns.diagram.defaultSize(kind);
      var node = ns.diagram.addNode(diagram, element, x, y, size.w, size.h);

      // A package dropped over existing boxes should adopt them, which is what the user
      // means by drawing a package around things.
      if (kind === 'package') {
        adoptEnclosed(doc, diagram, node, element);
        ns.diagram.sendToBack(diagram, node.id);
      } else {
        assignOwnerFromEnclosingPackage(doc, diagram, node, element);
      }

      created = { elementId: element.id, nodeId: node.id };
      return true;
    });

    return created;
  }

  function defaultNameFor(doc, kind) {
    if (kind === 'comment') { return { body: 'Note' }; }

    var stem = {
      'class': 'Class',
      'interface': 'Interface',
      'enumeration': 'Enum',
      'package': 'package'
    }[kind] || 'Element';

    var n = 1;
    var taken = {};
    doc.model.elements.forEach(function (el) {
      if (el.name) { taken[el.name] = true; }
    });
    while (taken[stem + n]) { n++; }

    return { name: stem + n };
  }

  function adoptEnclosed(doc, diagram, packageNode, packageElement) {
    var box = ns.diagram.nodeRect(packageNode);
    diagram.nodes.forEach(function (other) {
      if (other.id === packageNode.id) { return; }
      if (!ns.geometry.containsRect(box, ns.diagram.nodeRect(other))) { return; }
      var element = ns.model.findElement(doc, other.ref);
      if (!element || element.kind === 'comment') { return; }
      if (ns.model.canOwn(doc, element.id, packageElement.id)) {
        element.owner = packageElement.id;
      }
    });
  }

  function assignOwnerFromEnclosingPackage(doc, diagram, node, element) {
    if (element.kind === 'comment') { return; }
    var box = ns.diagram.nodeRect(node);
    var best = null;

    diagram.nodes.forEach(function (other) {
      if (other.id === node.id) { return; }
      var candidate = ns.model.findElement(doc, other.ref);
      if (!candidate || candidate.kind !== 'package') { return; }
      var otherRect = ns.diagram.nodeRect(other);
      if (!ns.geometry.containsRect(otherRect, box)) { return; }
      // Innermost package wins when they nest.
      if (!best || otherRect.w * otherRect.h < best.rect.w * best.rect.h) {
        best = { element: candidate, rect: otherRect };
      }
    });

    if (best && ns.model.canOwn(doc, element.id, best.element.id)) {
      element.owner = best.element.id;
    }
  }

  // Returns an error string instead of throwing, because the caller is a click handler
  // that wants to show a message rather than break.
  function connect(store, kind, sourceElementId, targetElementId) {
    var problem = null;

    if (kind === 'generalization' || kind === 'realization') {
      if (sourceElementId === targetElementId) {
        return 'An element cannot generalize itself.';
      }
    }

    store.apply('add ' + kind, function (doc) {
      var diagram = ns.diagram.findDiagram(doc, store.currentDiagramId);
      if (!diagram) { problem = 'No diagram is open.'; return false; }

      var source = ns.model.findElement(doc, sourceElementId);
      var target = ns.model.findElement(doc, targetElementId);
      if (!source || !target) { problem = 'One of the elements is missing.'; return false; }

      if (kind === 'annotation' && source.kind !== 'comment') {
        if (target.kind === 'comment') {
          var swap = source; source = target; target = swap;
        } else {
          problem = 'A note link must start at a note.';
          return false;
        }
      }

      var rel = ns.model.createRelationship(kind, source.id, target.id);
      if (ns.model.endSemantics(kind).labelled) {
        rel.ends[1].navigable = true;
      }
      ns.model.addRelationship(doc, rel);
      ns.diagram.addEdge(diagram, rel);
      return true;
    });

    return problem;
  }

  // Deletes the *model* elements and relationships behind a selection, cascading to every
  // diagram. This is the destructive one; removeFromDiagram below only hides things.
  function deleteFromModel(store, nodeIds, edgeIds) {
    return store.apply('delete', function (doc) {
      var diagram = ns.diagram.findDiagram(doc, store.currentDiagramId);
      if (!diagram) { return false; }

      var elementIds = nodeIds
        .map(function (id) {
          var node = ns.diagram.findNode(diagram, id);
          return node ? node.ref : null;
        })
        .filter(Boolean);

      var relationshipIds = edgeIds
        .map(function (id) {
          var edge = ns.diagram.findEdge(diagram, id);
          return edge ? edge.ref : null;
        })
        .filter(Boolean);

      if (!elementIds.length && !relationshipIds.length) { return false; }

      relationshipIds.forEach(function (id) { ns.model.removeRelationship(doc, id); });
      elementIds.forEach(function (id) { ns.model.removeElement(doc, id); });

      ns.diagram.prune(doc);
      return true;
    });
  }

  // Removes only the view. The element survives in the model and on other diagrams.
  function removeFromDiagram(store, nodeIds, edgeIds) {
    return store.apply('remove from diagram', function (doc) {
      var diagram = ns.diagram.findDiagram(doc, store.currentDiagramId);
      if (!diagram) { return false; }
      if (!nodeIds.length && !edgeIds.length) { return false; }

      edgeIds.forEach(function (id) { ns.diagram.removeEdge(diagram, id); });
      nodeIds.forEach(function (id) { ns.diagram.removeNode(doc, diagram, id); });
      return true;
    });
  }

  function sizeToFit(store, nodeIds) {
    return store.apply('size to fit', function (doc) {
      var diagram = ns.diagram.findDiagram(doc, store.currentDiagramId);
      if (!diagram) { return false; }

      var changed = false;
      nodeIds.forEach(function (id) {
        var node = ns.diagram.findNode(diagram, id);
        if (!node) { return; }
        var element = ns.model.findElement(doc, node.ref);
        if (!element) { return; }
        var size = ns.render.preferredSize(doc, element, node);
        if (node.w !== size.w || node.h !== size.h) {
          node.w = size.w;
          node.h = size.h;
          changed = true;
        }
      });
      return changed;
    });
  }

  function addDiagram(store, name) {
    var id = null;
    store.apply('add diagram', function (doc) {
      var diagram = ns.diagram.createDiagram(name);
      doc.diagrams.push(diagram);
      id = diagram.id;
      return true;
    });
    if (id) { store.setCurrentDiagram(id); }
    return id;
  }

  function removeDiagram(store, diagramId) {
    return store.apply('delete diagram', function (doc) {
      if (doc.diagrams.length <= 1) { return false; }
      doc.diagrams = doc.diagrams.filter(function (d) { return d.id !== diagramId; });
      return true;
    });
  }

  // Puts an element that already exists in the model onto the current diagram, along with
  // any relationships whose other end is now also visible.
  function showOnDiagram(store, elementId, x, y) {
    return store.apply('add to diagram', function (doc) {
      var diagram = ns.diagram.findDiagram(doc, store.currentDiagramId);
      var element = ns.model.findElement(doc, elementId);
      if (!diagram || !element) { return false; }
      if (ns.diagram.nodeForElement(diagram, elementId)) { return false; }

      var size = ns.render.preferredSize(doc, element, null);
      var fallback = ns.diagram.defaultSize(element.kind);
      ns.diagram.addNode(diagram, element, x, y,
                         Math.max(size.w, fallback.w), Math.max(size.h, fallback.h));
      ns.diagram.syncEdges(doc, diagram);
      return true;
    });
  }

  ns.commands = {
    Store: Store,
    createElementOn: createElementOn,
    connect: connect,
    deleteFromModel: deleteFromModel,
    removeFromDiagram: removeFromDiagram,
    sizeToFit: sizeToFit,
    addDiagram: addDiagram,
    removeDiagram: removeDiagram,
    showOnDiagram: showOnDiagram,
    assignOwnerFromEnclosingPackage: assignOwnerFromEnclosingPackage
  };
})(UMLOne);
