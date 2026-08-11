(function (ns) {
  'use strict';

  T.group('member parsing');

  var model = ns.model;

  // The property that matters: what the diagram draws is exactly what the editor shows,
  // so parsing the drawn string must reproduce the member.
  function roundTripsAttribute(text) {
    T.eq(model.formatAttribute(model.parseAttribute(text, null)), text,
         'attribute did not survive a round trip');
  }

  function roundTripsOperation(text) {
    T.eq(model.formatOperation(model.parseOperation(text, null)), text,
         'operation did not survive a round trip');
  }

  T.test('attribute round trips through format and parse', function () {
    [
      '- total: Money',
      '+ name: String',
      '# count: int',
      '~ flag: bool',
      '- /total: Money',
      '- items: String [0..*]',
      '- retries: int = 3',
      '- /subtotal: Money [1..*] = 0',
      '- bare',
      '+ lookup: Map<String, Integer>'
    ].forEach(roundTripsAttribute);
  });

  T.test('operation round trips through format and parse', function () {
    [
      '+ recalculate(): void',
      '+ recalculate(policy: TaxPolicy): void',
      '- helper()',
      '# move(dx: int, dy: int): Point',
      '+ move(dx: int, out ok: bool): void',
      '+ apply(f: Map<String, Integer>): void',
      '+ bare()',
      '~ visit(inout state: State): void'
    ].forEach(roundTripsOperation);
  });

  T.test('attribute parts are pulled out individually', function () {
    var attr = model.parseAttribute('- /total: Money [0..*] = 0', null);
    T.eq(attr.visibility, 'private');
    T.eq(attr.isDerived, true);
    T.eq(attr.name, 'total');
    T.eq(attr.type, 'Money');
    T.eq(attr.multiplicity, '0..*');
    T.eq(attr.defaultValue, '0');
  });

  T.test('operation parts are pulled out individually', function () {
    var op = model.parseOperation('# move(dx: int, out ok: bool): Point', null);
    T.eq(op.visibility, 'protected');
    T.eq(op.name, 'move');
    T.eq(op.returnType, 'Point');
    T.eq(op.parameters.length, 2);
    T.eq(op.parameters[0].name, 'dx');
    T.eq(op.parameters[0].type, 'int');
    T.eq(op.parameters[0].direction, 'in');
    T.eq(op.parameters[1].direction, 'out');
    T.eq(op.parameters[1].name, 'ok');
  });

  T.test('a generic type is not split on its comma', function () {
    var op = model.parseOperation('+ merge(a: Map<String, Integer>, b: int): void', null);
    T.eq(op.parameters.length, 2, 'the comma inside <> is part of the type');
    T.eq(op.parameters[0].type, 'Map<String, Integer>');
    T.eq(op.parameters[1].name, 'b');
  });

  T.test('text with no visibility marker keeps the previous visibility', function () {
    var existing = model.createAttribute({ visibility: 'protected' });
    var attr = model.parseAttribute('total: Money', existing);
    T.eq(attr.visibility, 'protected', 'unstated visibility should not be reset');
  });

  T.test('static and abstract survive editing, since the text cannot express them', function () {
    var attr = model.parseAttribute('- count: int',
      model.createAttribute({ isStatic: true }));
    T.eq(attr.isStatic, true, 'static is drawn as an underline, not as text');

    var op = model.parseOperation('+ render(): void',
      model.createOperation({ isAbstract: true, isStatic: true }));
    T.eq(op.isAbstract, true, 'abstract is drawn as italic, not as text');
    T.eq(op.isStatic, true);
  });

  T.test('the id is preserved so edits do not replace the member', function () {
    var existing = model.createAttribute({ id: 'keep-me' });
    T.eq(model.parseAttribute('- x: int', existing).id, 'keep-me');

    var op = model.createOperation({ id: 'also-keep' });
    T.eq(model.parseOperation('+ f()', op).id, 'also-keep');
  });

  T.test('nonsense is kept as the name rather than thrown away', function () {
    var attr = model.parseAttribute('!!! whatever ???', null);
    T.eq(attr.name, '!!! whatever ???', 'typed text must never be silently lost');
  });

  T.test('an unparseable multiplicity stays part of the type', function () {
    // "[]" is an array marker, not a UML multiplicity, so it belongs to the type.
    var attr = model.parseAttribute('- names: String[]', null);
    T.eq(attr.multiplicity, '');
    T.eq(attr.type, 'String[]');
  });

  T.test('an operation without parentheses is still an operation', function () {
    var op = model.parseOperation('+ halfTyped', null);
    T.eq(op.name, 'halfTyped');
    T.deepEq(op.parameters, []);
  });

  T.test('empty parentheses give no parameters, not one blank one', function () {
    T.deepEq(model.parseOperation('+ f()', null).parameters, []);
    T.deepEq(model.parseOperation('+ f(   )', null).parameters, []);
  });

  T.test('surrounding whitespace is ignored', function () {
    var attr = model.parseAttribute('   -   total :  Money   ', null);
    T.eq(attr.name, 'total');
    T.eq(attr.type, 'Money');
  });

  T.test('blank members are recognised so a new row starts empty', function () {
    T.ok(model.isBlankAttribute(model.createAttribute({ name: '', type: '' })));
    T.ok(!model.isBlankAttribute(model.createAttribute({ name: 'x' })));
    T.ok(model.isBlankOperation(model.createOperation({ name: '' })));
    T.ok(!model.isBlankOperation(model.createOperation({ name: 'f' })));
  });

  T.test('splitTopLevel respects nesting and drops empties', function () {
    T.deepEq(model.splitTopLevel('a, b, c', ','), ['a', 'b', 'c']);
    T.deepEq(model.splitTopLevel('a<x, y>, b', ','), ['a<x, y>', 'b']);
    T.deepEq(model.splitTopLevel('f(1, 2), g', ','), ['f(1, 2)', 'g']);
    T.deepEq(model.splitTopLevel('', ','), []);
    T.deepEq(model.splitTopLevel('a, , b', ','), ['a', 'b']);
  });
})(UMLOne);
