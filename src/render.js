// UMLOne — drawing a diagram into SVG.
//
// Full redraw on every change: clear the canvas, rebuild it from the document. Class
// diagrams are small (tens of boxes, not thousands), and a rebuild is far easier to
// reason about than incremental patching — there is no way for the picture to drift out
// of sync with the model, because the picture has no state of its own.
//
// Layout is computed here rather than stored. `layout()` turns an element into bands of
// text lines; both the renderer and "size to fit" consume it, so what you see and what
// the box resizes to can never disagree.

(function (ns) {
  'use strict';

  var geo = ns.geometry;
  var measure = ns.measure;
  var model = ns.model;

  var PAD_X = measure.PAD_X;
  var PAD_Y = measure.PAD_Y;
  var LINE_H = measure.LINE_HEIGHT;

  var PACKAGE_TAB_H = 22;
  var COMMENT_FOLD = 14;

  var DIAMOND_LEN = 16;
  var DIAMOND_HALF = 5.5;
  var TRIANGLE_LEN = 13;
  var TRIANGLE_HALF = 7.5;
  var ARROW_LEN = 11;
  var ARROW_HALF = 4.5;

  var HANDLE = 7;

  // How each relationship kind is drawn. One table, read by both the renderer and the
  // inspector, so a kind cannot render one way and be described another.
  var EDGE_STYLE = {
    association:    { dashed: false, sourceShape: null,             targetShape: null },
    aggregation:    { dashed: false, sourceShape: 'diamondHollow',  targetShape: null },
    composition:    { dashed: false, sourceShape: 'diamondFilled',  targetShape: null },
    generalization: { dashed: false, sourceShape: null,             targetShape: 'triangle' },
    realization:    { dashed: true,  sourceShape: null,             targetShape: 'triangle' },
    dependency:     { dashed: true,  sourceShape: null,             targetShape: 'arrow' },
    annotation:     { dashed: true,  sourceShape: null,             targetShape: null }
  };

  function edgeStyle(kind) {
    return EDGE_STYLE[kind] || EDGE_STYLE.association;
  }

  // --- layout ----------------------------------------------------------------

  // Turns an element into a list of bands. A band is one compartment: a set of text lines
  // plus how they are aligned. The header band is centred, member bands are left-aligned.
  function layout(doc, element, node) {
    var show = (node && node.show) || { attributes: true, operations: true };
    var bands = [];

    if (element.kind === 'comment') {
      var innerWidth = Math.max(40, (node ? node.w : 170) - PAD_X * 2);
      return {
        bands: [{
          align: 'start',
          lines: measure.wrap(element.body, 'comment', innerWidth).map(function (text) {
            return { text: text, font: 'comment' };
          })
        }],
        kind: 'comment'
      };
    }

    if (element.kind === 'package') {
      return {
        bands: [{
          align: 'start',
          lines: [{ text: element.name || '(unnamed package)', font: 'name' }]
        }],
        kind: 'package'
      };
    }

    // Header: stereotypes above the name. Interfaces and enums always announce their
    // kind, which is how you tell them from a plain class at a glance.
    var headerLines = [];
    var stereotypes = (element.stereotypes || []).slice();
    if (element.kind === 'interface') { stereotypes.unshift('interface'); }
    if (element.kind === 'enumeration') { stereotypes.unshift('enumeration'); }

    if (stereotypes.length) {
      headerLines.push({
        text: model.formatStereotypes(stereotypes),
        font: 'stereotype',
        cls: 'node-stereotype'
      });
    }

    headerLines.push({
      text: element.name || '(unnamed)',
      font: element.isAbstract ? 'nameItalic' : 'name',
      cls: 'node-name' + (element.isAbstract ? ' abstract' : '')
    });

    bands.push({ align: 'middle', lines: headerLines });

    var traits = model.traits(element.kind);

    if (traits.attributes && show.attributes) {
      bands.push({
        align: 'start',
        lines: (element.attributes || []).map(function (attr) {
          return {
            text: model.formatAttribute(attr),
            font: 'member',
            cls: 'node-member' + (attr.isStatic ? ' static' : '')
          };
        })
      });
    }

    if (traits.operations && show.operations) {
      bands.push({
        align: 'start',
        lines: (element.operations || []).map(function (op) {
          return {
            text: model.formatOperation(op),
            font: op.isAbstract ? 'memberItalic' : 'member',
            cls: 'node-member' + (op.isStatic ? ' static' : '') +
                 (op.isAbstract ? ' abstract' : '')
          };
        })
      });
    }

    if (traits.literals) {
      bands.push({
        align: 'start',
        lines: (element.literals || []).map(function (literal) {
          return { text: literal, font: 'member', cls: 'node-member' };
        })
      });
    }

    return { bands: bands, kind: element.kind };
  }

  function bandHeight(band) {
    // An empty compartment still gets a sliver of height so the separator line has
    // somewhere to sit and the box does not look truncated.
    return band.lines.length
      ? band.lines.length * LINE_H + PAD_Y * 2
      : LINE_H;
  }

  // Smallest box that shows every line without clipping. Drives the "Size to fit" action
  // and the size of newly created nodes.
  function preferredSize(doc, element, node) {
    var info = layout(doc, element, node);
    var widest = 0;
    var height = 0;

    info.bands.forEach(function (band) {
      band.lines.forEach(function (line) {
        widest = Math.max(widest, measure.width(line.text, line.font));
      });
      height += bandHeight(band);
    });

    if (element.kind === 'package') {
      return { w: Math.max(160, widest + PAD_X * 4), h: Math.max(120, node ? node.h : 180) };
    }

    if (element.kind === 'comment') {
      return {
        w: Math.max(120, node ? node.w : 170),
        h: Math.max(48, height + COMMENT_FOLD)
      };
    }

    return {
      w: Math.max(ns.validate.MIN_NODE_W, Math.ceil(widest + PAD_X * 2)),
      h: Math.max(ns.validate.MIN_NODE_H, Math.ceil(height))
    };
  }

  // --- node drawing ----------------------------------------------------------

  function drawTextLine(parent, line, x, y, anchor) {
    var font = measure.FONT[line.font] || measure.FONT.member;
    var el = ns.svg('text', {
      x: x,
      y: y,
      'font-size': font.size,
      'font-weight': font.weight,
      'font-style': font.style,
      'text-anchor': anchor,
      'class': line.cls || ''
    }, parent);
    el.textContent = line.text;
    return el;
  }

  function drawBands(group, info, width, height, startY) {
    var y = startY;

    info.bands.forEach(function (band, index) {
      if (index > 0) {
        ns.svg('line', {
          x1: 0, y1: y, x2: width, y2: y, 'class': 'node-compartment-line'
        }, group);
      }

      var textY = y + PAD_Y + LINE_H - 4;
      band.lines.forEach(function (line) {
        if (textY > height) { return; } // clipped away anyway; skip the DOM node
        drawTextLine(
          group,
          line,
          band.align === 'middle' ? width / 2 : PAD_X,
          textY,
          band.align === 'middle' ? 'middle' : 'start'
        );
        textY += LINE_H;
      });

      y += bandHeight(band);
    });
  }

  function drawClassifier(group, info, node) {
    ns.svg('rect', {
      x: 0, y: 0, width: node.w, height: node.h, 'class': 'node-shape'
    }, group);
    drawBands(group, info, node.w, node.h, 0);
  }

  function drawPackage(group, info, node) {
    var nameWidth = measure.width(info.bands[0].lines[0].text, 'name');
    var tabWidth = Math.min(node.w - 10, Math.max(70, nameWidth + PAD_X * 2));

    ns.svg('rect', {
      x: 0, y: 0, width: tabWidth, height: PACKAGE_TAB_H, 'class': 'package-tab'
    }, group);

    ns.svg('rect', {
      x: 0, y: PACKAGE_TAB_H,
      width: node.w, height: Math.max(1, node.h - PACKAGE_TAB_H),
      'class': 'node-shape package-body'
    }, group);

    drawTextLine(group, info.bands[0].lines[0], PAD_X, PACKAGE_TAB_H - 7, 'start');
  }

  function drawComment(group, info, node) {
    var fold = COMMENT_FOLD;
    var w = node.w;
    var h = node.h;

    ns.svg('path', {
      d: 'M 0 0 H ' + (w - fold) + ' L ' + w + ' ' + fold +
         ' V ' + h + ' H 0 Z',
      'class': 'node-shape comment-shape'
    }, group);

    ns.svg('path', {
      d: 'M ' + (w - fold) + ' 0 V ' + fold + ' H ' + w,
      'class': 'comment-fold',
      fill: 'none'
    }, group);

    var textY = PAD_Y + LINE_H - 4;
    info.bands[0].lines.forEach(function (line) {
      if (textY > h) { return; }
      drawTextLine(group, line, PAD_X, textY, 'start');
      textY += LINE_H;
    });
  }

  function drawNode(layer, doc, node, selected) {
    var element = model.findElement(doc, node.ref);
    if (!element) { return; } // prune() should have removed this already

    var group = ns.svg('g', {
      'class': 'node' + (selected ? ' selected' : ''),
      'data-node-id': node.id,
      'data-element-id': element.id,
      transform: 'translate(' + node.x + ',' + node.y + ')'
    }, layer);

    // Clip to the box so shrinking a node hides overflow instead of letting text spill
    // across the diagram.
    var clipId = 'clip-' + node.id;
    var clip = ns.svg('clipPath', { id: clipId }, group);
    ns.svg('rect', { x: 0, y: 0, width: node.w, height: node.h }, clip);

    var inner = ns.svg('g', { 'clip-path': 'url(#' + clipId + ')' }, group);
    var info = layout(doc, element, node);

    if (element.kind === 'package') {
      drawPackage(inner, info, node);
    } else if (element.kind === 'comment') {
      drawComment(inner, info, node);
    } else {
      drawClassifier(inner, info, node);
    }

    return group;
  }

  // --- edge decorations ------------------------------------------------------

  function degrees(radians) {
    return radians * 180 / Math.PI;
  }

  // Shapes are authored pointing along +x with their attachment vertex at the origin,
  // then rotated into place. `angle` is the direction the shape points, away from the
  // node it attaches to.
  function drawDecoration(parent, shape, point, angle) {
    if (!shape) { return; }

    var transform = 'translate(' + point.x + ',' + point.y + ') rotate(' +
                    degrees(angle) + ')';

    if (shape === 'diamondHollow' || shape === 'diamondFilled') {
      ns.svg('polygon', {
        points: '0,0 ' + (DIAMOND_LEN / 2) + ',' + (-DIAMOND_HALF) + ' ' +
                DIAMOND_LEN + ',0 ' + (DIAMOND_LEN / 2) + ',' + DIAMOND_HALF,
        transform: transform,
        'class': 'edge-decoration ' +
                 (shape === 'diamondFilled' ? 'filled' : 'hollow')
      }, parent);
      return;
    }

    if (shape === 'triangle') {
      ns.svg('polygon', {
        points: '0,0 ' + TRIANGLE_LEN + ',' + (-TRIANGLE_HALF) + ' ' +
                TRIANGLE_LEN + ',' + TRIANGLE_HALF,
        transform: transform,
        'class': 'edge-decoration hollow'
      }, parent);
      return;
    }

    if (shape === 'arrow') {
      ns.svg('path', {
        d: 'M ' + ARROW_LEN + ' ' + (-ARROW_HALF) + ' L 0 0 L ' +
           ARROW_LEN + ' ' + ARROW_HALF,
        transform: transform,
        'class': 'edge-decoration open',
        fill: 'none'
      }, parent);
    }
  }

  // Direction pointing outward from whichever end we are decorating: away from the node,
  // along the first (or last) segment.
  function outwardAngle(points, atStart) {
    var a = atStart ? points[0] : points[points.length - 1];
    var b = atStart ? points[1] : points[points.length - 2];
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  function alongFrom(points, atStart, distance) {
    var a = atStart ? points[0] : points[points.length - 1];
    var angle = outwardAngle(points, atStart);
    return {
      x: a.x + Math.cos(angle) * distance,
      y: a.y + Math.sin(angle) * distance,
      angle: angle
    };
  }

  // --- edge drawing ----------------------------------------------------------

  function drawEdgeLabel(parent, text, at, perpendicular) {
    if (!text) { return; }
    var p = geo.offsetPerpendicular(at, at.angle, perpendicular);
    var el = ns.svg('text', {
      x: p.x,
      y: p.y,
      'font-size': measure.FONT.label.size,
      'class': 'edge-label'
    }, parent);
    el.textContent = text;
  }

  function drawEdge(layer, doc, diagram, edge, selected) {
    var rel = model.findRelationship(doc, edge.ref);
    if (!rel) { return; }

    var points = ns.diagram.routePoints(doc, diagram, edge);
    if (!points || points.length < 2) { return; }

    var style = edgeStyle(rel.kind);

    var group = ns.svg('g', {
      'class': 'edge' + (selected ? ' selected' : ''),
      'data-edge-id': edge.id,
      'data-relationship-id': rel.id
    }, layer);

    var d = points.map(function (p, i) {
      return (i === 0 ? 'M ' : 'L ') + p.x + ' ' + p.y;
    }).join(' ');

    // Invisible fat stroke first: a 1.25px line is almost impossible to click otherwise.
    ns.svg('path', { d: d, 'class': 'edge-hit' }, group);
    ns.svg('path', {
      d: d,
      'class': 'edge-line' + (style.dashed ? ' edge-dashed' : '')
    }, group);

    // Decorations point back along the line, away from the node they touch.
    drawDecoration(group, style.sourceShape, points[0], outwardAngle(points, true));
    drawDecoration(group, style.targetShape, points[points.length - 1],
                   outwardAngle(points, false));

    // Navigability arrows are independent of the kind's own decoration: an association
    // can be navigable at either end, both, or neither.
    if (ns.model.endSemantics(rel.kind).labelled) {
      if (rel.ends[1].navigable && !style.targetShape) {
        drawDecoration(group, 'arrow', points[points.length - 1],
                       outwardAngle(points, false));
      }
      if (rel.ends[0].navigable && !style.sourceShape) {
        drawDecoration(group, 'arrow', points[0], outwardAngle(points, true));
      }
    }

    drawEdgeLabels(group, rel, points, edge.labels || {});
    return group;
  }

  function labelOffset(labels, key) {
    var entry = labels[key];
    return entry ? { dx: entry.dx, dy: entry.dy } : { dx: 0, dy: 0 };
  }

  function drawEdgeLabels(group, rel, points, labels) {
    function shifted(at, key) {
      var off = labelOffset(labels, key);
      return { x: at.x + off.dx, y: at.y + off.dy, angle: at.angle };
    }

    if (rel.name) {
      var mid = geo.pointAt(points, 0.5);
      drawEdgeLabel(group, rel.name, shifted(mid, 'name'), -8);
    }

    if (!ns.model.endSemantics(rel.kind).labelled) { return; }

    // Roles and multiplicities sit just clear of each box, on opposite sides of the line
    // so they never overlap each other.
    var sourceAt = alongFrom(points, true, 26);
    var targetAt = alongFrom(points, false, 26);

    drawEdgeLabel(group, rel.ends[0].role, shifted(sourceAt, 'sourceRole'), 14);
    drawEdgeLabel(group, rel.ends[0].multiplicity,
                  shifted(sourceAt, 'sourceMultiplicity'), -8);
    drawEdgeLabel(group, rel.ends[1].role, shifted(targetAt, 'targetRole'), 14);
    drawEdgeLabel(group, rel.ends[1].multiplicity,
                  shifted(targetAt, 'targetMultiplicity'), -8);
  }

  // --- overlay (selection affordances) ---------------------------------------

  function drawNodeHandles(layer, node) {
    var half = HANDLE / 2;
    var spots = [
      { name: 'nw', x: node.x,              y: node.y },
      { name: 'n',  x: node.x + node.w / 2, y: node.y },
      { name: 'ne', x: node.x + node.w,     y: node.y },
      { name: 'e',  x: node.x + node.w,     y: node.y + node.h / 2 },
      { name: 'se', x: node.x + node.w,     y: node.y + node.h },
      { name: 's',  x: node.x + node.w / 2, y: node.y + node.h },
      { name: 'sw', x: node.x,              y: node.y + node.h },
      { name: 'w',  x: node.x,              y: node.y + node.h / 2 }
    ];

    spots.forEach(function (spot) {
      ns.svg('rect', {
        x: spot.x - half,
        y: spot.y - half,
        width: HANDLE,
        height: HANDLE,
        'class': 'handle ' + spot.name,
        'data-handle': spot.name,
        'data-node-id': node.id
      }, layer);
    });
  }

  function drawWaypointHandles(layer, edge) {
    (edge.waypoints || []).forEach(function (point, index) {
      ns.svg('circle', {
        cx: point[0],
        cy: point[1],
        r: HANDLE / 2 + 1,
        'class': 'handle waypoint',
        'data-edge-id': edge.id,
        'data-waypoint-index': index
      }, layer);
    });
  }

  // --- entry point -----------------------------------------------------------

  // `state` carries transient, unsaved UI concerns: what is selected, where the viewport
  // is, and any in-progress gesture. None of it belongs in the document.
  function draw(svg, doc, diagram, state) {
    ns.clear(svg);

    if (!diagram) { return; }

    var view = state.viewport || { x: 0, y: 0, scale: 1 };
    var root = ns.svg('g', {
      transform: 'translate(' + view.x + ',' + view.y + ') scale(' + view.scale + ')'
    }, svg);

    var edgeLayer = ns.svg('g', { 'class': 'layer-edges' }, root);
    var nodeLayer = ns.svg('g', { 'class': 'layer-nodes' }, root);
    var overlay = ns.svg('g', { 'class': 'layer-overlay' }, root);

    var selectedNodes = state.selectedNodes || {};
    var selectedEdges = state.selectedEdges || {};

    // Edges first so boxes sit on top of them; endpoints are clipped to the borders, so
    // nothing is hidden that should be visible.
    diagram.edges.forEach(function (edge) {
      drawEdge(edgeLayer, doc, diagram, edge, !!selectedEdges[edge.id]);
    });

    ns.diagram.drawOrder(doc, diagram).forEach(function (node) {
      var group = drawNode(nodeLayer, doc, node, !!selectedNodes[node.id]);
      if (group && state.edgeSourceNodeId === node.id) {
        group.setAttribute('class', group.getAttribute('class') + ' edge-source-hint');
      }
    });

    Object.keys(selectedNodes).forEach(function (nodeId) {
      var node = ns.diagram.findNode(diagram, nodeId);
      if (node) { drawNodeHandles(overlay, node); }
    });

    Object.keys(selectedEdges).forEach(function (edgeId) {
      var edge = ns.diagram.findEdge(diagram, edgeId);
      if (edge) { drawWaypointHandles(overlay, edge); }
    });

    if (state.pendingEdge) {
      ns.svg('line', {
        x1: state.pendingEdge.from.x,
        y1: state.pendingEdge.from.y,
        x2: state.pendingEdge.to.x,
        y2: state.pendingEdge.to.y,
        'class': 'pending-edge'
      }, overlay);
    }

    if (state.marquee) {
      ns.svg('rect', {
        x: state.marquee.x,
        y: state.marquee.y,
        width: state.marquee.w,
        height: state.marquee.h,
        'class': 'marquee'
      }, overlay);
    }
  }

  ns.render = {
    EDGE_STYLE: EDGE_STYLE,
    edgeStyle: edgeStyle,
    layout: layout,
    bandHeight: bandHeight,
    preferredSize: preferredSize,
    draw: draw
  };
})(UMLOne);
