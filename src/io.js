// UMLOne — persistence. With no server, the entire storage story is: read a File the user
// picked, and hand back a Blob the browser downloads.
//
// There is deliberately no "save in place". A page loaded from file:// cannot write back
// to the file it was opened from; every save is a fresh download to the Downloads folder.
// The UI says "Download" for exactly that reason — calling it Save would imply an
// overwrite that never happens.

(function (ns) {
  'use strict';

  var FILE_EXTENSION = '.uml.json';

  // Normalizes first, so what gets written is the canonical form: fixed key order, no
  // stray fields. Loading a file and immediately downloading it produces identical bytes.
  function serialize(doc) {
    var result = ns.validate.normalizeDocument(doc);
    if (!result.ok) {
      throw new Error('refusing to serialize an invalid document:\n' +
                      result.errors.join('\n'));
    }
    return JSON.stringify(result.doc, null, 2) + '\n';
  }

  // Returns the same shape as normalizeDocument, with parse failures reported as errors
  // rather than thrown — a truncated or non-JSON file is a user mistake, not a crash.
  function deserialize(text) {
    var raw;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      return {
        ok: false,
        doc: null,
        errors: ['document: not valid JSON (' + e.message + ')'],
        warnings: []
      };
    }
    return ns.validate.normalizeDocument(raw);
  }

  function readFile(file, callback) {
    var reader = new FileReader();

    reader.onload = function () {
      var result = deserialize(String(reader.result));
      result.fileName = file.name;
      callback(result);
    };

    reader.onerror = function () {
      callback({
        ok: false,
        doc: null,
        errors: ['could not read "' + file.name + '"'],
        warnings: [],
        fileName: file.name
      });
    };

    reader.readAsText(file);
  }

  function download(text, fileName, mimeType) {
    var blob = new Blob([text], { type: mimeType || 'application/json' });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = fileName;
    // Must be in the document for the synthetic click to count in Firefox.
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    // Revoking immediately can cancel the download in some builds; one turn of the event
    // loop is enough for the browser to have taken its own reference.
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  // One rule for turning something's name into a file name, so the document download and
  // the SVG export cannot drift into naming the same diagram two different things.
  function slugify(name, fallback) {
    var base = String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return base || fallback || 'untitled';
  }

  function suggestFileName(doc, currentName) {
    if (currentName) { return currentName; }
    var first = doc.diagrams && doc.diagrams[0];
    return slugify(first && first.name, 'diagram') + FILE_EXTENSION;
  }

  // Drag-and-drop onto the canvas. dragover must be cancelled or the browser navigates to
  // the file instead of handing it over.
  function installDropTarget(element, onFile, onStateChange) {
    var depth = 0;

    function setActive(active) {
      if (onStateChange) { onStateChange(active); }
    }

    element.addEventListener('dragenter', function (e) {
      e.preventDefault();
      depth++;
      setActive(true);
    });

    element.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    element.addEventListener('dragleave', function () {
      // dragenter/dragleave fire for descendants too, hence the depth counter rather
      // than a boolean.
      depth = Math.max(0, depth - 1);
      if (depth === 0) { setActive(false); }
    });

    element.addEventListener('drop', function (e) {
      e.preventDefault();
      depth = 0;
      setActive(false);
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) {
        onFile(files[0]);
      }
    });
  }

  ns.io = {
    FILE_EXTENSION: FILE_EXTENSION,
    serialize: serialize,
    deserialize: deserialize,
    readFile: readFile,
    download: download,
    slugify: slugify,
    suggestFileName: suggestFileName,
    installDropTarget: installDropTarget
  };
})(UMLOne);
