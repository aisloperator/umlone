// UMLOne — the property inspector.
//
// Builds a form for whatever is selected and writes changes back through the store, so
// everything typed here is undoable like any other edit.
//
// Text fields commit on `change` (blur or Enter), not on `input`. Committing per
// keystroke would push a history entry per character and rebuild the panel underneath the
// caret; committing on blur gives one undo step per edit and keeps focus stable while
// typing.

(function (ns) {
  'use strict';

  var model = ns.model;

  function create(options) {
    var container = options.container;
    var titleEl = options.titleEl;
    var store = options.store;
    var onChange = options.onChange || function () {};

    var current = { kind: 'none' };

    // --- small builders ------------------------------------------------------

    function field(parent, labelText, control) {
      var row = ns.html('div', { 'class': 'field' }, parent);
      ns.html('label', { text: labelText }, row);
      row.appendChild(control);
      return row;
    }

    function textInput(value, onCommit, placeholder) {
      var input = ns.html('input', { type: 'text', value: value || '' });
      if (placeholder) { input.placeholder = placeholder; }
      input.value = value || '';
      input.addEventListener('change', function () { onCommit(input.value); });
      return input;
    }

    function checkbox(labelText, checked, onCommit) {
      var wrapper = ns.html('label', { 'class': 'field check' });
      var input = ns.html('input', { type: 'checkbox' }, wrapper);
      input.checked = !!checked;
      input.addEventListener('change', function () { onCommit(input.checked); });
      wrapper.appendChild(document.createTextNode(' ' + labelText));
      return wrapper;
    }

    function select(values, value, onCommit, labels) {
      var el = ns.html('select');
      values.forEach(function (v, i) {
        var option = ns.html('option', { value: v, text: labels ? labels[i] : v }, el);
        if (v === value) { option.selected = true; }
      });
      el.addEventListener('change', function () { onCommit(el.value); });
      return el;
    }

    function button(parent, text, onClick, cls) {
      var el = ns.html('button', { type: 'button', text: text,
                                   'class': 'tiny ' + (cls || '') }, parent);
      el.addEventListener('click', onClick);
      return el;
    }

    function subhead(parent, text) {
      var row = ns.html('div', { 'class': 'subhead' }, parent);
      ns.html('span', { text: text }, row);
      return row;
    }

    // --- edit plumbing -------------------------------------------------------

    // Always re-finds the target inside the mutation, because `apply` may be operating on
    // a document that undo replaced since the form was built.
    function editElement(elementId, label, mutate) {
      store.apply(label, function (doc) {
        var element = model.findElement(doc, elementId);
        if (!element) { return false; }
        return mutate(element, doc) !== false;
      });
      onChange();
    }

    function editRelationship(relationshipId, label, mutate) {
      store.apply(label, function (doc) {
        var rel = model.findRelationship(doc, relationshipId);
        if (!rel) { return false; }
        return mutate(rel, doc) !== false;
      });
      onChange();
    }

    function editNode(nodeId, label, mutate) {
      store.apply(label, function (doc) {
        var diagram = ns.diagram.findDiagram(doc, store.currentDiagramId);
        if (!diagram) { return false; }
        var node = ns.diagram.findNode(diagram, nodeId);
        if (!node) { return false; }
        return mutate(node, doc) !== false;
      });
      onChange();
    }

    // --- element forms -------------------------------------------------------

    function renderNameRow(parent, element) {
      var input = textInput(element.name, function (value) {
        editElement(element.id, 'rename', function (el) { el.name = value; });
      });
      field(parent, 'Name', input);
    }

    function renderStereotypes(parent, element) {
      var input = textInput((element.stereotypes || []).join(', '), function (value) {
        editElement(element.id, 'stereotypes', function (el) {
          el.stereotypes = value.split(',')
            .map(function (s) { return s.trim(); })
            .filter(Boolean);
        });
      }, 'entity, service');
      field(parent, 'Stereotypes', input);
    }

    function renderAttributes(parent, element) {
      var head = subhead(parent, 'Attributes');
      button(head, '+ Add', function () {
        editElement(element.id, 'add attribute', function (el) {
          el.attributes.push(model.createAttribute());
        });
      });

      if (!element.attributes.length) {
        ns.html('p', { 'class': 'empty', text: 'No attributes.' }, parent);
        return;
      }

      var list = ns.html('ul', { 'class': 'member-list' }, parent);

      element.attributes.forEach(function (attr, index) {
        var item = ns.html('li', { 'class': 'member' }, list);

        var row1 = ns.html('div', { 'class': 'row' }, item);
        row1.appendChild(select(model.VISIBILITIES, attr.visibility, function (v) {
          editElement(element.id, 'attribute visibility', function (el) {
            el.attributes[index].visibility = v;
          });
        }, ['+ public', '# protected', '- private', '~ package']));
        row1.appendChild(textInput(attr.name, function (v) {
          editElement(element.id, 'attribute name', function (el) {
            el.attributes[index].name = v;
          });
        }, 'name'));

        var row2 = ns.html('div', { 'class': 'row' }, item);
        row2.appendChild(textInput(attr.type, function (v) {
          editElement(element.id, 'attribute type', function (el) {
            el.attributes[index].type = v;
          });
        }, 'type'));
        row2.appendChild(multiplicityInput(attr.multiplicity, function (v) {
          editElement(element.id, 'attribute multiplicity', function (el) {
            el.attributes[index].multiplicity = v;
          });
        }));

        var row3 = ns.html('div', { 'class': 'row' }, item);
        row3.appendChild(textInput(attr.defaultValue, function (v) {
          editElement(element.id, 'attribute default', function (el) {
            el.attributes[index].defaultValue = v;
          });
        }, 'default'));

        var row4 = ns.html('div', { 'class': 'row' }, item);
        row4.appendChild(checkbox('static', attr.isStatic, function (v) {
          editElement(element.id, 'attribute static', function (el) {
            el.attributes[index].isStatic = v;
          });
        }));
        row4.appendChild(checkbox('derived', attr.isDerived, function (v) {
          editElement(element.id, 'attribute derived', function (el) {
            el.attributes[index].isDerived = v;
          });
        }));
        button(row4, 'Remove', function () {
          editElement(element.id, 'remove attribute', function (el) {
            el.attributes.splice(index, 1);
          });
        }, 'danger');
      });
    }

    // Rejects an unparseable multiplicity at the point of entry rather than letting the
    // validator silently discard it on the next save.
    function multiplicityInput(value, onCommit) {
      var input = ns.html('input', { type: 'text', placeholder: '1, 0..*, *' });
      input.value = value || '';
      input.addEventListener('change', function () {
        var text = input.value.trim();
        if (!model.isValidMultiplicity(text)) {
          input.value = value || '';
          input.title = 'Not a multiplicity. Use 1, 0..1, 0..*, 1..*, or *.';
          input.setAttribute('aria-invalid', 'true');
          return;
        }
        input.removeAttribute('aria-invalid');
        onCommit(text);
      });
      return input;
    }

    function renderOperations(parent, element) {
      var head = subhead(parent, 'Operations');
      button(head, '+ Add', function () {
        editElement(element.id, 'add operation', function (el) {
          el.operations.push(model.createOperation());
        });
      });

      if (!element.operations.length) {
        ns.html('p', { 'class': 'empty', text: 'No operations.' }, parent);
        return;
      }

      var list = ns.html('ul', { 'class': 'member-list' }, parent);

      element.operations.forEach(function (op, index) {
        var item = ns.html('li', { 'class': 'member' }, list);

        var row1 = ns.html('div', { 'class': 'row' }, item);
        row1.appendChild(select(model.VISIBILITIES, op.visibility, function (v) {
          editElement(element.id, 'operation visibility', function (el) {
            el.operations[index].visibility = v;
          });
        }, ['+ public', '# protected', '- private', '~ package']));
        row1.appendChild(textInput(op.name, function (v) {
          editElement(element.id, 'operation name', function (el) {
            el.operations[index].name = v;
          });
        }, 'name'));

        var row2 = ns.html('div', { 'class': 'row' }, item);
        row2.appendChild(textInput(op.returnType, function (v) {
          editElement(element.id, 'return type', function (el) {
            el.operations[index].returnType = v;
          });
        }, 'returns'));

        var params = ns.html('div', { 'class': 'params' }, item);
        var paramHead = ns.html('div', { 'class': 'row' }, params);
        ns.html('span', { text: 'Parameters', 'class': 'empty' }, paramHead);
        button(paramHead, '+', function () {
          editElement(element.id, 'add parameter', function (el) {
            el.operations[index].parameters.push(model.createParameter());
          });
        });

        op.parameters.forEach(function (param, pIndex) {
          var prow = ns.html('div', { 'class': 'row' }, params);
          prow.appendChild(textInput(param.name, function (v) {
            editElement(element.id, 'parameter name', function (el) {
              el.operations[index].parameters[pIndex].name = v;
            });
          }, 'name'));
          prow.appendChild(textInput(param.type, function (v) {
            editElement(element.id, 'parameter type', function (el) {
              el.operations[index].parameters[pIndex].type = v;
            });
          }, 'type'));
          prow.appendChild(select(['in', 'out', 'inout', 'return'], param.direction,
            function (v) {
              editElement(element.id, 'parameter direction', function (el) {
                el.operations[index].parameters[pIndex].direction = v;
              });
            }));
          button(prow, '×', function () {
            editElement(element.id, 'remove parameter', function (el) {
              el.operations[index].parameters.splice(pIndex, 1);
            });
          }, 'danger');
        });

        var row4 = ns.html('div', { 'class': 'row' }, item);
        row4.appendChild(checkbox('static', op.isStatic, function (v) {
          editElement(element.id, 'operation static', function (el) {
            el.operations[index].isStatic = v;
          });
        }));
        row4.appendChild(checkbox('abstract', op.isAbstract, function (v) {
          editElement(element.id, 'operation abstract', function (el) {
            el.operations[index].isAbstract = v;
          });
        }));
        button(row4, 'Remove', function () {
          editElement(element.id, 'remove operation', function (el) {
            el.operations.splice(index, 1);
          });
        }, 'danger');
      });
    }

    function renderLiterals(parent, element) {
      var head = subhead(parent, 'Literals');
      button(head, '+ Add', function () {
        editElement(element.id, 'add literal', function (el) {
          el.literals.push('LITERAL' + (el.literals.length + 1));
        });
      });

      if (!element.literals.length) {
        ns.html('p', { 'class': 'empty', text: 'No literals.' }, parent);
        return;
      }

      var list = ns.html('ul', { 'class': 'member-list' }, parent);
      element.literals.forEach(function (literal, index) {
        var item = ns.html('li', { 'class': 'member' }, list);
        var row = ns.html('div', { 'class': 'row' }, item);
        row.appendChild(textInput(literal, function (v) {
          editElement(element.id, 'literal', function (el) { el.literals[index] = v; });
        }));
        button(row, '×', function () {
          editElement(element.id, 'remove literal', function (el) {
            el.literals.splice(index, 1);
          });
        }, 'danger');
      });
    }

    function renderPackageContents(parent, element) {
      subhead(parent, 'Contains');
      var children = model.childrenOf(store.doc, element.id);
      if (!children.length) {
        ns.html('p', { 'class': 'empty',
                       text: 'Nothing yet. Drag elements inside this package.' }, parent);
        return;
      }
      var list = ns.html('ul', { 'class': 'member-list' }, parent);
      children.forEach(function (child) {
        var item = ns.html('li', { 'class': 'member' }, list);
        ns.html('span', { text: model.displayName(child) }, item);
      });
    }

    function renderComment(parent, element) {
      var area = ns.html('textarea', { rows: '4' });
      area.value = element.body || '';
      area.addEventListener('change', function () {
        editElement(element.id, 'edit note', function (el) { el.body = area.value; });
      });
      field(parent, 'Text', area);
    }

    function renderOwner(parent, element) {
      var packages = store.doc.model.elements.filter(function (el) {
        return el.kind === 'package' &&
               model.canOwn(store.doc, element.id, el.id);
      });

      var values = [''].concat(packages.map(function (p) { return p.id; }));
      var labels = ['(top level)'].concat(packages.map(function (p) {
        return p.name || '(unnamed package)';
      }));

      field(parent, 'Package', select(values, element.owner || '', function (v) {
        editElement(element.id, 'set package', function (el) { el.owner = v || null; });
      }, labels));
    }

    function renderNodeView(parent, element, node) {
      subhead(parent, 'On this diagram');

      var traits = model.traits(element.kind);

      if (traits.attributes) {
        parent.appendChild(checkbox('Show attributes', node.show.attributes, function (v) {
          editNode(node.id, 'show attributes', function (n) { n.show.attributes = v; });
        }));
      }
      if (traits.operations) {
        parent.appendChild(checkbox('Show operations', node.show.operations, function (v) {
          editNode(node.id, 'show operations', function (n) { n.show.operations = v; });
        }));
      }

      var geometry = ns.html('div', { 'class': 'row' }, parent);
      ns.html('span', { 'class': 'empty',
        text: Math.round(node.x) + ', ' + Math.round(node.y) +
              '  ·  ' + Math.round(node.w) + ' × ' + Math.round(node.h)
      }, geometry);

      var actions = ns.html('div', { 'class': 'row' }, parent);
      button(actions, 'Size to fit', function () {
        ns.commands.sizeToFit(store, [node.id]);
        onChange();
      });
      button(actions, 'Bring to front', function () {
        store.apply('bring to front', function (doc) {
          var diagram = ns.diagram.findDiagram(doc, store.currentDiagramId);
          ns.diagram.bringToFront(diagram, node.id);
          return true;
        });
        onChange();
      });
    }

    function renderElement(summary) {
      var element = summary.element;
      var node = summary.node;

      titleEl.textContent = element.kind + ': ' + model.displayName(element);

      if (element.kind === 'comment') {
        renderComment(container, element);
      } else {
        renderNameRow(container, element);

        if (model.traits(element.kind).abstractable) {
          container.appendChild(checkbox('Abstract', element.isAbstract, function (v) {
            editElement(element.id, 'abstract', function (el) { el.isAbstract = v; });
          }));
        }

        renderStereotypes(container, element);

        // Packages get an owner too — nesting is legal, and canOwn() already filters out
        // the choices that would make a cycle.
        renderOwner(container, element);

        var traits = model.traits(element.kind);
        if (traits.attributes) { renderAttributes(container, element); }
        if (traits.operations) { renderOperations(container, element); }
        if (traits.literals) { renderLiterals(container, element); }
        if (element.kind === 'package') { renderPackageContents(container, element); }
      }

      if (node) { renderNodeView(container, element, node); }

      renderDangerZone(container, [node ? node.id : null].filter(Boolean), []);
      renderId(container, element.id);
    }

    // --- relationship form ---------------------------------------------------

    function renderEnd(parent, rel, index, element) {
      var semantics = model.endSemantics(rel.kind);
      var end = rel.ends[index];

      subhead(parent, (index === 0 ? semantics.source : semantics.target) +
                      ': ' + model.displayName(element));

      if (!semantics.labelled) {
        return; // roles and multiplicities are meaningless on these kinds
      }

      field(parent, 'Role', textInput(end.role, function (v) {
        editRelationship(rel.id, 'role', function (r) { r.ends[index].role = v; });
      }));

      field(parent, 'Multiplicity', multiplicityInput(end.multiplicity, function (v) {
        editRelationship(rel.id, 'multiplicity', function (r) {
          r.ends[index].multiplicity = v;
        });
      }));

      field(parent, 'Visibility', select(model.VISIBILITIES, end.visibility, function (v) {
        editRelationship(rel.id, 'end visibility', function (r) {
          r.ends[index].visibility = v;
        });
      }, ['+ public', '# protected', '- private', '~ package']));

      parent.appendChild(checkbox('Navigable', end.navigable, function (v) {
        editRelationship(rel.id, 'navigable', function (r) {
          r.ends[index].navigable = v;
        });
      }));
    }

    function renderRelationship(summary) {
      var rel = summary.relationship;
      var edge = summary.edge;

      titleEl.textContent = rel.kind;

      var sourceElement = model.findElement(store.doc, rel.ends[0].ref);
      var targetElement = model.findElement(store.doc, rel.ends[1].ref);

      // Changing the kind keeps both ends in place. Switching to a kind that has no roles
      // or multiplicities leaves that data untouched in the file rather than deleting it,
      // so switching back does not lose anything.
      field(container, 'Kind', select(model.RELATIONSHIP_KINDS, rel.kind, function (v) {
        editRelationship(rel.id, 'relationship kind', function (r) { r.kind = v; });
      }));

      var nameInput = textInput(rel.name, function (v) {
        editRelationship(rel.id, 'relationship name', function (r) { r.name = v; });
      });
      field(container, 'Label', nameInput);

      var swapRow = ns.html('div', { 'class': 'row' }, container);
      button(swapRow, 'Swap direction', function () {
        editRelationship(rel.id, 'swap direction', function (r) { r.ends.reverse(); });
      });

      renderEnd(container, rel, 0, sourceElement);
      renderEnd(container, rel, 1, targetElement);

      if (edge && edge.waypoints.length) {
        subhead(container, 'Routing');
        var routeRow = ns.html('div', { 'class': 'row' }, container);
        ns.html('span', { 'class': 'empty',
                          text: edge.waypoints.length + ' bend point(s)' }, routeRow);
        button(routeRow, 'Straighten', function () {
          store.apply('straighten', function (doc) {
            var diagram = ns.diagram.findDiagram(doc, store.currentDiagramId);
            var target = ns.diagram.findEdge(diagram, edge.id);
            if (!target || !target.waypoints.length) { return false; }
            target.waypoints = [];
            return true;
          });
          onChange();
        });
      }

      renderDangerZone(container, [], edge ? [edge.id] : []);
      renderId(container, rel.id);
    }

    // --- shared sections -----------------------------------------------------

    function renderDangerZone(parent, nodeIds, edgeIds) {
      subhead(parent, 'Remove');
      var row = ns.html('div', { 'class': 'row' }, parent);

      button(row, 'From diagram', function () {
        ns.commands.removeFromDiagram(store, nodeIds, edgeIds);
        onChange();
      });

      button(row, 'From model', function () {
        ns.commands.deleteFromModel(store, nodeIds, edgeIds);
        onChange();
      }, 'danger');

      ns.html('p', { 'class': 'empty',
        text: 'Removing from the diagram keeps it in the model and on other diagrams.'
      }, parent);
    }

    function renderId(parent, id) {
      ns.html('p', { 'class': 'readonly-id', text: 'id: ' + id }, parent);
    }

    function renderMultiple(summary) {
      titleEl.textContent = (summary.nodeIds.length + summary.edgeIds.length) +
                            ' items selected';

      var row = ns.html('div', { 'class': 'row' }, container);
      button(row, 'Size to fit', function () {
        ns.commands.sizeToFit(store, summary.nodeIds);
        onChange();
      });

      renderDangerZone(container, summary.nodeIds, summary.edgeIds);
    }

    function renderNone() {
      titleEl.textContent = 'Nothing selected';
      ns.html('p', { 'class': 'empty',
        text: 'Pick a tool from the palette, or click something on the diagram.'
      }, container);

      var diagram = store.currentDiagram();
      if (!diagram) { return; }

      subhead(container, 'Model');
      ns.html('p', { 'class': 'empty',
        text: store.doc.model.elements.length + ' elements, ' +
              store.doc.model.relationships.length + ' relationships, ' +
              store.doc.diagrams.length + ' diagram(s).'
      }, container);

      // Elements that exist in the model but are not on this diagram. Without this there
      // is no way back to something you removed from a view.
      var missing = store.doc.model.elements.filter(function (el) {
        return !ns.diagram.nodeForElement(diagram, el.id);
      });

      if (!missing.length) { return; }

      subhead(container, 'Not on this diagram');
      var list = ns.html('ul', { 'class': 'member-list' }, container);
      missing.forEach(function (el) {
        var item = ns.html('li', { 'class': 'member' }, list);
        var row = ns.html('div', { 'class': 'row' }, item);
        ns.html('span', { text: model.displayName(el) }, row);
        button(row, 'Add', function () {
          ns.commands.showOnDiagram(store, el.id, 60, 60);
          onChange();
        });
      });
    }

    // --- entry point ---------------------------------------------------------

    function render(summary) {
      current = summary || { kind: 'none' };
      ns.clear(container);

      if (current.kind === 'element') {
        renderElement(current);
      } else if (current.kind === 'relationship') {
        renderRelationship(current);
      } else if (current.kind === 'multiple') {
        renderMultiple(current);
      } else {
        renderNone();
      }
    }

    return { render: render };
  }

  ns.panel = { create: create };
})(UMLOne);
