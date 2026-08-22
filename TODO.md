# TODO

Ordered by what blocks what. Nothing below is in progress.

## Blocked on a browser

Everything in this repo was written without ever being run: this machine has python3
and no JavaScript engine, so every claim about behaviour is reasoned from the code and
the specs, not observed. That makes the first item the one that gates all the others.

- [ ] **Open `tests.html`.** 197 tests, none of which have ever been executed. Expect all
      green; a failure here is as likely to be a bad test as a bad implementation.
- [ ] **Open `index.html` from `file://`** in both Chrome and Firefox. Empty canvas,
      clean console. If it needs a server, the whole no-build-tooling premise is broken.
- [ ] **Open `samples/example.uml.json`, press Fit.** 9 elements, 8 relationships,
      2 diagrams — every v1 feature appears somewhere in it.
- [ ] **Round-trip by hand.** Open the sample, press Download, diff the two files. Zero
      bytes of difference is the promise; canonical key order and the `.gitattributes`
      `eol=lf` pin exist to keep it.
- [ ] **Exercise the `crypto.randomUUID` fallback**, rather than trusting that it is
      present. `file://` is a secure context in current Chrome and Firefox, so the
      fallback path may never run in normal use — force it once.

## Confirm the two rendering fixes

Both were reasoned from the SVG spec and pixel arithmetic. Neither has been looked at.

- [ ] **Borders draw at full width** now that the node clip no longer shaves off their
      outer half (`5eee7a8`).
- [ ] **Fit, then 1:1, leaves a box looking exactly as it did when placed** (`d8e82ee`).
      This was the reported bug.
- [ ] **If lines are still uneven**, note the display scaling — Windows at 125%/150%, a
      fractionally scaled desktop, or browser page zoom off 100%. Under fractional
      scaling no viewport offset can make every line crisp, and the fix moves into the
      drawing instead: `shape-rendering` on the axis-aligned strokes, or
      `vector-effect: non-scaling-stroke`. Both need care so borders do not vanish at
      minimum zoom.

## Full editing pass

The plan's own acceptance run, never performed end to end:

- [ ] Create classes, draw one relationship of each of the seven kinds, set roles and
      multiplicities, move and resize, put one class on two diagrams, undo everything,
      download, reopen the download, and confirm it matches what was on screen.

## Judgment calls left open

Small, and each is a preference rather than a defect. Listed because they were raised
and never settled.

- [ ] **Insertion strips still use `cursor: cell`** while member rows now use the default
      pointer. Deliberate — the strips are a different target — but it may read as
      inconsistent in practice.
- [ ] **The strip below the last member is about a row tall.** It was capped there
      because covering all the slack in a tall box made empty space light up on hover and
      read as a member that was already present. If it feels fiddly to hit, the honest
      fix is a visible affordance (a faint `+`, a dotted line) rather than a larger
      invisible target.
- [ ] **The `1:1` button's label.** Chosen over `100%` because the readout an inch away
      already says that. `Actual` is the other candidate. One line in `index.html`.

## Not started, and not needed yet

- [ ] Export to XMI or PlantUML. The JSON format was designed so a converter can be
      bolted on without touching the internals; nothing in the editor assumes it exists.
- [ ] Export to SVG or PNG as an image, which is a different job from the format above
      and probably wanted sooner.
- [ ] Orthogonal edge routing and overlap avoidance. Edges are straight polylines through
      user-placed bends.
- [ ] Automatic layout. Positions are always the user's, which is the right default for a
      class diagram but leaves nothing to do with an imported model.
- [ ] Incremental rendering. Every change redraws the whole diagram, which is correct and
      fast enough at class-diagram sizes and would not be at thousands of elements.

## Housekeeping

- [ ] **Check whether `github.com/aisloperator/umlone` is public or private.** It was
      created outside this session, so its visibility has never been confirmed from here.
      If it was created public, everything pushed is already visible to anyone.
