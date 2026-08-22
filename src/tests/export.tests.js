(function (ns) {
  'use strict';

  T.group('svg export');

  function doc() { return ns.testFixture(); }

  function exported(document_) {
    var d = document_ || doc();
    return ns.exportSvg.build(d, d.diagrams[0]);
  }

  T.test('the page is the drawing plus a margin on every side', function () {
    var d = doc();
    var box = ns.diagram.bounds(d.diagrams[0]);
    var m = ns.exportSvg.MARGIN;
    var view = ns.exportSvg.viewBoxFor(d.diagrams[0]);

    T.deepEq(view, { x: box.x - m, y: box.y - m, w: box.w + m * 2, h: box.h + m * 2 });
  });

  T.test('an empty diagram still produces a page rather than nothing', function () {
    var view = ns.exportSvg.viewBoxFor(ns.diagram.createDiagram('Empty'));
    T.eq(view.w > 0, true);
    T.eq(view.h > 0, true);
  });

  T.test('the viewBox and the width match what was measured', function () {
    var d = doc();
    var view = ns.exportSvg.viewBoxFor(d.diagrams[0]);
    var svg = exported(d);

    T.eq(svg.getAttribute('viewBox'),
         view.x + ' ' + view.y + ' ' + view.w + ' ' + view.h);
    T.eq(svg.getAttribute('width'), String(view.w));
    T.eq(svg.getAttribute('height'), String(view.h));
  });

  // These use their own stylesheet rather than the app's: this page deliberately does not
  // load styles.css, and a test that asserts a particular shade of grey would be testing
  // the design rather than the mechanism.
  function withStyle(css, fn) {
    var el = document.createElement('style');
    el.textContent = css;
    document.head.appendChild(el);
    try { return fn(); } finally { document.head.removeChild(el); }
  }

  // The whole point: styles.css does not travel with the file, so an export that leaves
  // its appearance in a stylesheet is an export of a black-on-white wireframe.
  T.test('appearance is written onto the elements, not left in the stylesheet', function () {
    withStyle('.node-shape { fill: rgb(1, 2, 3); stroke: rgb(4, 5, 6); stroke-width: 3px; }',
      function () {
        var style = exported().querySelector('[class~="node-shape"]')
          .getAttribute('style') || '';

        T.includes([style], 'rgb(1, 2, 3)', 'the fill stayed in the stylesheet');
        T.includes([style], 'rgb(4, 5, 6)', 'the stroke stayed in the stylesheet');
        T.includes([style], '3px', 'the stroke width stayed in the stylesheet');
      });
  });

  T.test('text carries the font it was drawn with', function () {
    withStyle('.uml-diagram text { font-family: Georgia; font-weight: 700; }', function () {
      var style = exported().querySelector('text').getAttribute('style') || '';
      T.includes([style], 'Georgia', 'the viewer would substitute its own font');
      T.includes([style], '700');
    });
  });

  // Repeating what an element already gets from its parent would multiply the size of the
  // file by the depth of the tree.
  T.test('what is inherited is not written again', function () {
    withStyle('.layer-nodes { fill: rgb(7, 8, 9); }', function () {
      var svg = exported();
      T.includes([svg.querySelector('[class~="layer-nodes"]').getAttribute('style')],
                 'rgb(7, 8, 9)', 'the group that carries the fill lost it');

      var shape = svg.querySelector('[class~="node-shape"]').getAttribute('style') || '';
      T.eq(shape.indexOf('rgb(7, 8, 9)'), -1, 'an inherited fill was written twice');
    });
  });

  // opacity is not inherited, so matching the parent is a coincidence rather than the
  // reason. Dropping it would quietly reset the element to fully opaque.
  T.test('what is not inherited is written even when the parent matches', function () {
    withStyle('.layer-nodes { opacity: 0.5; } .node-shape { opacity: 0.5; }', function () {
      var style = exported().querySelector('[class~="node-shape"]')
        .getAttribute('style') || '';
      T.includes([style], 'opacity: 0.5');
    });
  });

  T.test('nothing that only exists to be clicked survives', function () {
    var svg = exported();
    ['.edge-hit', '.line-hit', '.handle', '.marquee', '.pending-edge']
      .forEach(function (selector) {
        T.eq(svg.querySelectorAll(selector).length, 0, selector + ' was exported');
      });
  });

  T.test('the editor\'s own ids are not in the file', function () {
    var svg = exported();
    T.eq(svg.querySelectorAll('[data-node-id], [data-edge-id], [data-element-id]').length,
         0);
  });

  T.test('the drawing sits on an opaque background', function () {
    var svg = exported();
    var first = svg.querySelector('rect');
    var view = ns.exportSvg.viewBoxFor(doc().diagrams[0]);

    T.eq(parseFloat(first.getAttribute('width')), view.w,
         'the first rect should be the page background');
    T.ok(first.getAttribute('fill'), 'the background has no colour');
  });

  T.test('the diagram name is the title of the file', function () {
    var d = doc();
    var svg = ns.exportSvg.build(d, d.diagrams[0]);
    var title = svg.querySelector('title');
    T.eq(title.textContent, d.diagrams[0].name);
    T.eq(svg.firstChild, title, 'the title should come first, before anything drawn');
  });

  T.test('every class on the diagram appears in the file', function () {
    var d = doc();
    var svg = exported(d);
    var texts = Array.prototype.slice.call(svg.querySelectorAll('text'))
      .map(function (el) { return el.textContent; });

    d.diagrams[0].nodes.forEach(function (node) {
      var element = ns.model.findElement(d, node.ref);
      if (element.kind === 'comment') { return; }
      T.includes(texts, element.name, element.name + ' is missing from the export');
    });
  });

  T.test('serializing produces a standalone XML document', function () {
    var d = doc();
    var text = ns.exportSvg.serialize(d, d.diagrams[0]);

    T.eq(text.indexOf('<?xml version="1.0" encoding="UTF-8"?>'), 0);
    T.includes([text], 'xmlns="http://www.w3.org/2000/svg"',
               'without the namespace it is not an SVG file');
    T.includes([text], '<svg');
    T.eq(text.charAt(text.length - 1), '\n');
  });

  T.test('what it serializes can be parsed back', function () {
    var d = doc();
    var text = ns.exportSvg.serialize(d, d.diagrams[0]);
    var parsed = new DOMParser().parseFromString(text, 'image/svg+xml');

    T.eq(parsed.querySelectorAll('parsererror').length, 0, 'the file is not well-formed');
    T.eq(parsed.documentElement.nodeName, 'svg');
    T.eq(parsed.querySelectorAll('[class~="node-shape"]').length,
         d.diagrams[0].nodes.length, 'a box went missing between drawing and parsing');
  });

  // Building mounts the drawing to read its appearance back. Leaving that behind would
  // slowly fill the page with invisible copies of the diagram.
  T.test('exporting leaves nothing behind in the page', function () {
    var before = document.body.childNodes.length;
    ns.exportSvg.serialize(doc(), doc().diagrams[0]);
    T.eq(document.body.childNodes.length, before);
  });

  T.test('exporting does not disturb the document', function () {
    var d = doc();
    var before = JSON.stringify(d);
    ns.exportSvg.serialize(d, d.diagrams[0]);
    T.eq(JSON.stringify(d), before);
  });

  // --- printing --------------------------------------------------------------

  T.test('the print area gets the diagram name and the drawing', function () {
    var d = doc();
    var area = document.createElement('div');
    ns.exportSvg.toPrintArea(area, d, d.diagrams[0]);

    T.eq(area.querySelectorAll('svg').length, 1);
    T.eq(area.querySelector('.print-title').textContent, d.diagrams[0].name);
    T.eq(area.firstChild.className, 'print-title', 'the name should come before the drawing');
  });

  T.test('printing twice does not print two diagrams', function () {
    var d = doc();
    var area = document.createElement('div');
    ns.exportSvg.toPrintArea(area, d, d.diagrams[0]);
    ns.exportSvg.toPrintArea(area, d, d.diagrams[1] || d.diagrams[0]);

    T.eq(area.querySelectorAll('svg').length, 1);
  });

  T.test('printing what is on screen means the diagram asked for', function () {
    var d = doc();
    if (d.diagrams.length < 2) { return; }
    var area = document.createElement('div');
    ns.exportSvg.toPrintArea(area, d, d.diagrams[1]);
    T.eq(area.querySelector('.print-title').textContent, d.diagrams[1].name);
  });

  T.test('with no diagram there is nothing to print', function () {
    var area = document.createElement('div');
    area.appendChild(document.createElement('span'));
    ns.exportSvg.toPrintArea(area, doc(), null);
    T.eq(area.childNodes.length, 0, 'a stale drawing would print instead');
  });

  T.test('a file name is made from the diagram name', function () {
    T.eq(ns.exportSvg.fileName({ name: 'Domain Model' }), 'domain-model.svg');
    T.eq(ns.exportSvg.fileName({ name: '' }), 'diagram.svg');
    T.eq(ns.exportSvg.fileName(null), 'diagram.svg');
  });
})(UMLOne);
