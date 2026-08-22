// UMLOne — application wiring. Connects the store, renderer, interactions, and inspector
// to the chrome in index.html. Loaded last; everything it uses is already defined.

(function (ns) {
  'use strict';

  function boot() {
    var svg = document.getElementById('canvas');
    var host = document.getElementById('canvas-host');
    var inspectorBody = document.getElementById('inspector-body');
    var inspectorTitle = document.getElementById('inspector-title');
    var statusEl = document.getElementById('doc-status');
    var diagramSelect = document.getElementById('diagram-select');
    var fileInput = document.getElementById('file-input');
    var zoomLabel = document.getElementById('zoom-level');
    var paletteHint = document.getElementById('palette-hint');
    var printArea = document.getElementById('print-area');

    var store = new ns.commands.Store(starterDocument());
    var interactions = null;
    var inlineEdit = null;
    var panel = null;
    var transientStatus = '';
    var statusTimer = null;

    // --- rendering -----------------------------------------------------------

    function render() {
      // The renderer skips whichever line currently has a text box over it, so the two
      // never show the same text twice.
      interactions.state.editing = inlineEdit.editingState();
      ns.render.draw(svg, store.doc, store.currentDiagram(), interactions.state);
      updateChrome();
    }

    function refreshPanel() {
      interactions.pruneSelection();
      panel.render(interactions.selectionSummary());
    }

    function updateChrome() {
      document.getElementById('btn-undo').disabled = !store.canUndo();
      document.getElementById('btn-redo').disabled = !store.canRedo();
      document.getElementById('btn-diagram-delete').disabled =
        store.doc.diagrams.length <= 1;

      zoomLabel.textContent = Math.round(interactions.state.viewport.scale * 100) + '%';

      syncDiagramSelect();

      var name = store.fileName || 'untitled';
      document.title = (store.dirty ? '• ' : '') + name + ' — UMLOne';

      if (transientStatus) { return; }
      statusEl.className = 'status' + (store.dirty ? ' dirty' : '');
      statusEl.textContent = store.dirty ? name + ' — unsaved changes' : name;
    }

    function syncDiagramSelect() {
      var wanted = store.doc.diagrams.map(function (d) {
        return d.id + '\u0000' + d.name;
      }).join('|');

      // Rebuilding the <select> on every render would close it mid-interaction, so only
      // touch it when the diagram list actually changed.
      if (diagramSelect._signature !== wanted) {
        diagramSelect._signature = wanted;
        ns.clear(diagramSelect);
        store.doc.diagrams.forEach(function (d) {
          ns.html('option', { value: d.id, text: d.name }, diagramSelect);
        });
      }

      if (diagramSelect.value !== store.currentDiagramId) {
        diagramSelect.value = store.currentDiagramId;
      }
    }

    // Transient messages take over the status line for a few seconds, then hand it back
    // to the filename / unsaved-changes indicator. Without the timer a single "Downloaded
    // x" would suppress the dirty marker for the rest of the session.
    function setStatus(message, kind) {
      if (statusTimer) {
        window.clearTimeout(statusTimer);
        statusTimer = null;
      }

      transientStatus = message || '';

      if (!message) {
        updateChrome();
        return;
      }

      statusEl.className = 'status' + (kind === 'error' ? ' error' : '');
      statusEl.textContent = message;

      statusTimer = window.setTimeout(function () {
        statusTimer = null;
        transientStatus = '';
        updateChrome();
      }, kind === 'error' ? 8000 : 4000);
    }

    // Reports what the loader repaired, so a silently-modified file is never a surprise.
    function reportLoad(result) {
      if (!result.ok) {
        setStatus('Could not open: ' + result.errors[0], 'error');
        window.console.warn('UMLOne: load failed\n' + result.errors.join('\n'));
        return false;
      }

      if (result.warnings.length) {
        setStatus('Opened with ' + result.warnings.length + ' repair(s) — see console');
        window.console.warn('UMLOne: repaired on load\n' + result.warnings.join('\n'));
      } else {
        setStatus('');
      }
      return true;
    }

    // --- document lifecycle --------------------------------------------------

    function starterDocument() {
      var doc = ns.model.createDocument();
      doc.diagrams.push(ns.diagram.createDiagram('Main'));
      return doc;
    }

    function confirmDiscard() {
      // Whatever is half-typed counts as a change worth warning about.
      inlineEdit.commit();
      if (!store.dirty) { return true; }
      return window.confirm(
        'This document has unsaved changes that will be lost. Continue?');
    }

    function openFile(file) {
      if (!confirmDiscard()) { return; }
      ns.io.readFile(file, function (result) {
        if (!reportLoad(result)) { return; }
        store.replace(result.doc, result.fileName);
        interactions.clearSelection(true);
        interactions.fitToContent();
        refreshPanel();
      });
    }

    function downloadDocument() {
      // Saving with a field still open must save what is in the field.
      inlineEdit.commit();
      var name = ns.io.suggestFileName(store.doc, store.fileName);
      try {
        ns.io.download(ns.io.serialize(store.doc), name);
      } catch (e) {
        setStatus('Could not save: ' + e.message, 'error');
        window.console.error(e);
        return;
      }
      store.markSaved(name);
      setStatus('Downloaded ' + name);
    }

    // The image is of one diagram, not of the document: what is exported is what is on
    // screen. It does not count as saving — the document is still unsaved afterwards,
    // because an SVG cannot be opened back into the editor.
    function exportDiagram() {
      inlineEdit.commit();
      var diagram = store.currentDiagram();
      if (!diagram) { return; }

      var name = ns.exportSvg.fileName(diagram);
      try {
        ns.io.download(ns.exportSvg.serialize(store.doc, diagram), name, 'image/svg+xml');
      } catch (e) {
        setStatus('Could not export: ' + e.message, 'error');
        window.console.error(e);
        return;
      }
      setStatus('Exported ' + name);
    }

    // Printing goes through the same builder as the export, so what comes out of the
    // printer is what comes out of the file.
    //
    // Filling the print area happens on `beforeprint` too, not only on the button: the
    // print stylesheet hides the editor, so a Ctrl+P or a File > Print that found the
    // area empty would produce a blank sheet, which is a worse outcome than not
    // supporting them at all.
    function preparePrint() {
      // Half-typed text is text: whatever is in an open field belongs on the page.
      inlineEdit.commit();
      var diagram = store.currentDiagram();
      if (!diagram) { return false; }
      ns.exportSvg.toPrintArea(printArea, store.doc, diagram);
      return true;
    }

    function printDiagram() {
      if (!preparePrint()) { return; }
      window.print();
    }

    // --- construction --------------------------------------------------------

    panel = ns.panel.create({
      container: inspectorBody,
      titleEl: inspectorTitle,
      store: store,
      onChange: function () {
        render();
        refreshPanel();
      }
    });

    // Created before `interactions` because interact needs to call into it on
    // double-click. Its callbacks only run later, by which point both exist.
    inlineEdit = ns.inlineEdit.create({
      host: host,
      store: store,
      getViewport: function () { return interactions.state.viewport; },
      onRender: function () {
        render();
        refreshPanel();
      },
      onSelectNode: function (nodeId) {
        interactions.selectNode(nodeId, false);
      }
    });

    interactions = ns.interact.create({
      svg: svg,
      host: host,
      store: store,
      inlineEdit: inlineEdit,
      onRender: render,
      onSelectionChange: function (summary) {
        panel.render(summary);
      },
      onStatus: setStatus,
      onToolChange: function (type, kind) { syncPalette(type, kind); }
    });

    store.on('change', function (event) {
      render();
      if (!event.continuous) { refreshPanel(); }
    });

    // --- toolbar -------------------------------------------------------------

    document.getElementById('btn-new').addEventListener('click', function () {
      if (!confirmDiscard()) { return; }
      store.replace(starterDocument(), null);
      interactions.clearSelection(true);
      interactions.fitToContent();
      refreshPanel();
      setStatus('');
    });

    document.getElementById('btn-open').addEventListener('click', function () {
      fileInput.click();
    });

    fileInput.addEventListener('change', function () {
      if (fileInput.files && fileInput.files.length) {
        openFile(fileInput.files[0]);
      }
      // Reset so picking the same file twice fires another change event.
      fileInput.value = '';
    });

    document.getElementById('btn-download').addEventListener('click', downloadDocument);

    document.getElementById('btn-export-svg').addEventListener('click', exportDiagram);

    document.getElementById('btn-print').addEventListener('click', printDiagram);

    document.getElementById('btn-layout').addEventListener('click', function () {
      inlineEdit.commit();
      var diagram = store.currentDiagram();
      if (!diagram || !diagram.nodes.length) { return; }

      if (!ns.commands.autoLayout(store, store.currentDiagramId)) {
        setStatus('Already arranged.');
        return;
      }

      // Everything has moved, so what was on screen probably is not any more.
      interactions.fitToContent();
      refreshPanel();
      setStatus('Arranged ' + diagram.nodes.length +
                (diagram.nodes.length === 1 ? ' box.' : ' boxes.'));
    });

    document.getElementById('btn-undo').addEventListener('click', function () {
      inlineEdit.commit();
      store.undo();
      refreshPanel();
    });

    document.getElementById('btn-redo').addEventListener('click', function () {
      inlineEdit.commit();
      store.redo();
      refreshPanel();
    });

    document.getElementById('btn-zoom-in').addEventListener('click', function () {
      interactions.zoomBy(1.2);
    });

    document.getElementById('btn-zoom-out').addEventListener('click', function () {
      interactions.zoomBy(1 / 1.2);
    });

    document.getElementById('btn-zoom-fit').addEventListener('click', function () {
      interactions.fitToContent();
    });

    document.getElementById('btn-zoom-reset').addEventListener('click', function () {
      interactions.zoomTo(1);
    });

    // --- diagram management --------------------------------------------------

    diagramSelect.addEventListener('change', function () {
      inlineEdit.commit();
      store.setCurrentDiagram(diagramSelect.value);
      interactions.clearSelection(true);
      render();
      refreshPanel();
    });

    document.getElementById('btn-diagram-add').addEventListener('click', function () {
      var name = window.prompt('Name for the new diagram',
                               'Diagram ' + (store.doc.diagrams.length + 1));
      if (name === null) { return; }
      ns.commands.addDiagram(store, name.trim() || 'Diagram');
      interactions.clearSelection(true);
      render();
      refreshPanel();
    });

    document.getElementById('btn-diagram-rename').addEventListener('click', function () {
      var diagram = store.currentDiagram();
      if (!diagram) { return; }
      var name = window.prompt('Rename diagram', diagram.name);
      if (name === null) { return; }
      store.apply('rename diagram', function (doc) {
        var target = ns.diagram.findDiagram(doc, store.currentDiagramId);
        if (!target) { return false; }
        target.name = name.trim() || target.name;
        return true;
      });
    });

    document.getElementById('btn-diagram-delete').addEventListener('click', function () {
      var diagram = store.currentDiagram();
      if (!diagram) { return; }
      if (store.doc.diagrams.length <= 1) { return; }
      if (!window.confirm('Delete the diagram "' + diagram.name +
                          '"? The elements on it stay in the model.')) {
        return;
      }
      ns.commands.removeDiagram(store, diagram.id);
      store.setCurrentDiagram(store.doc.diagrams[0].id);
      interactions.clearSelection(true);
      render();
      refreshPanel();
    });

    // --- palette -------------------------------------------------------------

    var toolButtons = Array.prototype.slice.call(
      document.querySelectorAll('#palette .tool'));

    toolButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        interactions.setTool(btn.getAttribute('data-tool'),
                             btn.getAttribute('data-kind') || null);
      });
    });

    // Driven by interact's onToolChange rather than by the click handler, so the palette
    // still tracks the tool when it resets itself after placing an element or on Escape.
    function syncPalette(type, kind) {
      toolButtons.forEach(function (btn) {
        btn.classList.toggle(
          'active',
          btn.getAttribute('data-tool') === type &&
          (btn.getAttribute('data-kind') || null) === kind
        );
      });
      paletteHint.textContent = hintFor(type, kind);
    }

    function hintFor(type, kind) {
      if (type === 'node') {
        return 'Click on the canvas to place the ' + kind + '.';
      }
      if (type === 'edge') {
        var semantics = ns.model.endSemantics(kind);
        return 'Click the ' + semantics.source.toLowerCase() + ', then the ' +
               semantics.target.toLowerCase() + '.';
      }
      return 'Drag to move. Double-click a box to rename it, or a line to add a bend. ' +
             'Delete removes from the model; Shift+Delete removes from this diagram only.';
    }

    // --- drag and drop -------------------------------------------------------

    ns.io.installDropTarget(host, openFile, function (active) {
      host.classList.toggle('drop-active', active);
    });

    // Dropping a file anywhere else would make the browser navigate away from the editor,
    // silently discarding unsaved work.
    ['dragover', 'drop'].forEach(function (type) {
      window.addEventListener(type, function (e) {
        if (!host.contains(e.target)) { e.preventDefault(); }
      });
    });

    // --- unsaved-changes guard ----------------------------------------------

    window.addEventListener('beforeunload', function (e) {
      if (!store.dirty) { return; }
      e.preventDefault();
      e.returnValue = '';
      return '';
    });

    // Ctrl/Cmd+P should print the diagram, not a screenshot of the editor. Handled here
    // rather than in interact.js because the browser's own print shortcut has to be taken
    // away from it even while a text field has the focus.
    document.addEventListener('keydown', function (evt) {
      if (!(evt.ctrlKey || evt.metaKey) || !evt.key) { return; }
      if (evt.key.toLowerCase() !== 'p') { return; }
      evt.preventDefault();
      printDiagram();
    });

    window.addEventListener('beforeprint', preparePrint);

    // Holding on to a copy of the diagram after printing serves nothing, and a stale one
    // would be what the next Ctrl+P showed if anything went wrong refilling it.
    window.addEventListener('afterprint', function () { ns.clear(printArea); });

    window.addEventListener('resize', render);

    // --- go ------------------------------------------------------------------

    syncPalette('select', null);
    render();
    refreshPanel();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(UMLOne);
