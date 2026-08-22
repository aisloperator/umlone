// UMLOne — standalone SVG export, also used as the source for printing.
//
// The diagram on screen cannot simply be serialized. It carries the viewport transform,
// the selection, invisible hit targets, and — the part that matters most — none of its
// appearance: colours, fonts, and stroke widths all live in styles.css, which does not
// travel with the file. An exported file that needs a stylesheet beside it is not an
// exported file.
//
// So the diagram is drawn a second time into a detached element, mounted just long enough
// for the browser to resolve the stylesheet against it, and every computed property that
// the element does not already inherit is written onto the element itself. What comes out
// depends on nothing but itself.

(function (ns) {
  'use strict';

  var MARGIN = 20;

  // Nothing but paint. Layout properties are absent on purpose: geometry is already in the
  // attributes, and copying computed lengths would fight it.
  var PAINT = [
    'fill', 'fill-opacity', 'fill-rule',
    'stroke', 'stroke-opacity', 'stroke-width', 'stroke-dasharray',
    'stroke-linecap', 'stroke-linejoin',
    'opacity',
    'font-family', 'font-size', 'font-style', 'font-weight',
    'text-anchor', 'text-decoration'
  ];

  // Which of those a child gets from its parent for free. The rest have to be written even
  // when they match the parent, because matching is a coincidence there rather than the
  // reason: dropping `opacity: 0.35` from a child whose parent happens to be 0.35 too
  // would silently reset the child to 1.
  var INHERITED = {
    'fill': true, 'fill-opacity': true, 'fill-rule': true,
    'stroke': true, 'stroke-opacity': true, 'stroke-width': true,
    'stroke-dasharray': true, 'stroke-linecap': true, 'stroke-linejoin': true,
    'font-family': true, 'font-size': true, 'font-style': true, 'font-weight': true,
    'text-anchor': true
  };

  // Invisible in the editor and meaningless outside it: the fat transparent stroke that
  // makes thin edges clickable, the transparent row targets that open the text editor, and
  // anything belonging to a selection that the export does not have.
  var INTERACTION_ONLY = '.edge-hit, .line-hit, .handle, .marquee, .pending-edge';

  function cssVariable(name, fallback) {
    if (!document.documentElement || !window.getComputedStyle) { return fallback; }
    var value = window.getComputedStyle(document.documentElement)
      .getPropertyValue(name);
    return (value && value.trim()) || fallback;
  }

  // The area the drawing occupies, plus a margin so nothing sits against the edge. An
  // empty diagram still has to produce a valid file, so it gets an arbitrary small page.
  function viewBoxFor(diagram) {
    var box = diagram ? ns.diagram.bounds(diagram) : null;
    if (!box || box.w === 0 || box.h === 0) {
      return { x: 0, y: 0, w: 240, h: 160 };
    }
    return {
      x: box.x - MARGIN,
      y: box.y - MARGIN,
      w: box.w + MARGIN * 2,
      h: box.h + MARGIN * 2
    };
  }

  // Off-screen in a holder rather than hidden on the element itself: `display: none` leaves
  // nothing to read an appearance back from, and putting the positioning on the <svg> would
  // mean writing to the very style attribute the export is about to fill in.
  function mount(el) {
    var holder = document.createElement('div');
    holder.setAttribute('style', 'position: fixed; left: -20000px; top: 0; ' +
                                 'width: 1px; height: 1px; overflow: hidden;');
    holder.appendChild(el);
    document.body.appendChild(holder);
    return holder;
  }

  function everything(root) {
    return [root].concat(Array.prototype.slice.call(root.querySelectorAll('*')));
  }

  function inlineStyles(root) {
    if (!window.getComputedStyle) { return; }

    everything(root).forEach(function (el) {
      var mine = window.getComputedStyle(el);
      var parent = el.parentNode;
      // Reading a parent that has already been rewritten is safe: what is written is what
      // was computed, so no element's computed style changes as this walk proceeds.
      var inheritedFrom = (el !== root && parent && parent.nodeType === 1)
        ? window.getComputedStyle(parent)
        : null;
      var declarations = [];

      PAINT.forEach(function (property) {
        var value = mine.getPropertyValue(property);
        if (!value) { return; }
        if (inheritedFrom && INHERITED[property] &&
            inheritedFrom.getPropertyValue(property) === value) {
          return;
        }
        declarations.push(property + ': ' + value);
      });

      if (declarations.length) {
        el.setAttribute('style', declarations.join('; ') + ';');
      }
    });
  }

  // Ids of model elements mean nothing to whatever opens this file. Class names stay: they
  // cost little and say what each shape is to anyone who edits the file later.
  function stripEditorAttributes(root) {
    everything(root).forEach(function (el) {
      Array.prototype.slice.call(el.attributes).forEach(function (attr) {
        if (attr.name.indexOf('data-') === 0) { el.removeAttribute(attr.name); }
      });
    });
  }

  // Returns a detached <svg> that stands on its own.
  function build(doc, diagram) {
    var view = viewBoxFor(diagram);

    var svg = ns.svg('svg', {
      'class': 'uml-diagram',
      width: view.w,
      height: view.h,
      viewBox: view.x + ' ' + view.y + ' ' + view.w + ' ' + view.h
    });

    var holder = mount(svg);

    try {
      // No selection, no editing, no viewport transform — the viewBox already places the
      // drawing, so the coordinates in the file are the diagram's own.
      ns.render.draw(svg, doc, diagram, {
        viewport: { x: 0, y: 0, scale: 1 },
        selectedNodes: {},
        selectedEdges: {},
        editing: null
      });

      Array.prototype.slice.call(svg.querySelectorAll(INTERACTION_ONLY))
        .forEach(function (el) { el.parentNode.removeChild(el); });

      inlineStyles(svg);
      stripEditorAttributes(svg);
    } finally {
      document.body.removeChild(holder);
    }

    // Behind everything, because a viewer that composites the file onto a dark page would
    // otherwise show dark text on dark.
    var background = ns.svg('rect', {
      x: view.x, y: view.y, width: view.w, height: view.h,
      fill: cssVariable('--canvas-bg', '#ffffff')
    });
    svg.insertBefore(background, svg.firstChild);

    // What the diagram is called, for anything that reads a document rather than pixels.
    var title = ns.svg('title', {});
    title.textContent = (diagram && diagram.name) || 'Diagram';
    svg.insertBefore(title, svg.firstChild);

    return svg;
  }

  // XMLSerializer writes the SVG namespace itself, since the elements are created in it.
  function serialize(doc, diagram) {
    var text = new XMLSerializer().serializeToString(build(doc, diagram));
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + text + '\n';
  }

  function fileName(diagram) {
    return ns.io.slugify(diagram && diagram.name, 'diagram') + '.svg';
  }

  // What goes on paper: the diagram's name, then the drawing. Built by the same code as
  // the file export, so what prints is what exports — and it carries its own appearance,
  // which matters twice over here, since a print stylesheet is a poor place to discover
  // that the diagram came out as black boxes.
  function toPrintArea(container, doc, diagram) {
    ns.clear(container);
    if (!diagram) { return container; }

    ns.html('div', { 'class': 'print-title', text: diagram.name }, container);
    container.appendChild(build(doc, diagram));
    return container;
  }

  ns.exportSvg = {
    MARGIN: MARGIN,
    PAINT: PAINT,
    INHERITED: INHERITED,
    viewBoxFor: viewBoxFor,
    build: build,
    serialize: serialize,
    fileName: fileName,
    toPrintArea: toPrintArea
  };
})(UMLOne);
