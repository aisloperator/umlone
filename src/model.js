// UMLOne — the semantic half of a document.
//
// A document is plain JSON data, never a graph of class instances. That is what makes
// snapshot undo and lossless round-tripping cheap: `JSON.parse(JSON.stringify(doc))` is
// a complete, faithful copy. So everything here is a function over plain objects.
//
// This file knows nothing about diagrams, geometry, or the DOM. Removing an element here
// leaves dangling views behind on purpose; `UMLOne.diagram.prune` is what cleans those
// up, which keeps the load order one-directional (model before diagram).

(function (ns) {
  'use strict';

  var ELEMENT_KINDS = ['class', 'interface', 'enumeration', 'package', 'comment'];

  var RELATIONSHIP_KINDS = [
    'association',
    'aggregation',
    'composition',
    'generalization',
    'realization',
    'dependency',
    'annotation'
  ];

  var VISIBILITIES = ['public', 'protected', 'private', 'package'];

  var VISIBILITY_SYMBOL = {
    public: '+',
    protected: '#',
    private: '-',
    package: '~'
  };

  // Which classifiers carry which compartments. Drives both the inspector and the
  // renderer, so there is one answer rather than two that can drift apart.
  var KIND_TRAITS = {
    'class': { attributes: true, operations: true, literals: false, abstractable: true },
    'interface': { attributes: false, operations: true, literals: false, abstractable: false },
    'enumeration': { attributes: false, operations: false, literals: true, abstractable: false },
    'package': { attributes: false, operations: false, literals: false, abstractable: false },
    'comment': { attributes: false, operations: false, literals: false, abstractable: false }
  };

  // `ends` is always [source, target]. The meaning of that ordering is per-kind, and this
  // table is the single place it is written down — renderer, inspector, and validator all
  // read their wording from here instead of each inventing their own.
  var END_SEMANTICS = {
    association: { source: 'Source', target: 'Target', labelled: true },
    aggregation: { source: 'Whole', target: 'Part', labelled: true },
    composition: { source: 'Whole', target: 'Part', labelled: true },
    generalization: { source: 'Subtype', target: 'Supertype', labelled: false },
    realization: { source: 'Implementation', target: 'Interface', labelled: false },
    dependency: { source: 'Client', target: 'Supplier', labelled: false },
    annotation: { source: 'Note', target: 'Annotated', labelled: false }
  };

  var MULTIPLICITY_RE = /^(\*|\d+|\d+\.\.(\d+|\*))$/;

  function traits(kind) {
    return KIND_TRAITS[kind] || KIND_TRAITS['class'];
  }

  function endSemantics(kind) {
    return END_SEMANTICS[kind] || END_SEMANTICS.association;
  }

  function isValidMultiplicity(text) {
    if (text === undefined || text === null || text === '') {
      return true; // absent is legal; it just renders nothing
    }
    if (!MULTIPLICITY_RE.test(String(text).trim())) {
      return false;
    }
    // "5..2" parses but means nothing. Catch the inverted range too.
    var parts = String(text).trim().split('..');
    if (parts.length === 2 && parts[1] !== '*') {
      return Number(parts[0]) <= Number(parts[1]);
    }
    return true;
  }

  // --- construction ----------------------------------------------------------

  function createDocument() {
    return {
      format: 'umlone',
      version: 1,
      model: { elements: [], relationships: [] },
      diagrams: []
    };
  }

  function createElement(kind, props) {
    ns.assert(ELEMENT_KINDS.indexOf(kind) >= 0, 'unknown element kind: ' + kind);
    var el = {
      id: ns.uid('e'),
      kind: kind,
      name: '',
      stereotypes: [],
      owner: null
    };

    if (kind === 'comment') {
      delete el.name;
      delete el.stereotypes;
      el.body = '';
    } else {
      var t = traits(kind);
      if (t.abstractable) { el.isAbstract = false; }
      if (t.attributes) { el.attributes = []; }
      if (t.operations) { el.operations = []; }
      if (t.literals) { el.literals = []; }
    }

    return Object.assign(el, props || {});
  }

  function createAttribute(props) {
    return Object.assign({
      id: ns.uid('a'),
      name: 'attribute',
      type: '',
      visibility: 'private',
      multiplicity: '',
      defaultValue: '',
      isStatic: false,
      isDerived: false
    }, props || {});
  }

  function createParameter(props) {
    return Object.assign({
      name: 'arg',
      type: '',
      direction: 'in'
    }, props || {});
  }

  function createOperation(props) {
    return Object.assign({
      id: ns.uid('o'),
      name: 'operation',
      returnType: '',
      visibility: 'public',
      isStatic: false,
      isAbstract: false,
      parameters: []
    }, props || {});
  }

  function createRelationship(kind, sourceId, targetId, props) {
    ns.assert(RELATIONSHIP_KINDS.indexOf(kind) >= 0, 'unknown relationship kind: ' + kind);
    return Object.assign({
      id: ns.uid('r'),
      kind: kind,
      name: '',
      ends: [createEnd(sourceId), createEnd(targetId)]
    }, props || {});
  }

  function createEnd(ref, props) {
    return Object.assign({
      ref: ref || null,
      role: '',
      multiplicity: '',
      visibility: 'public',
      navigable: false
    }, props || {});
  }

  // --- lookup ----------------------------------------------------------------

  function findElement(doc, id) {
    var list = doc.model.elements;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) { return list[i]; }
    }
    return null;
  }

  function findRelationship(doc, id) {
    var list = doc.model.relationships;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) { return list[i]; }
    }
    return null;
  }

  function relationshipsFor(doc, elementId) {
    return doc.model.relationships.filter(function (rel) {
      return rel.ends.some(function (end) { return end.ref === elementId; });
    });
  }

  function childrenOf(doc, packageId) {
    return doc.model.elements.filter(function (el) { return el.owner === packageId; });
  }

  // --- mutation --------------------------------------------------------------

  function addElement(doc, element) {
    doc.model.elements.push(element);
    return element;
  }

  function addRelationship(doc, relationship) {
    doc.model.relationships.push(relationship);
    return relationship;
  }

  // Removes the element and every relationship touching it. Elements it owned are
  // re-parented to the top level rather than deleted: deleting a package should not
  // silently destroy the classes inside it, which is not recoverable from the user's
  // point of view even with undo available.
  function removeElement(doc, id) {
    doc.model.elements = doc.model.elements.filter(function (el) { return el.id !== id; });

    doc.model.elements.forEach(function (el) {
      if (el.owner === id) { el.owner = null; }
    });

    doc.model.relationships = doc.model.relationships.filter(function (rel) {
      return !rel.ends.some(function (end) { return end.ref === id; });
    });
  }

  function removeRelationship(doc, id) {
    doc.model.relationships = doc.model.relationships.filter(function (rel) {
      return rel.id !== id;
    });
  }

  // Guards against a package cycle (a owning b owning a), which would make containment
  // rendering recurse forever.
  function canOwn(doc, childId, packageId) {
    if (!packageId) { return true; }
    if (childId === packageId) { return false; }
    var seen = {};
    var cursor = findElement(doc, packageId);
    while (cursor) {
      if (cursor.id === childId) { return false; }
      if (seen[cursor.id]) { return false; }
      seen[cursor.id] = true;
      cursor = cursor.owner ? findElement(doc, cursor.owner) : null;
    }
    return true;
  }

  // --- display ---------------------------------------------------------------

  function visibilitySymbol(visibility) {
    return VISIBILITY_SYMBOL[visibility] || '';
  }

  function formatAttribute(attr) {
    var text = visibilitySymbol(attr.visibility) + ' ';
    if (attr.isDerived) { text += '/'; }
    text += attr.name || '';
    if (attr.type) { text += ': ' + attr.type; }
    if (attr.multiplicity) { text += ' [' + attr.multiplicity + ']'; }
    if (attr.defaultValue) { text += ' = ' + attr.defaultValue; }
    return text;
  }

  function formatParameter(param) {
    var text = '';
    if (param.direction && param.direction !== 'in') { text += param.direction + ' '; }
    text += param.name || '';
    if (param.type) { text += ': ' + param.type; }
    return text;
  }

  function formatOperation(op) {
    var params = (op.parameters || []).map(formatParameter).join(', ');
    var text = visibilitySymbol(op.visibility) + ' ' + (op.name || '') + '(' + params + ')';
    if (op.returnType) { text += ': ' + op.returnType; }
    return text;
  }

  function formatStereotypes(stereotypes) {
    if (!stereotypes || !stereotypes.length) { return ''; }
    return '«' + stereotypes.join(', ') + '»';
  }

  // What to show for an element in lists, tooltips, and the inspector heading.
  function displayName(element) {
    if (!element) { return '(missing)'; }
    if (element.kind === 'comment') {
      var body = (element.body || '').replace(/\s+/g, ' ').trim();
      return body ? 'Note: ' + body.slice(0, 30) : 'Note';
    }
    return element.name || '(unnamed ' + element.kind + ')';
  }

  ns.model = {
    ELEMENT_KINDS: ELEMENT_KINDS,
    RELATIONSHIP_KINDS: RELATIONSHIP_KINDS,
    VISIBILITIES: VISIBILITIES,
    KIND_TRAITS: KIND_TRAITS,
    END_SEMANTICS: END_SEMANTICS,
    traits: traits,
    endSemantics: endSemantics,
    isValidMultiplicity: isValidMultiplicity,

    createDocument: createDocument,
    createElement: createElement,
    createAttribute: createAttribute,
    createOperation: createOperation,
    createParameter: createParameter,
    createRelationship: createRelationship,
    createEnd: createEnd,

    findElement: findElement,
    findRelationship: findRelationship,
    relationshipsFor: relationshipsFor,
    childrenOf: childrenOf,

    addElement: addElement,
    addRelationship: addRelationship,
    removeElement: removeElement,
    removeRelationship: removeRelationship,
    canOwn: canOwn,

    visibilitySymbol: visibilitySymbol,
    formatAttribute: formatAttribute,
    formatOperation: formatOperation,
    formatParameter: formatParameter,
    formatStereotypes: formatStereotypes,
    displayName: displayName
  };
})(UMLOne);
