// UMLOne — document validation and normalization.
//
// Hand-written, because no schema library may be downloaded. That turns out to suit the
// job: the rules that matter here are referential (does this ref resolve? is this element
// on this diagram?) and a JSON Schema could not express them anyway.
//
// Normalization rebuilds every object from scratch with its keys inserted in a fixed
// order. Two consequences worth knowing:
//   * unknown junk is dropped rather than carried along;
//   * because JS preserves string-key insertion order, JSON.stringify then emits a
//     canonical byte-identical form, which is what makes "load then save" a no-op diff.
//
// Errors are fatal and abort the load. Warnings are repairs already applied, reported so
// the user learns their file was changed rather than discovering it silently later.

(function (ns) {
  'use strict';

  var CURRENT_VERSION = 1;
  var MIN_NODE_W = 40;
  var MIN_NODE_H = 30;

  function Report() {
    this.errors = [];
    this.warnings = [];
  }

  Report.prototype.error = function (path, message) {
    this.errors.push(path + ': ' + message);
  };

  Report.prototype.warn = function (path, message) {
    this.warnings.push(path + ': ' + message);
  };

  Report.prototype.ok = function () {
    return this.errors.length === 0;
  };

  // --- coercion helpers ------------------------------------------------------

  function str(value, fallback) {
    return typeof value === 'string' ? value : (fallback === undefined ? '' : fallback);
  }

  function bool(value, fallback) {
    return typeof value === 'boolean' ? value : !!fallback;
  }

  function num(value, fallback) {
    var n = typeof value === 'number' ? value : parseFloat(value);
    return isFinite(n) ? n : fallback;
  }

  function arr(value) {
    return Array.isArray(value) ? value : [];
  }

  function oneOf(value, allowed, fallback) {
    return allowed.indexOf(value) >= 0 ? value : fallback;
  }

  function stringList(value) {
    return arr(value)
      .filter(function (v) { return typeof v === 'string' && v.length > 0; });
  }

  // --- model normalization ---------------------------------------------------

  function normalizeAttribute(raw, report, path) {
    var multiplicity = str(raw.multiplicity);
    if (!ns.model.isValidMultiplicity(multiplicity)) {
      report.warn(path, 'discarded unparseable multiplicity "' + multiplicity + '"');
      multiplicity = '';
    }
    return {
      id: str(raw.id) || ns.uid('a'),
      name: str(raw.name),
      type: str(raw.type),
      visibility: oneOf(raw.visibility, ns.model.VISIBILITIES, 'private'),
      multiplicity: multiplicity,
      defaultValue: str(raw.defaultValue),
      isStatic: bool(raw.isStatic),
      isDerived: bool(raw.isDerived)
    };
  }

  function normalizeParameter(raw) {
    return {
      name: str(raw.name),
      type: str(raw.type),
      direction: oneOf(raw.direction, ['in', 'out', 'inout', 'return'], 'in')
    };
  }

  function normalizeOperation(raw) {
    return {
      id: str(raw.id) || ns.uid('o'),
      name: str(raw.name),
      returnType: str(raw.returnType),
      visibility: oneOf(raw.visibility, ns.model.VISIBILITIES, 'public'),
      isStatic: bool(raw.isStatic),
      isAbstract: bool(raw.isAbstract),
      parameters: arr(raw.parameters).filter(ns.isObject).map(normalizeParameter)
    };
  }

  function normalizeElement(raw, report, path) {
    if (!ns.isObject(raw)) {
      report.error(path, 'expected an object');
      return null;
    }

    var kind = oneOf(raw.kind, ns.model.ELEMENT_KINDS, null);
    if (!kind) {
      report.error(path, 'unknown element kind "' + raw.kind + '"');
      return null;
    }

    var id = str(raw.id);
    if (!id) {
      report.error(path, 'element has no id');
      return null;
    }

    // Key insertion order below is the canonical serialization order. Keep id and kind
    // first so a file stays readable when someone opens it in a text editor.
    var out = { id: id, kind: kind };

    if (kind === 'comment') {
      out.body = str(raw.body);
    } else {
      out.name = str(raw.name);
      var traits = ns.model.traits(kind);
      if (traits.abstractable) {
        out.isAbstract = bool(raw.isAbstract);
      }
      out.stereotypes = stringList(raw.stereotypes);
      if (traits.attributes) {
        out.attributes = arr(raw.attributes)
          .filter(ns.isObject)
          .map(function (a, i) {
            return normalizeAttribute(a, report, path + '.attributes[' + i + ']');
          });
      }
      if (traits.operations) {
        out.operations = arr(raw.operations).filter(ns.isObject).map(normalizeOperation);
      }
      if (traits.literals) {
        out.literals = stringList(raw.literals);
      }
    }

    out.owner = str(raw.owner, null) || null;
    return out;
  }

  function normalizeEnd(raw, report, path) {
    var source = ns.isObject(raw) ? raw : {};
    var multiplicity = str(source.multiplicity);
    if (!ns.model.isValidMultiplicity(multiplicity)) {
      report.warn(path, 'discarded unparseable multiplicity "' + multiplicity + '"');
      multiplicity = '';
    }
    return {
      ref: str(source.ref, null) || null,
      role: str(source.role),
      multiplicity: multiplicity,
      visibility: oneOf(source.visibility, ns.model.VISIBILITIES, 'public'),
      navigable: bool(source.navigable)
    };
  }

  function normalizeRelationship(raw, report, path) {
    if (!ns.isObject(raw)) {
      report.error(path, 'expected an object');
      return null;
    }

    var kind = oneOf(raw.kind, ns.model.RELATIONSHIP_KINDS, null);
    if (!kind) {
      report.error(path, 'unknown relationship kind "' + raw.kind + '"');
      return null;
    }

    var id = str(raw.id);
    if (!id) {
      report.error(path, 'relationship has no id');
      return null;
    }

    var ends = arr(raw.ends);
    if (ends.length !== 2) {
      report.error(path, 'expected exactly 2 ends, found ' + ends.length);
      return null;
    }

    return {
      id: id,
      kind: kind,
      name: str(raw.name),
      ends: [
        normalizeEnd(ends[0], report, path + '.ends[0]'),
        normalizeEnd(ends[1], report, path + '.ends[1]')
      ]
    };
  }

  // --- diagram normalization -------------------------------------------------

  function normalizeNode(raw, report, path) {
    if (!ns.isObject(raw)) {
      report.error(path, 'expected an object');
      return null;
    }

    var ref = str(raw.ref);
    if (!ref) {
      report.error(path, 'node has no ref');
      return null;
    }

    var w = num(raw.w, null);
    var h = num(raw.h, null);
    if (w === null || h === null) {
      report.warn(path, 'missing size, using a default');
    }
    w = Math.max(MIN_NODE_W, w === null ? 180 : w);
    h = Math.max(MIN_NODE_H, h === null ? 90 : h);

    var show = ns.isObject(raw.show) ? raw.show : {};

    return {
      id: str(raw.id) || ns.uid('n'),
      ref: ref,
      x: num(raw.x, 0),
      y: num(raw.y, 0),
      w: w,
      h: h,
      show: {
        attributes: bool(show.attributes, true),
        operations: bool(show.operations, true)
      }
    };
  }

  function normalizeWaypoints(raw, report, path) {
    return arr(raw)
      .map(function (point, i) {
        // Accept both [x, y] and {x, y}; emit the compact array form.
        if (Array.isArray(point) && point.length >= 2) {
          return [num(point[0], null), num(point[1], null)];
        }
        if (ns.isObject(point)) {
          return [num(point.x, null), num(point.y, null)];
        }
        report.warn(path + '[' + i + ']', 'dropped malformed waypoint');
        return null;
      })
      .filter(function (p) {
        return p !== null && p[0] !== null && p[1] !== null;
      });
  }

  function normalizeLabels(raw) {
    var source = ns.isObject(raw) ? raw : {};
    var out = {};
    // Fixed key order so serialization stays canonical.
    ['name', 'sourceRole', 'sourceMultiplicity', 'targetRole', 'targetMultiplicity']
      .forEach(function (key) {
        if (ns.isObject(source[key])) {
          out[key] = { dx: num(source[key].dx, 0), dy: num(source[key].dy, 0) };
        }
      });
    return out;
  }

  function normalizeEdge(raw, report, path) {
    if (!ns.isObject(raw)) {
      report.error(path, 'expected an object');
      return null;
    }

    var ref = str(raw.ref);
    if (!ref) {
      report.error(path, 'edge has no ref');
      return null;
    }

    return {
      id: str(raw.id) || ns.uid('g'),
      ref: ref,
      waypoints: normalizeWaypoints(raw.waypoints, report, path + '.waypoints'),
      labels: normalizeLabels(raw.labels)
    };
  }

  function normalizeDiagram(raw, report, path) {
    if (!ns.isObject(raw)) {
      report.error(path, 'expected an object');
      return null;
    }

    return {
      id: str(raw.id) || ns.uid('d'),
      name: str(raw.name, 'Diagram') || 'Diagram',
      nodes: arr(raw.nodes)
        .map(function (n, i) { return normalizeNode(n, report, path + '.nodes[' + i + ']'); })
        .filter(Boolean),
      edges: arr(raw.edges)
        .map(function (e, i) { return normalizeEdge(e, report, path + '.edges[' + i + ']'); })
        .filter(Boolean)
    };
  }

  // --- referential checks ----------------------------------------------------

  function checkUniqueIds(doc, report) {
    var seen = {};

    function claim(id, what) {
      if (seen[id]) {
        report.error(what, 'duplicate id "' + id + '" (also used by ' + seen[id] + ')');
        return false;
      }
      seen[id] = what;
      return true;
    }

    doc.model.elements.forEach(function (el, i) {
      claim(el.id, 'model.elements[' + i + ']');
    });
    doc.model.relationships.forEach(function (rel, i) {
      claim(rel.id, 'model.relationships[' + i + ']');
    });
    doc.diagrams.forEach(function (d, i) {
      claim(d.id, 'diagrams[' + i + ']');
    });
  }

  function checkReferences(doc, report) {
    doc.model.elements.forEach(function (el, i) {
      if (el.owner && !ns.model.findElement(doc, el.owner)) {
        report.warn('model.elements[' + i + ']',
          'owner "' + el.owner + '" does not exist; moved to top level');
        el.owner = null;
      } else if (el.owner) {
        var owner = ns.model.findElement(doc, el.owner);
        if (owner.kind !== 'package') {
          report.warn('model.elements[' + i + ']',
            'owner "' + el.owner + '" is not a package; moved to top level');
          el.owner = null;
        } else if (!ns.model.canOwn(doc, el.id, el.owner)) {
          report.warn('model.elements[' + i + ']',
            'owner chain is cyclic; moved to top level');
          el.owner = null;
        }
      }
    });

    // Dangling relationship endpoints are fatal: unlike a bad owner there is no sensible
    // repair, and silently deleting the relationship would lose real user intent.
    doc.model.relationships.forEach(function (rel, i) {
      rel.ends.forEach(function (end, e) {
        if (!end.ref) {
          report.error('model.relationships[' + i + '].ends[' + e + ']', 'ref is empty');
        } else if (!ns.model.findElement(doc, end.ref)) {
          report.error('model.relationships[' + i + '].ends[' + e + ']',
            'ref "' + end.ref + '" does not match any element');
        }
      });

      if (rel.kind === 'annotation') {
        var note = ns.model.findElement(doc, rel.ends[0].ref);
        if (note && note.kind !== 'comment') {
          report.warn('model.relationships[' + i + ']',
            'annotation source is not a note; ends were swapped to fix it');
          rel.ends.reverse();
        }
      }
    });
  }

  // --- entry point -----------------------------------------------------------

  // Takes anything (typically the result of JSON.parse) and returns
  // { ok, doc, errors, warnings }. `doc` is a brand-new canonical object; the input is
  // never mutated.
  function normalizeDocument(raw) {
    var report = new Report();

    if (!ns.isObject(raw)) {
      report.error('document', 'expected a JSON object at the top level');
      return { ok: false, doc: null, errors: report.errors, warnings: report.warnings };
    }

    if (raw.format !== undefined && raw.format !== 'umlone') {
      report.error('document.format',
        'this is not a UMLOne file (format "' + raw.format + '")');
      return { ok: false, doc: null, errors: report.errors, warnings: report.warnings };
    }

    var version = num(raw.version, 1);
    if (version > CURRENT_VERSION) {
      report.error('document.version',
        'file version ' + version + ' is newer than this editor supports (' +
        CURRENT_VERSION + ')');
      return { ok: false, doc: null, errors: report.errors, warnings: report.warnings };
    }

    var rawModel = ns.isObject(raw.model) ? raw.model : {};

    var doc = {
      format: 'umlone',
      version: CURRENT_VERSION,
      model: {
        elements: arr(rawModel.elements)
          .map(function (el, i) {
            return normalizeElement(el, report, 'model.elements[' + i + ']');
          })
          .filter(Boolean),
        relationships: arr(rawModel.relationships)
          .map(function (rel, i) {
            return normalizeRelationship(rel, report, 'model.relationships[' + i + ']');
          })
          .filter(Boolean)
      },
      diagrams: arr(raw.diagrams)
        .map(function (d, i) { return normalizeDiagram(d, report, 'diagrams[' + i + ']'); })
        .filter(Boolean)
    };

    checkUniqueIds(doc, report);

    if (report.ok()) {
      checkReferences(doc, report);
    }

    if (report.ok()) {
      var pruned = ns.diagram.prune(doc);
      if (pruned > 0) {
        report.warn('diagrams',
          'removed ' + pruned + ' diagram item(s) that referenced missing elements');
      }
      if (doc.diagrams.length === 0) {
        doc.diagrams.push(ns.diagram.createDiagram('Main'));
        report.warn('diagrams', 'file contained no diagrams; added an empty one');
      }
    }

    return {
      ok: report.ok(),
      doc: report.ok() ? doc : null,
      errors: report.errors,
      warnings: report.warnings
    };
  }

  ns.validate = {
    CURRENT_VERSION: CURRENT_VERSION,
    MIN_NODE_W: MIN_NODE_W,
    MIN_NODE_H: MIN_NODE_H,
    normalizeDocument: normalizeDocument
  };
})(UMLOne);
