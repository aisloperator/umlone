// UMLOne — a test harness in about a hundred lines.
//
// There is no test runner to install, so this is it: register cases with `T.test`, open
// tests.html, read the results. Cases run in the real browser against the real DOM, which
// is the only place text measurement and SVG geometry are meaningful anyway.

var T = (function () {
  'use strict';

  var cases = [];
  var currentGroup = 'ungrouped';

  function group(name) {
    currentGroup = name;
  }

  function test(name, fn) {
    cases.push({ group: currentGroup, name: name, fn: fn });
  }

  function AssertionError(message) {
    this.name = 'AssertionError';
    this.message = message;
  }
  AssertionError.prototype = Object.create(Error.prototype);

  function fail(message) {
    throw new AssertionError(message);
  }

  function show(value) {
    if (typeof value === 'string') { return JSON.stringify(value); }
    if (value === undefined) { return 'undefined'; }
    try {
      var text = JSON.stringify(value);
      return text && text.length > 200 ? text.slice(0, 200) + '…' : String(text);
    } catch (e) {
      return String(value);
    }
  }

  function ok(value, message) {
    if (!value) { fail((message || 'expected truthy') + ', got ' + show(value)); }
  }

  function eq(actual, expected, message) {
    if (actual !== expected) {
      fail((message || 'not equal') + '\n  expected: ' + show(expected) +
           '\n  actual:   ' + show(actual));
    }
  }

  function deepEq(actual, expected, message) {
    var a = JSON.stringify(actual);
    var b = JSON.stringify(expected);
    if (a !== b) {
      fail((message || 'not deeply equal') + '\n  expected: ' + show(expected) +
           '\n  actual:   ' + show(actual));
    }
  }

  function near(actual, expected, tolerance, message) {
    var limit = tolerance === undefined ? 0.001 : tolerance;
    if (!isFinite(actual) || Math.abs(actual - expected) > limit) {
      fail((message || 'not near') + '\n  expected: ' + expected + ' ±' + limit +
           '\n  actual:   ' + actual);
    }
  }

  function includes(haystack, needle, message) {
    var found = haystack.some(function (item) {
      return String(item).indexOf(needle) >= 0;
    });
    if (!found) {
      fail((message || 'no entry contains ' + show(needle)) + '\n  in: ' + show(haystack));
    }
  }

  function throws(fn, message) {
    var threw = false;
    try { fn(); } catch (e) { threw = true; }
    if (!threw) { fail(message || 'expected the call to throw'); }
  }

  function run(output) {
    var passed = 0;
    var failed = 0;
    var byGroup = {};
    var order = [];

    cases.forEach(function (item) {
      if (!byGroup[item.group]) {
        byGroup[item.group] = [];
        order.push(item.group);
      }

      var result = { name: item.name, ok: true, message: '' };
      try {
        item.fn();
        passed++;
      } catch (e) {
        result.ok = false;
        result.message = (e && e.message) || String(e);
        if (e && e.stack && e.name !== 'AssertionError') {
          result.message += '\n' + e.stack;
        }
        failed++;
      }
      byGroup[item.group].push(result);
    });

    renderResults(output, order, byGroup, passed, failed);
    return { passed: passed, failed: failed };
  }

  function renderResults(output, order, byGroup, passed, failed) {
    output.innerHTML = '';

    var summary = document.createElement('div');
    summary.className = 'summary ' + (failed ? 'bad' : 'good');
    summary.textContent = failed
      ? failed + ' failed, ' + passed + ' passed'
      : 'all ' + passed + ' tests passed';
    output.appendChild(summary);

    order.forEach(function (groupName) {
      var section = document.createElement('section');
      var heading = document.createElement('h2');
      heading.textContent = groupName;
      section.appendChild(heading);

      var list = document.createElement('ul');
      byGroup[groupName].forEach(function (result) {
        var item = document.createElement('li');
        item.className = result.ok ? 'pass' : 'fail';
        var title = document.createElement('span');
        title.textContent = (result.ok ? '✓ ' : '✗ ') + result.name;
        item.appendChild(title);
        if (!result.ok) {
          var pre = document.createElement('pre');
          pre.textContent = result.message;
          item.appendChild(pre);
        }
        list.appendChild(item);
      });

      section.appendChild(list);
      output.appendChild(section);
    });
  }

  return {
    group: group,
    test: test,
    ok: ok,
    eq: eq,
    deepEq: deepEq,
    near: near,
    includes: includes,
    throws: throws,
    fail: fail,
    run: run
  };
})();
