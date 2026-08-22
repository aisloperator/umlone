// UMLOne — automatic layout.
//
// A layered arrangement, in the Sugiyama shape: inheritance decides which box sits above
// which, everything else decides the order within a row.
//
// Class diagrams have one strong convention — a supertype is drawn above its subtypes —
// and generalization and realization are the only relationships that carry it. So those
// two set the layers, and associations, aggregations, compositions, dependencies, and
// note links only pull related boxes towards each other within a layer. Treating every
// relationship as a hierarchy would tip associations on their side and produce a picture
// that reads as inheritance where there is none.
//
// Packages nest: a package's contents are laid out on their own, the package is sized to
// hold the result, and it then takes part in the layout around it as a single box. That
// falls out of doing the whole thing recursively.
//
// What this deliberately is not: an optimal layout. Crossings are reduced by barycentre
// sweeps, which is a heuristic that does well on the shapes class diagrams actually have
// and makes no promises on the ones they do not.

(function (ns) {
  'use strict';

  var GAP_X = 50;            // between boxes in a row
  var GAP_Y = 70;            // between rows, leaving space for edge labels
  var COMPONENT_GAP = 90;    // between parts of the diagram that are unconnected
  var PACKAGE_PAD = 16;      // inside a package, around its contents
  var ROW_LIMIT = 1600;      // where a row of unconnected components wraps
  var SWEEPS = 4;            // barycentre passes; more stops helping quickly
  var ORIGIN = { x: 40, y: 40 };
  var GRID = 5;
  var DEPTH_LIMIT = 50;      // ownership is a tree, but a corrupt file need not be

  // The two that mean "is a kind of", and so the two that mean "goes above".
  var HIERARCHY = { generalization: true, realization: true };

  function snap(value) {
    return Math.round(value / GRID) * GRID;
  }

  // --- reading the diagram ---------------------------------------------------

  // Which node, if any, encloses each node: the nearest owning package that is also on
  // this diagram. Ownership lives in the model, so a box that merely overlaps a package
  // on screen is not inside it, and moving things about cannot change what belongs where.
  function containers(doc, diagram) {
    var parentOf = {};

    diagram.nodes.forEach(function (node) {
      var element = ns.model.findElement(doc, node.ref);
      var owner = element && element.owner;
      var found = null;
      var guard = 0;

      while (owner && guard++ < DEPTH_LIMIT) {
        var ownerNode = ns.diagram.nodeForElement(diagram, owner);
        if (ownerNode && ownerNode.id !== node.id) { found = ownerNode.id; break; }
        var ownerElement = ns.model.findElement(doc, owner);
        owner = ownerElement && ownerElement.owner;
      }

      parentOf[node.id] = found;
    });

    return parentOf;
  }

  // Relationships as node-to-node links. `from` is the subtype for a hierarchy edge, so
  // `to` is the one that belongs above it.
  function links(doc, diagram) {
    var out = [];

    diagram.edges.forEach(function (edge) {
      var relationship = ns.model.findRelationship(doc, edge.ref);
      if (!relationship) { return; }

      var source = ns.diagram.nodeForElement(diagram, relationship.ends[0].ref);
      var target = ns.diagram.nodeForElement(diagram, relationship.ends[1].ref);
      if (!source || !target || source.id === target.id) { return; }

      out.push({
        from: source.id,
        to: target.id,
        hierarchy: !!HIERARCHY[relationship.kind]
      });
    });

    return out;
  }

  // --- layering --------------------------------------------------------------

  // Longest path from the top: a subtype sits one row below its deepest supertype, so an
  // inheritance chain never doubles back on itself.
  //
  // Cycles cannot occur in a valid model and are not worth crashing over, so a node that
  // is reached while it is still being computed contributes nothing to its own depth.
  function hierarchyLayers(ids, edges) {
    var above = {};   // node -> the nodes that must be drawn above it
    var touched = {};
    var layer = {};
    var state = {};

    ids.forEach(function (id) { above[id] = []; });

    edges.forEach(function (edge) {
      if (!edge.hierarchy) { return; }
      if (!above[edge.from] || !above[edge.to]) { return; }
      above[edge.from].push(edge.to);
      touched[edge.from] = true;
      touched[edge.to] = true;
    });

    function depth(id) {
      if (state[id] === 'done') { return layer[id]; }
      if (state[id] === 'busy') { return 0; }

      state[id] = 'busy';
      var deepest = 0;
      above[id].forEach(function (parent) {
        deepest = Math.max(deepest, depth(parent) + 1);
      });
      state[id] = 'done';
      layer[id] = deepest;
      return deepest;
    }

    ids.forEach(depth);

    // A node no inheritance touches has no opinion yet, and saying 0 would jam every
    // plain associated class into the top row.
    ids.forEach(function (id) {
      if (!touched[id]) { layer[id] = null; }
    });

    return layer;
  }

  // Everything inheritance did not place: sit it beside whatever it is related to, and
  // failing that, walk outwards from a well-connected node so a plain association graph
  // spreads over rows instead of forming one long line.
  function fillLayers(ids, edges, layer) {
    var neighbours = {};
    ids.forEach(function (id) { neighbours[id] = []; });
    edges.forEach(function (edge) {
      if (!neighbours[edge.from] || !neighbours[edge.to]) { return; }
      neighbours[edge.from].push(edge.to);
      neighbours[edge.to].push(edge.from);
    });

    var pending = ids.filter(function (id) { return layer[id] === null; });
    if (!pending.length) { return layer; }

    // Several passes, because a node's neighbours may themselves be waiting.
    for (var pass = 0; pass < 3 && pending.length; pass++) {
      var settled = [];

      pending.forEach(function (id) {
        var known = neighbours[id]
          .map(function (other) { return layer[other]; })
          .filter(function (value) { return value !== null && value !== undefined; });
        if (!known.length) { return; }

        var total = known.reduce(function (sum, value) { return sum + value; }, 0);
        layer[id] = Math.round(total / known.length);
        settled.push(id);
      });

      if (!settled.length) { break; }
      pending = pending.filter(function (id) { return settled.indexOf(id) < 0; });
    }

    // Nothing related to anything already placed: breadth-first from the busiest node.
    if (pending.length) {
      var seed = pending.slice().sort(function (a, b) {
        return neighbours[b].length - neighbours[a].length ||
               (a < b ? -1 : a > b ? 1 : 0);
      })[0];

      var queue = [seed];
      layer[seed] = 0;

      while (queue.length) {
        var current = queue.shift();
        neighbours[current].forEach(function (other) {
          if (layer[other] === null || layer[other] === undefined) {
            layer[other] = layer[current] + 1;
            queue.push(other);
          }
        });
      }

      ids.forEach(function (id) {
        if (layer[id] === null || layer[id] === undefined) { layer[id] = 0; }
      });
    }

    return layer;
  }

  // --- ordering within a layer -----------------------------------------------

  // The barycentre heuristic: put each box near the average position of what it connects
  // to in the row above, then in the row below, and repeat. It is the standard answer to
  // crossing reduction because the exact problem is NP-hard and this gets most of the way
  // for a fraction of the code.
  function orderRows(rows, edges) {
    var position = {};

    function reindex() {
      rows.forEach(function (row) {
        row.forEach(function (id, index) { position[id] = index; });
      });
    }

    var partners = {};
    edges.forEach(function (edge) {
      (partners[edge.from] = partners[edge.from] || []).push(edge.to);
      (partners[edge.to] = partners[edge.to] || []).push(edge.from);
    });

    reindex();

    for (var sweep = 0; sweep < SWEEPS; sweep++) {
      var downwards = sweep % 2 === 0;
      var order = downwards
        ? rows.map(function (_, i) { return i; })
        : rows.map(function (_, i) { return rows.length - 1 - i; });

      order.forEach(function (rowIndex) {
        var neighbourRow = rowIndex + (downwards ? -1 : 1);
        if (neighbourRow < 0 || neighbourRow >= rows.length) { return; }

        var row = rows[rowIndex];
        var keys = {};

        row.forEach(function (id, index) {
          var seen = (partners[id] || []).filter(function (other) {
            return rows[neighbourRow].indexOf(other) >= 0;
          });
          // Nothing in the neighbouring row: stay put rather than drift to the left.
          keys[id] = seen.length
            ? seen.reduce(function (sum, other) { return sum + position[other]; }, 0) /
              seen.length
            : index;
        });

        // The tie-break is where each box already was, read before the sort rather than
        // during it: two boxes with the same barycentre must not swap on every sweep, and
        // an array being sorted cannot be asked where its own elements are.
        var was = {};
        row.forEach(function (id, index) { was[id] = index; });

        row.sort(function (a, b) {
          return keys[a] - keys[b] || was[a] - was[b];
        });
        reindex();
      });
    }

    return rows;
  }

  // --- placing ---------------------------------------------------------------

  // One connected part of the diagram, arranged with its top-left corner at the origin.
  function placeComponent(ids, edges, sizeOf) {
    var layer = fillLayers(ids, edges, hierarchyLayers(ids, edges));

    var lowest = Math.min.apply(null, ids.map(function (id) { return layer[id]; }));
    var rows = [];
    ids.forEach(function (id) {
      var index = layer[id] - lowest;
      (rows[index] = rows[index] || []).push(id);
    });
    // Averaging can leave a row empty. Keeping it would open a gap that says something
    // about the diagram that is not true.
    rows = rows.filter(function (row) { return row && row.length; });

    orderRows(rows, edges);

    var rowWidths = rows.map(function (row) {
      return row.reduce(function (total, id, index) {
        return total + sizeOf(id).w + (index ? GAP_X : 0);
      }, 0);
    });
    var widest = Math.max.apply(null, rowWidths.concat([0]));

    var placements = {};
    var y = 0;

    rows.forEach(function (row, index) {
      var tallest = row.reduce(function (max, id) {
        return Math.max(max, sizeOf(id).h);
      }, 0);
      // Rows are centred on each other, which reads as one figure rather than as a list
      // pinned to the left margin.
      var x = (widest - rowWidths[index]) / 2;

      row.forEach(function (id) {
        var size = sizeOf(id);
        placements[id] = { x: x, y: y + (tallest - size.h) / 2 };
        x += size.w + GAP_X;
      });

      y += tallest + GAP_Y;
    });

    return {
      placements: placements,
      w: widest,
      h: Math.max(0, y - GAP_Y)
    };
  }

  function components(ids, edges) {
    var group = {};
    var found = [];

    // Union-find without the find: small enough that relabelling is cheaper than clever.
    ids.forEach(function (id, index) { group[id] = index; });
    edges.forEach(function (edge) {
      if (group[edge.from] === undefined || group[edge.to] === undefined) { return; }
      var winner = Math.min(group[edge.from], group[edge.to]);
      var loser = Math.max(group[edge.from], group[edge.to]);
      if (winner === loser) { return; }
      ids.forEach(function (id) {
        if (group[id] === loser) { group[id] = winner; }
      });
    });

    var byGroup = {};
    ids.forEach(function (id) {
      if (!byGroup[group[id]]) {
        byGroup[group[id]] = [];
        found.push(byGroup[group[id]]);
      }
      byGroup[group[id]].push(id);
    });

    return found;
  }

  // Everything at one level of nesting: the top of the diagram, or the inside of one
  // package. Returns positions relative to the group's own top-left corner.
  function placeGroup(ids, edges, sizeOf) {
    var parts = components(ids, edges).map(function (part) {
      var inside = edges.filter(function (edge) {
        return part.indexOf(edge.from) >= 0 && part.indexOf(edge.to) >= 0;
      });
      return placeComponent(part, inside, sizeOf);
    });

    // Biggest first, so the eye lands on the main body of the diagram and the strays end
    // up in the margins rather than the other way round.
    parts.sort(function (a, b) { return (b.w * b.h) - (a.w * a.h); });

    var placements = {};
    var rowX = 0;
    var rowY = 0;
    var rowHeight = 0;
    var widest = 0;

    parts.forEach(function (part) {
      if (rowX > 0 && rowX + part.w > ROW_LIMIT) {
        rowY += rowHeight + COMPONENT_GAP;
        rowX = 0;
        rowHeight = 0;
      }

      Object.keys(part.placements).forEach(function (id) {
        placements[id] = {
          x: rowX + part.placements[id].x,
          y: rowY + part.placements[id].y
        };
      });

      rowX += part.w + COMPONENT_GAP;
      rowHeight = Math.max(rowHeight, part.h);
      widest = Math.max(widest, rowX - COMPONENT_GAP);
    });

    return {
      placements: placements,
      w: widest,
      h: rowY + rowHeight
    };
  }

  // --- the whole diagram -----------------------------------------------------

  // Returns { nodeId: { x, y, w, h } } for every node on the diagram. Nothing is mutated:
  // what to do with the answer is the caller's business, which is what lets one undo step
  // cover the whole rearrangement.
  function arrange(doc, diagram) {
    if (!diagram || !diagram.nodes.length) { return {}; }

    var parentOf = containers(doc, diagram);
    var edges = links(doc, diagram);
    var childrenOf = {};
    var sizes = {};
    var inner = {};

    diagram.nodes.forEach(function (node) {
      var parent = parentOf[node.id] || '';
      (childrenOf[parent] = childrenOf[parent] || []).push(node.id);
      sizes[node.id] = { w: node.w, h: node.h };
    });

    // Which box at this level of nesting a node belongs to, so an edge that crosses a
    // package boundary pulls on the package rather than being dropped.
    function representative(nodeId, level) {
      var current = nodeId;
      var guard = 0;
      while (current && guard++ < DEPTH_LIMIT) {
        if ((parentOf[current] || '') === level) { return current; }
        current = parentOf[current];
      }
      return null;
    }

    function edgesAt(level) {
      var mapped = [];
      edges.forEach(function (edge) {
        var from = representative(edge.from, level);
        var to = representative(edge.to, level);
        if (!from || !to || from === to) { return; }
        mapped.push({ from: from, to: to, hierarchy: edge.hierarchy });
      });
      return mapped;
    }

    // Depth first: a package cannot be sized until its contents have been arranged, and
    // cannot be placed until it has a size.
    function measure(level, depth) {
      var ids = childrenOf[level] || [];
      if (!ids.length || depth > DEPTH_LIMIT) { return; }

      ids.forEach(function (id) {
        if (!childrenOf[id]) { return; }

        measure(id, depth + 1);
        var contents = inner[id];
        sizes[id] = {
          w: Math.max(ns.validate.MIN_NODE_W, contents.w + PACKAGE_PAD * 2),
          h: Math.max(ns.validate.MIN_NODE_H,
                      contents.h + PACKAGE_PAD + ns.render.PACKAGE_TAB_H + PACKAGE_PAD)
        };
      });

      inner[level] = placeGroup(ids, edgesAt(level), function (id) {
        return sizes[id];
      });
    }

    measure('', 0);

    // Unfold the nesting into absolute positions, a package's contents landing under its
    // tab rather than over it.
    var result = {};

    function emit(level, originX, originY) {
      var group = inner[level];
      if (!group) { return; }

      Object.keys(group.placements).forEach(function (id) {
        var at = group.placements[id];
        var x = snap(originX + at.x);
        var y = snap(originY + at.y);

        result[id] = { x: x, y: y, w: sizes[id].w, h: sizes[id].h };

        if (childrenOf[id]) {
          emit(id, x + PACKAGE_PAD, y + ns.render.PACKAGE_TAB_H + PACKAGE_PAD);
        }
      });
    }

    emit('', ORIGIN.x, ORIGIN.y);
    return result;
  }

  ns.layout = {
    GAP_X: GAP_X,
    GAP_Y: GAP_Y,
    COMPONENT_GAP: COMPONENT_GAP,
    PACKAGE_PAD: PACKAGE_PAD,
    ORIGIN: ORIGIN,
    HIERARCHY: HIERARCHY,
    arrange: arrange
  };
})(UMLOne);
