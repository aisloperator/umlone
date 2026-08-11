// UMLOne — pointer and keyboard handling.
//
// Hit-testing is done by the DOM rather than by geometry: the renderer stamps
// data-node-id / data-edge-id / data-handle onto the shapes it draws, and `closest()`
// walks up from the event target. That means the thing you clicked is by definition the
// thing you saw, including for the deliberately-fat invisible stroke under each edge.
//
// Transient UI state (selection, viewport, the gesture in flight) lives here and never
// reaches the document. Nothing in this file is saved to a file.

(function (ns) {
  'use strict';

  var geo = ns.geometry;
  var GRID = 5;
  var MIN_SCALE = 0.2;
  var MAX_SCALE = 4;

  function create(options) {
    var svg = options.svg;
    var host = options.host;
    var store = options.store;
    var onRender = options.onRender || function () {};
    var onSelectionChange = options.onSelectionChange || function () {};
    var onStatus = options.onStatus || function () {};
    var onEditRequest = options.onEditRequest || function () {};
    // The tool can change without the palette being clicked — after placing an element,
    // after drawing a relationship, or on Escape — so the palette has to be told.
    var onToolChange = options.onToolChange || function () {};

    var state = {
      tool: { type: 'select', kind: null },
      selectedNodes: {},
      selectedEdges: {},
      viewport: { x: 40, y: 40, scale: 1 },
      pendingEdge: null,
      marquee: null,
      edgeSourceNodeId: null
    };

    var gesture = null;

    // --- coordinates ---------------------------------------------------------

    function toDiagram(evt) {
      var rect = svg.getBoundingClientRect();
      return {
        x: (evt.clientX - rect.left - state.viewport.x) / state.viewport.scale,
        y: (evt.clientY - rect.top - state.viewport.y) / state.viewport.scale
      };
    }

    function snapPoint(p, evt) {
      // Alt is the standard "let me place this precisely" override.
      if (evt && evt.altKey) { return p; }
      return { x: geo.snap(p.x, GRID), y: geo.snap(p.y, GRID) };
    }

    // --- selection -----------------------------------------------------------

    function selectionCount() {
      return Object.keys(state.selectedNodes).length +
             Object.keys(state.selectedEdges).length;
    }

    function clearSelection(silent) {
      state.selectedNodes = {};
      state.selectedEdges = {};
      state.edgeSourceNodeId = null;
      if (!silent) { announceSelection(); }
    }

    function selectNode(nodeId, additive) {
      if (!additive) { clearSelection(true); }
      state.selectedNodes[nodeId] = true;
      announceSelection();
    }

    function selectEdge(edgeId, additive) {
      if (!additive) { clearSelection(true); }
      state.selectedEdges[edgeId] = true;
      announceSelection();
    }

    function toggleNode(nodeId) {
      if (state.selectedNodes[nodeId]) {
        delete state.selectedNodes[nodeId];
      } else {
        state.selectedNodes[nodeId] = true;
      }
      announceSelection();
    }

    function selectAll() {
      var diagram = store.currentDiagram();
      if (!diagram) { return; }
      clearSelection(true);
      diagram.nodes.forEach(function (n) { state.selectedNodes[n.id] = true; });
      diagram.edges.forEach(function (e) { state.selectedEdges[e.id] = true; });
      announceSelection();
      onRender();
    }

    function announceSelection() {
      onSelectionChange(selectionSummary());
    }

    // What the inspector needs to know, resolved to model objects so it does not have to
    // re-derive them.
    function selectionSummary() {
      var diagram = store.currentDiagram();
      var nodeIds = Object.keys(state.selectedNodes);
      var edgeIds = Object.keys(state.selectedEdges);

      if (!diagram) {
        return { kind: 'none', nodeIds: [], edgeIds: [] };
      }

      if (nodeIds.length === 1 && edgeIds.length === 0) {
        var node = ns.diagram.findNode(diagram, nodeIds[0]);
        var element = node ? ns.model.findElement(store.doc, node.ref) : null;
        if (element) {
          return { kind: 'element', element: element, node: node,
                   nodeIds: nodeIds, edgeIds: edgeIds };
        }
      }

      if (edgeIds.length === 1 && nodeIds.length === 0) {
        var edge = ns.diagram.findEdge(diagram, edgeIds[0]);
        var rel = edge ? ns.model.findRelationship(store.doc, edge.ref) : null;
        if (rel) {
          return { kind: 'relationship', relationship: rel, edge: edge,
                   nodeIds: nodeIds, edgeIds: edgeIds };
        }
      }

      if (nodeIds.length + edgeIds.length === 0) {
        return { kind: 'none', nodeIds: [], edgeIds: [] };
      }

      return { kind: 'multiple', nodeIds: nodeIds, edgeIds: edgeIds };
    }

    // --- drag sets -----------------------------------------------------------

    // Dragging a package takes its contents along. Containment comes from the model
    // (element.owner), not from what happens to overlap on screen, so a box merely
    // sitting on top of a package is not dragged with it.
    function expandWithPackageContents(diagram, nodeIds) {
      var doc = store.doc;
      var included = {};
      var queue = nodeIds.slice();

      while (queue.length) {
        var nodeId = queue.shift();
        if (included[nodeId]) { continue; }
        included[nodeId] = true;

        var node = ns.diagram.findNode(diagram, nodeId);
        if (!node) { continue; }
        var element = ns.model.findElement(doc, node.ref);
        if (!element || element.kind !== 'package') { continue; }

        ns.model.childrenOf(doc, element.id).forEach(function (child) {
          var childNode = ns.diagram.nodeForElement(diagram, child.id);
          if (childNode && !included[childNode.id]) {
            queue.push(childNode.id);
          }
        });
      }

      return Object.keys(included);
    }

    // --- gestures ------------------------------------------------------------

    function beginNodeDrag(evt, nodeId) {
      var diagram = store.currentDiagram();
      if (!state.selectedNodes[nodeId]) {
        selectNode(nodeId, evt.shiftKey);
      }

      var ids = expandWithPackageContents(diagram, Object.keys(state.selectedNodes));
      var origins = {};
      ids.forEach(function (id) {
        var node = ns.diagram.findNode(diagram, id);
        if (node) { origins[id] = { x: node.x, y: node.y }; }
      });

      gesture = {
        type: 'move',
        token: ns.uid('drag'),
        start: toDiagram(evt),
        origins: origins,
        moved: false
      };
    }

    function beginResize(evt, nodeId, handle) {
      var diagram = store.currentDiagram();
      var node = ns.diagram.findNode(diagram, nodeId);
      if (!node) { return; }

      gesture = {
        type: 'resize',
        token: ns.uid('resize'),
        handle: handle,
        nodeId: nodeId,
        start: toDiagram(evt),
        origin: { x: node.x, y: node.y, w: node.w, h: node.h }
      };
    }

    function beginWaypointDrag(evt, edgeId, index) {
      gesture = {
        type: 'waypoint',
        token: ns.uid('waypoint'),
        edgeId: edgeId,
        index: index
      };
    }

    function beginPan(evt) {
      gesture = {
        type: 'pan',
        startClient: { x: evt.clientX, y: evt.clientY },
        origin: { x: state.viewport.x, y: state.viewport.y }
      };
      svg.classList.add('panning');
    }

    function beginMarquee(evt) {
      gesture = {
        type: 'marquee',
        start: toDiagram(evt),
        additive: evt.shiftKey
      };
      if (!evt.shiftKey) { clearSelection(); }
    }

    // --- pointer handlers ----------------------------------------------------

    function onPointerDown(evt) {
      if (evt.button !== 0 && evt.button !== 1) { return; }

      var diagram = store.currentDiagram();
      if (!diagram) { return; }

      svg.setPointerCapture(evt.pointerId);

      // Middle button, or Ctrl/Cmd with the select tool, pans.
      if (evt.button === 1 || (evt.ctrlKey || evt.metaKey)) {
        beginPan(evt);
        return;
      }

      var handle = evt.target.closest ? evt.target.closest('.handle') : null;
      var nodeGroup = evt.target.closest ? evt.target.closest('.node') : null;
      var edgeGroup = evt.target.closest ? evt.target.closest('.edge') : null;

      if (state.tool.type === 'node') {
        placeNewNode(evt);
        return;
      }

      if (state.tool.type === 'edge') {
        handleEdgeToolClick(evt, nodeGroup);
        return;
      }

      if (handle) {
        var waypointIndex = handle.getAttribute('data-waypoint-index');
        if (waypointIndex !== null) {
          beginWaypointDrag(evt, handle.getAttribute('data-edge-id'),
                            parseInt(waypointIndex, 10));
        } else {
          beginResize(evt, handle.getAttribute('data-node-id'),
                      handle.getAttribute('data-handle'));
        }
        return;
      }

      if (nodeGroup) {
        beginNodeDrag(evt, nodeGroup.getAttribute('data-node-id'));
        onRender();
        return;
      }

      if (edgeGroup) {
        selectEdge(edgeGroup.getAttribute('data-edge-id'), evt.shiftKey);
        onRender();
        return;
      }

      beginMarquee(evt);
      onRender();
    }

    function onPointerMove(evt) {
      if (state.tool.type === 'edge' && state.pendingEdge) {
        state.pendingEdge.to = toDiagram(evt);
        onRender();
        return;
      }

      if (!gesture) { return; }

      if (gesture.type === 'pan') {
        state.viewport.x = gesture.origin.x + (evt.clientX - gesture.startClient.x);
        state.viewport.y = gesture.origin.y + (evt.clientY - gesture.startClient.y);
        onRender();
        return;
      }

      var point = toDiagram(evt);

      if (gesture.type === 'move') {
        var dx = point.x - gesture.start.x;
        var dy = point.y - gesture.start.y;
        if (!gesture.moved && Math.abs(dx) < 2 && Math.abs(dy) < 2) { return; }
        gesture.moved = true;

        store.applyContinuous(gesture.token, 'move', function (doc) {
          var diagram = ns.diagram.findDiagram(doc, store.currentDiagramId);
          Object.keys(gesture.origins).forEach(function (id) {
            var node = ns.diagram.findNode(diagram, id);
            if (!node) { return; }
            var moved = snapPoint({
              x: gesture.origins[id].x + dx,
              y: gesture.origins[id].y + dy
            }, evt);
            node.x = moved.x;
            node.y = moved.y;
          });
        });
        return;
      }

      if (gesture.type === 'resize') {
        applyResize(point, evt);
        return;
      }

      if (gesture.type === 'waypoint') {
        var snapped = snapPoint(point, evt);
        store.applyContinuous(gesture.token, 'move bend', function (doc) {
          var diagram = ns.diagram.findDiagram(doc, store.currentDiagramId);
          var edge = ns.diagram.findEdge(diagram, gesture.edgeId);
          if (edge && edge.waypoints[gesture.index]) {
            edge.waypoints[gesture.index] = [snapped.x, snapped.y];
          }
        });
        return;
      }

      if (gesture.type === 'marquee') {
        state.marquee = geo.fromPoints(gesture.start, point);
        onRender();
      }
    }

    function applyResize(point, evt) {
      var handle = gesture.handle;
      var origin = gesture.origin;
      var dx = point.x - gesture.start.x;
      var dy = point.y - gesture.start.y;

      var left = origin.x;
      var top = origin.y;
      var right = origin.x + origin.w;
      var bottom = origin.y + origin.h;

      if (handle.indexOf('w') >= 0) { left = origin.x + dx; }
      if (handle.indexOf('e') >= 0) { right = origin.x + origin.w + dx; }
      if (handle.indexOf('n') >= 0) { top = origin.y + dy; }
      if (handle.indexOf('s') >= 0) { bottom = origin.y + origin.h + dy; }

      var topLeft = snapPoint({ x: left, y: top }, evt);
      var bottomRight = snapPoint({ x: right, y: bottom }, evt);

      // Clamp rather than allowing the box to invert when dragged past its opposite edge.
      // The clamp works off the snapped corner, not the raw one, or the box would drift
      // by up to one grid step at the minimum size.
      var w = Math.max(ns.validate.MIN_NODE_W, bottomRight.x - topLeft.x);
      var h = Math.max(ns.validate.MIN_NODE_H, bottomRight.y - topLeft.y);
      if (handle.indexOf('w') >= 0) { topLeft.x = bottomRight.x - w; }
      if (handle.indexOf('n') >= 0) { topLeft.y = bottomRight.y - h; }

      store.applyContinuous(gesture.token, 'resize', function (doc) {
        var diagram = ns.diagram.findDiagram(doc, store.currentDiagramId);
        var node = ns.diagram.findNode(diagram, gesture.nodeId);
        if (!node) { return; }
        node.x = handle.indexOf('w') >= 0 ? topLeft.x : origin.x;
        node.y = handle.indexOf('n') >= 0 ? topLeft.y : origin.y;
        node.w = w;
        node.h = h;
      });
    }

    function onPointerUp(evt) {
      if (svg.hasPointerCapture && svg.hasPointerCapture(evt.pointerId)) {
        svg.releasePointerCapture(evt.pointerId);
      }
      svg.classList.remove('panning');

      if (!gesture) { return; }

      if (gesture.type === 'marquee' && state.marquee) {
        applyMarquee(gesture.additive);
        state.marquee = null;
      }

      // A package that was dragged somewhere new may now sit inside a different package.
      if (gesture.type === 'move' && gesture.moved) {
        reparentMovedNodes(Object.keys(gesture.origins));
      }

      store.endGesture();
      gesture = null;
      onRender();
      announceSelection();
    }

    function applyMarquee(additive) {
      var diagram = store.currentDiagram();
      if (!diagram) { return; }
      if (!additive) { clearSelection(true); }

      diagram.nodes.forEach(function (node) {
        if (geo.intersects(state.marquee, ns.diagram.nodeRect(node))) {
          state.selectedNodes[node.id] = true;
        }
      });

      diagram.edges.forEach(function (edge) {
        var points = ns.diagram.routePoints(store.doc, diagram, edge);
        if (!points) { return; }
        var inside = points.some(function (p) {
          return geo.contains(state.marquee, p);
        });
        if (inside) { state.selectedEdges[edge.id] = true; }
      });

      announceSelection();
    }

    function reparentMovedNodes(nodeIds) {
      store.apply('reparent', function (doc) {
        var diagram = ns.diagram.findDiagram(doc, store.currentDiagramId);
        if (!diagram) { return false; }

        var changed = false;
        nodeIds.forEach(function (id) {
          var node = ns.diagram.findNode(diagram, id);
          if (!node) { return; }
          var element = ns.model.findElement(doc, node.ref);
          if (!element || element.kind === 'package' || element.kind === 'comment') {
            return;
          }
          var before = element.owner;
          element.owner = null;
          ns.commands.assignOwnerFromEnclosingPackage(doc, diagram, node, element);
          if (element.owner !== before) { changed = true; }
        });
        return changed;
      });
    }

    // --- tool actions --------------------------------------------------------

    function placeNewNode(evt) {
      var point = snapPoint(toDiagram(evt), evt);
      var created = ns.commands.createElementOn(store, state.tool.kind, point.x, point.y);
      setTool('select', null);
      if (created) {
        clearSelection(true);
        state.selectedNodes[created.nodeId] = true;
        announceSelection();
        onEditRequest(created.elementId);
      }
      onRender();
    }

    function handleEdgeToolClick(evt, nodeGroup) {
      if (!nodeGroup) {
        // Clicking empty space abandons a half-drawn relationship.
        state.pendingEdge = null;
        state.edgeSourceNodeId = null;
        onRender();
        return;
      }

      var diagram = store.currentDiagram();
      var nodeId = nodeGroup.getAttribute('data-node-id');
      var node = ns.diagram.findNode(diagram, nodeId);
      if (!node) { return; }

      if (!state.edgeSourceNodeId) {
        state.edgeSourceNodeId = nodeId;
        var centre = geo.center(ns.diagram.nodeRect(node));
        state.pendingEdge = { from: centre, to: centre };
        onStatus('Now click the ' +
                 ns.model.endSemantics(state.tool.kind).target.toLowerCase() + '.');
        onRender();
        return;
      }

      var sourceNode = ns.diagram.findNode(diagram, state.edgeSourceNodeId);
      state.pendingEdge = null;
      state.edgeSourceNodeId = null;

      if (!sourceNode) { onRender(); return; }

      var problem = ns.commands.connect(store, state.tool.kind, sourceNode.ref, node.ref);
      if (problem) {
        onStatus(problem, 'error');
      } else {
        onStatus('');
        setTool('select', null);
      }
      onRender();
    }

    function setTool(type, kind) {
      state.tool = { type: type, kind: kind };
      state.pendingEdge = null;
      state.edgeSourceNodeId = null;

      svg.classList.remove('tool-node', 'tool-edge');
      if (type === 'node') { svg.classList.add('tool-node'); }
      if (type === 'edge') { svg.classList.add('tool-edge'); }

      if (type === 'edge') {
        onStatus('Click the ' +
                 ns.model.endSemantics(kind).source.toLowerCase() + ' element.');
      } else {
        onStatus('');
      }

      onToolChange(type, kind);
      onRender();
    }

    // --- double click --------------------------------------------------------

    function onDoubleClick(evt) {
      var diagram = store.currentDiagram();
      if (!diagram) { return; }

      var handle = evt.target.closest ? evt.target.closest('.handle') : null;
      if (handle && handle.getAttribute('data-waypoint-index') !== null) {
        removeWaypoint(handle.getAttribute('data-edge-id'),
                       parseInt(handle.getAttribute('data-waypoint-index'), 10));
        return;
      }

      var edgeGroup = evt.target.closest ? evt.target.closest('.edge') : null;
      if (edgeGroup) {
        insertWaypoint(edgeGroup.getAttribute('data-edge-id'), toDiagram(evt), evt);
        return;
      }

      var nodeGroup = evt.target.closest ? evt.target.closest('.node') : null;
      if (nodeGroup) {
        var node = ns.diagram.findNode(diagram, nodeGroup.getAttribute('data-node-id'));
        if (node) { onEditRequest(node.ref); }
      }
    }

    function insertWaypoint(edgeId, point, evt) {
      var snapped = snapPoint(point, evt);
      store.apply('add bend', function (doc) {
        var diagram = ns.diagram.findDiagram(doc, store.currentDiagramId);
        var edge = ns.diagram.findEdge(diagram, edgeId);
        if (!edge) { return false; }

        var points = ns.diagram.routePoints(doc, diagram, edge);
        if (!points) { return false; }

        // Insert into the segment the user actually clicked, not at the end of the list,
        // or the line would fold back on itself.
        var index = geo.nearestSegmentIndex(snapped, points);
        edge.waypoints.splice(index, 0, [snapped.x, snapped.y]);
        return true;
      });
      selectEdge(edgeId, false);
      onRender();
    }

    function removeWaypoint(edgeId, index) {
      store.apply('remove bend', function (doc) {
        var diagram = ns.diagram.findDiagram(doc, store.currentDiagramId);
        var edge = ns.diagram.findEdge(diagram, edgeId);
        if (!edge || !edge.waypoints[index]) { return false; }
        edge.waypoints.splice(index, 1);
        return true;
      });
      onRender();
    }

    // --- zoom ----------------------------------------------------------------

    function onWheel(evt) {
      // Ctrl/Cmd + wheel zooms, plain wheel scrolls. This is what draw.io, Figma, and
      // every browser do, so it is what fingers expect.
      if (evt.ctrlKey || evt.metaKey) {
        evt.preventDefault();
        zoomAt(evt, Math.pow(0.999, evt.deltaY));
        return;
      }

      evt.preventDefault();
      if (evt.shiftKey) {
        state.viewport.x -= evt.deltaY;
      } else {
        state.viewport.x -= evt.deltaX;
        state.viewport.y -= evt.deltaY;
      }
      onRender();
    }

    function zoomAt(evt, factor) {
      var rect = svg.getBoundingClientRect();
      var cx = evt.clientX - rect.left;
      var cy = evt.clientY - rect.top;
      applyZoom(state.viewport.scale * factor, cx, cy);
    }

    // Keeps the point under (cx, cy) fixed while the scale changes, so zooming feels
    // anchored to the cursor rather than to the corner.
    function applyZoom(scale, cx, cy) {
      var next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
      var ratio = next / state.viewport.scale;
      state.viewport.x = cx - (cx - state.viewport.x) * ratio;
      state.viewport.y = cy - (cy - state.viewport.y) * ratio;
      state.viewport.scale = next;
      onRender();
    }

    function zoomBy(factor) {
      var rect = svg.getBoundingClientRect();
      applyZoom(state.viewport.scale * factor, rect.width / 2, rect.height / 2);
    }

    function fitToContent() {
      var diagram = store.currentDiagram();
      if (!diagram) { return; }

      var box = ns.diagram.bounds(diagram);
      var rect = svg.getBoundingClientRect();

      if (!box || box.w === 0 || box.h === 0) {
        state.viewport = { x: 40, y: 40, scale: 1 };
        onRender();
        return;
      }

      var margin = 40;
      var scale = Math.min(
        (rect.width - margin * 2) / box.w,
        (rect.height - margin * 2) / box.h,
        MAX_SCALE
      );
      scale = Math.max(MIN_SCALE, scale);

      state.viewport = {
        scale: scale,
        x: (rect.width - box.w * scale) / 2 - box.x * scale,
        y: (rect.height - box.h * scale) / 2 - box.y * scale
      };
      onRender();
    }

    // --- keyboard ------------------------------------------------------------

    function onKeyDown(evt) {
      // Never steal keys from a text field in the inspector.
      var tag = evt.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if (evt.key === 'Escape') { evt.target.blur(); }
        return;
      }

      var mod = evt.ctrlKey || evt.metaKey;

      if (mod && evt.key.toLowerCase() === 'z') {
        evt.preventDefault();
        if (evt.shiftKey) { store.redo(); } else { store.undo(); }
        pruneSelection();
        onRender();
        announceSelection();
        return;
      }

      if (mod && evt.key.toLowerCase() === 'y') {
        evt.preventDefault();
        store.redo();
        pruneSelection();
        onRender();
        announceSelection();
        return;
      }

      if (mod && evt.key.toLowerCase() === 'a') {
        evt.preventDefault();
        selectAll();
        return;
      }

      if (evt.key === 'Delete' || evt.key === 'Backspace') {
        evt.preventDefault();
        deleteSelection(evt.shiftKey);
        return;
      }

      if (evt.key === 'Escape') {
        setTool('select', null);
        clearSelection();
        onRender();
        return;
      }

      // Arrow keys nudge; holding shift nudges by a whole grid step.
      if (evt.key.indexOf('Arrow') === 0 && selectionCount() > 0) {
        evt.preventDefault();
        var step = evt.shiftKey ? GRID * 2 : 1;
        var dx = evt.key === 'ArrowLeft' ? -step : evt.key === 'ArrowRight' ? step : 0;
        var dy = evt.key === 'ArrowUp' ? -step : evt.key === 'ArrowDown' ? step : 0;
        nudge(dx, dy);
      }
    }

    function nudge(dx, dy) {
      var diagram = store.currentDiagram();
      if (!diagram) { return; }
      var ids = expandWithPackageContents(diagram, Object.keys(state.selectedNodes));
      if (!ids.length) { return; }

      store.apply('nudge', function (doc) {
        var target = ns.diagram.findDiagram(doc, store.currentDiagramId);
        ids.forEach(function (id) {
          var node = ns.diagram.findNode(target, id);
          if (node) { node.x += dx; node.y += dy; }
        });
        return true;
      });
      onRender();
    }

    function deleteSelection(viewOnly) {
      var nodeIds = Object.keys(state.selectedNodes);
      var edgeIds = Object.keys(state.selectedEdges);
      if (!nodeIds.length && !edgeIds.length) { return; }

      if (viewOnly) {
        ns.commands.removeFromDiagram(store, nodeIds, edgeIds);
        onStatus('Removed from this diagram; still in the model.');
      } else {
        ns.commands.deleteFromModel(store, nodeIds, edgeIds);
        onStatus('');
      }

      clearSelection();
      onRender();
    }

    // After undo, redo, or a delete, the selection can name things that no longer exist.
    function pruneSelection() {
      var diagram = store.currentDiagram();
      if (!diagram) { clearSelection(true); return; }

      Object.keys(state.selectedNodes).forEach(function (id) {
        if (!ns.diagram.findNode(diagram, id)) { delete state.selectedNodes[id]; }
      });
      Object.keys(state.selectedEdges).forEach(function (id) {
        if (!ns.diagram.findEdge(diagram, id)) { delete state.selectedEdges[id]; }
      });
    }

    // --- wiring --------------------------------------------------------------

    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerup', onPointerUp);
    svg.addEventListener('pointercancel', onPointerUp);
    svg.addEventListener('dblclick', onDoubleClick);
    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    document.addEventListener('keydown', onKeyDown);

    return {
      state: state,
      setTool: setTool,
      selectAll: selectAll,
      clearSelection: clearSelection,
      selectNode: selectNode,
      selectEdge: selectEdge,
      toggleNode: toggleNode,
      selectionSummary: selectionSummary,
      pruneSelection: pruneSelection,
      deleteSelection: deleteSelection,
      zoomBy: zoomBy,
      fitToContent: fitToContent,
      announceSelection: announceSelection
    };
  }

  ns.interact = { create: create, GRID: GRID };
})(UMLOne);
