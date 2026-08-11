// UMLOne — shared namespace, ids, cloning, events.
//
// Every source file is an IIFE that hangs one property off this global. There are no ES
// modules here on purpose: browsers refuse module loads over file://, and the whole
// editor has to run by double-clicking index.html. Script order in index.html is the
// dependency graph.

var UMLOne = UMLOne || {};

(function (ns) {
  'use strict';

  // crypto.randomUUID needs a secure context. file:// counts as one in current Chrome and
  // Firefox, but not everywhere and not in older builds, so there is a real fallback
  // rather than a throw. Ids only need to be unique within a document.
  var idCounter = 0;

  function uid(prefix) {
    idCounter += 1;
    var unique;
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      unique = crypto.randomUUID().slice(0, 8);
    } else {
      unique = Math.random().toString(36).slice(2, 10);
    }
    return (prefix || 'x') + '_' + idCounter.toString(36) + unique;
  }

  // Snapshot clone. Used by the undo stack and by validation normalization, so it must not
  // preserve references into live state.
  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function assert(condition, message) {
    if (!condition) {
      throw new Error('UMLOne: ' + (message || 'assertion failed'));
    }
  }

  // Minimal pub/sub. The app has a handful of channels ('change', 'selection', ...) and
  // no need for anything with wildcards or priorities.
  function Emitter() {
    this._handlers = {};
  }

  Emitter.prototype.on = function (name, handler) {
    if (!this._handlers[name]) {
      this._handlers[name] = [];
    }
    this._handlers[name].push(handler);
    return this;
  };

  Emitter.prototype.off = function (name, handler) {
    var list = this._handlers[name];
    if (!list) {
      return this;
    }
    var index = list.indexOf(handler);
    if (index >= 0) {
      list.splice(index, 1);
    }
    return this;
  };

  Emitter.prototype.emit = function (name, payload) {
    var list = this._handlers[name];
    if (!list) {
      return this;
    }
    // Copy first: handlers are allowed to unsubscribe themselves while firing.
    list.slice().forEach(function (handler) {
      handler(payload);
    });
    return this;
  };

  // --- small DOM helpers -----------------------------------------------------

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svg(tag, attrs, parent) {
    var el = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (attrs[key] !== null && attrs[key] !== undefined) {
          el.setAttribute(key, String(attrs[key]));
        }
      });
    }
    if (parent) {
      parent.appendChild(el);
    }
    return el;
  }

  function html(tag, attrs, parent) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === 'text') {
          el.textContent = attrs[key];
        } else if (key === 'class') {
          el.className = attrs[key];
        } else if (attrs[key] !== null && attrs[key] !== undefined) {
          el.setAttribute(key, String(attrs[key]));
        }
      });
    }
    if (parent) {
      parent.appendChild(el);
    }
    return el;
  }

  function clear(el) {
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
    return el;
  }

  ns.SVG_NS = SVG_NS;
  ns.uid = uid;
  ns.clone = clone;
  ns.isObject = isObject;
  ns.assert = assert;
  ns.Emitter = Emitter;
  ns.svg = svg;
  ns.html = html;
  ns.clear = clear;
})(UMLOne);
