// UMLOne — the diagram half of a document: where things sit, how big they are, how edges
// bend. Diagram objects hold ids pointing into the model and never copy semantic data,
// so renaming a class updates every diagram showing it for free.

(function (ns) {
  'use strict';

  var geo = ns.geometry;

  var DEFAULT_SIZE = {
    'class': { w: 180, h: 90 },
    'interface': { w: 180, h: 80 },
    'enumeration': { w: 150, h: 90 },
    'package': { w: 260, h: 180 },
    'comment': { w: 170, h: 70 }
  };

  function defaultSize(kind) {
    return DEFAULT_SIZE[kind] || DEFAULT_SIZE['class'];
  }

  function createDiagram(name) {
    return {
      id: ns.uid('d'),
      name: name || 'Diagram',
      nodes: [],
      edges: []
    };
  }

  function createNode(elementId, x, y, w, h) {
    return {
      id: ns.uid('n'),
      ref: elementId,
      x: x,
      y: y,
      w: w,
      h: h,
      show: { attributes: true, operations: true }
    };
  }

  function createEdge(relationshipId, waypoints) {
    return {
      id: ns.uid('g'),
      ref: relationshipId,
      waypoints: waypoints || [],
      labels: {}
    };
  }

  // --- lookup ----------------------------------------------------------------

  function findDiagram(doc, id) {
    for (var i = 0; i < doc.diagrams.length; i++) {
      if (doc.diagrams[i].id === id) { return doc.diagrams[i]; }
    }
    return null;
  }

  function findNode(diagram, nodeId) {
    for (var i = 0; i < diagram.nodes.length; i++) {
      if (diagram.nodes[i].id === nodeId) { return diagram.nodes[i]; }
    }
    return null;
  }

  function findEdge(diagram, edgeId) {
    for (var i = 0; i < diagram.edges.length; i++) {
      if (diagram.edges[i].id === edgeId) { return diagram.edges[i]; }
    }
    return null;
  }

  // An element appears at most once per diagram, so this is a lookup and not a filter.
  // That invariant is what lets an edge resolve its endpoints from element ids alone.
  function nodeForElement(diagram, elementId) {
    for (var i = 0; i < diagram.nodes.length; i++) {
      if (diagram.nodes[i].ref === elementId) { return diagram.nodes[i]; }
    }
    return null;
  }

  function edgeForRelationship(diagram, relationshipId) {
    for (var i = 0; i < diagram.edges.length; i++) {
      if (diagram.edges[i].ref === relationshipId) { return diagram.edges[i]; }
    }
    return null;
  }

  function nodeRect(node) {
    return geo.rect(node.x, node.y, node.w, node.h);
  }

  function bounds(diagram) {
    var rects = diagram.nodes.map(nodeRect);
    diagram.edges.forEach(function (edge) {
      (edge.waypoints || []).forEach(function (p) {
        rects.push(geo.rect(p[0], p[1], 0, 0));
      });
    });
    return geo.union(rects);
  }

  // --- mutation --------------------------------------------------------------

  function addNode(diagram, element, x, y, w, h) {
    var existing = nodeForElement(diagram, element.id);
    if (existing) {
      return existing; // one node per element per diagram
    }
    var size = defaultSize(element.kind);
    var node = createNode(element.id, x, y, w || size.w, h || size.h);
    diagram.nodes.push(node);
    return node;
  }

  // Removes the view only — the element stays in the model and in any other diagram.
  // Edges that needed this node as an endpoint are no longer drawable here, so they go
  // too; the relationships behind them survive untouched.
  function removeNode(doc, diagram, nodeId) {
    var node = findNode(diagram, nodeId);
    if (!node) { return; }

    diagram.nodes = diagram.nodes.filter(function (n) { return n.id !== nodeId; });

    diagram.edges = diagram.edges.filter(function (edge) {
      var rel = ns.model.findRelationship(doc, edge.ref);
      if (!rel) { return false; }
      return !rel.ends.some(function (end) { return end.ref === node.ref; });
    });
  }

  function addEdge(diagram, relationship) {
    var existing = edgeForRelationship(diagram, relationship.id);
    if (existing) { return existing; }
    var edge = createEdge(relationship.id, []);
    diagram.edges.push(edge);
    return edge;
  }

  function removeEdge(diagram, edgeId) {
    diagram.edges = diagram.edges.filter(function (e) { return e.id !== edgeId; });
  }

  function bringToFront(diagram, nodeId) {
    var node = findNode(diagram, nodeId);
    if (!node) { return; }
    diagram.nodes = diagram.nodes.filter(function (n) { return n.id !== nodeId; });
    diagram.nodes.push(node);
  }

  function sendToBack(diagram, nodeId) {
    var node = findNode(diagram, nodeId);
    if (!node) { return; }
    diagram.nodes = diagram.nodes.filter(function (n) { return n.id !== nodeId; });
    diagram.nodes.unshift(node);
  }

  // Draw order. Packages are containers, so they must sit behind whatever they contain,
  // regardless of the order the user created things in. Within each band, array order is
  // z-order and bringToFront/sendToBack manipulate it.
  function drawOrder(doc, diagram) {
    var packages = [];
    var rest = [];
    diagram.nodes.forEach(function (node) {
      var element = ns.model.findElement(doc, node.ref);
      if (element && element.kind === 'package') {
        packages.push(node);
      } else {
        rest.push(node);
      }
    });
    return packages.concat(rest);
  }

  // --- integrity -------------------------------------------------------------

  // Drops anything that can no longer be drawn: views of deleted elements, duplicate
  // nodes for one element, edges whose relationship is gone, and edges whose endpoints
  // are not both present in this diagram.
  //
  // Called after every model deletion and after loading a file, so the renderer can
  // assume every node and edge resolves. Returns the number of things removed, which the
  // loader reports to the user rather than silently discarding their data.
  function prune(doc) {
    var removed = 0;

    doc.diagrams.forEach(function (diagram) {
      var seenElements = {};

      diagram.nodes = diagram.nodes.filter(function (node) {
        if (!ns.model.findElement(doc, node.ref)) { removed++; return false; }
        if (seenElements[node.ref]) { removed++; return false; }
        seenElements[node.ref] = true;
        return true;
      });

      diagram.edges = diagram.edges.filter(function (edge) {
        var rel = ns.model.findRelationship(doc, edge.ref);
        if (!rel) { removed++; return false; }
        var present = rel.ends.every(function (end) {
          return nodeForElement(diagram, end.ref) !== null;
        });
        if (!present) { removed++; return false; }
        return true;
      });
    });

    return removed;
  }

  // Adds views for anything in the model that this diagram does not show yet. Used by
  // "add existing element to diagram" and when a relationship is created between two
  // elements that are both already on screen.
  function syncEdges(doc, diagram) {
    var added = 0;
    doc.model.relationships.forEach(function (rel) {
      if (edgeForRelationship(diagram, rel.id)) { return; }
      var bothPresent = rel.ends.every(function (end) {
        return nodeForElement(diagram, end.ref) !== null;
      });
      if (bothPresent) {
        addEdge(diagram, rel);
        added++;
      }
    });
    return added;
  }

  // --- routing ---------------------------------------------------------------

  // The full polyline for an edge, endpoints clipped to the node borders. Returns null if
  // the edge is not drawable here, which after prune() should not happen.
  function routePoints(doc, diagram, edge) {
    var rel = ns.model.findRelationship(doc, edge.ref);
    if (!rel) { return null; }

    var sourceNode = nodeForElement(diagram, rel.ends[0].ref);
    var targetNode = nodeForElement(diagram, rel.ends[1].ref);
    if (!sourceNode || !targetNode) { return null; }

    var sourceRect = nodeRect(sourceNode);
    var targetRect = nodeRect(targetNode);
    var waypoints = (edge.waypoints || []).map(function (p) {
      return { x: p[0], y: p[1] };
    });

    if (sourceNode.id === targetNode.id) {
      return geo.selfLoopPoints(sourceRect);
    }

    var towardSource = waypoints.length ? waypoints[0] : geo.center(targetRect);
    var towardTarget = waypoints.length
      ? waypoints[waypoints.length - 1]
      : geo.center(sourceRect);

    var start = geo.borderPoint(sourceRect, towardSource);
    var end = geo.borderPoint(targetRect, towardTarget);

    return [start].concat(waypoints, [end]);
  }

  ns.diagram = {
    DEFAULT_SIZE: DEFAULT_SIZE,
    defaultSize: defaultSize,

    createDiagram: createDiagram,
    createNode: createNode,
    createEdge: createEdge,

    findDiagram: findDiagram,
    findNode: findNode,
    findEdge: findEdge,
    nodeForElement: nodeForElement,
    edgeForRelationship: edgeForRelationship,
    nodeRect: nodeRect,
    bounds: bounds,
    drawOrder: drawOrder,

    addNode: addNode,
    removeNode: removeNode,
    addEdge: addEdge,
    removeEdge: removeEdge,
    bringToFront: bringToFront,
    sendToBack: sendToBack,

    prune: prune,
    syncEdges: syncEdges,
    routePoints: routePoints
  };
})(UMLOne);
