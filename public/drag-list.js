'use strict';

// Reordering a list by dragging a row's grip (≡) up or down, with the finger or the mouse
// (the event editor's Program; any list of rows). The grip is the handle: the row itself
// keeps its tap / long press, and a drag on the grip never scrolls the page (touch-action:
// none on it, styles.css). While dragging, the row follows the pointer and the others slide
// out of its way; near the top or bottom of the list's scrolling pane (.list-pane) the pane
// scrolls on its own. Letting go drops the row where it is; Escape (or a cancelled pointer)
// puts everything back. Nothing in the DOM changes during the drag: on the drop the page
// gets onDrop(from, to) and renders the new order itself.
//
//   DRAG_LIST.bind(grip, { list, index, onDrop })
//     list    the <ol>/<ul> whose direct children are the rows
//     index   () => the row's current index
//     onDrop  (from, to) => void, only when to !== from
//
// Classes while dragging: the list gets .is-reordering, the row .is-dragging, the body
// .is-dragging-list (no text selection).

(function () {
  const START_PX = 4; // a press that moves less is not a drag
  const EDGE_PX = 48; // this close to the pane's edge the pane scrolls
  const SCROLL_PX = 8; // per frame

  function bind(grip, { list, index, onDrop }) {
    let drag = null;

    function rowsOf() {
      return [...list.children];
    }

    // Everything the drag needs, measured once at the start (content coordinates: the
    // pane's scroll is added, so they stay right while the pane scrolls).
    function begin(event) {
      const rows = rowsOf();
      const from = index();
      const row = rows[from];
      if (!row) return null;
      const pane = list.closest('.list-pane');
      const scroll = pane ? pane.scrollTop : 0;
      const rects = rows.map((r) => { const b = r.getBoundingClientRect(); return { top: b.top + scroll, bottom: b.bottom + scroll, mid: (b.top + b.bottom) / 2 + scroll, height: b.height }; });
      const gap = rects.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 0;
      return { rows, from, to: from, row, pane, rects, gap, startY: event.clientY, startScroll: scroll, lastY: event.clientY, started: false, raf: 0 };
    }

    function update() {
      const d = drag;
      const scroll = d.pane ? d.pane.scrollTop : 0;
      const offset = (d.lastY - d.startY) + (scroll - d.startScroll);
      if (!d.started) {
        if (Math.abs(offset) < START_PX) return;
        d.started = true;
        d.row.classList.add('is-dragging');
        list.classList.add('is-reordering');
        document.body.classList.add('is-dragging-list');
      }
      d.row.style.transform = `translateY(${offset}px)`;
      const mid = d.rects[d.from].mid + offset;
      let to = 0;
      d.rects.forEach((r, i) => { if (i !== d.from && r.mid < mid) to += 1; });
      d.to = to;
      const shift = d.rects[d.from].height + d.gap;
      d.rows.forEach((r, i) => {
        if (i === d.from) return;
        let y = 0;
        if (d.from < to && i > d.from && i <= to) y = -shift;
        else if (to < d.from && i >= to && i < d.from) y = shift;
        r.style.transform = y ? `translateY(${y}px)` : '';
      });
    }

    // The pane scrolls while the pointer stays near its edge.
    function autoScroll() {
      const d = drag;
      if (!d || !d.started || !d.pane) return;
      const box = d.pane.getBoundingClientRect();
      let step = 0;
      if (d.lastY < box.top + EDGE_PX) step = -SCROLL_PX;
      else if (d.lastY > box.bottom - EDGE_PX) step = SCROLL_PX;
      if (step) {
        const before = d.pane.scrollTop;
        d.pane.scrollTop = before + step;
        if (d.pane.scrollTop !== before) update();
      }
      d.raf = requestAnimationFrame(autoScroll);
    }

    function end(drop) {
      const d = drag;
      if (!d) return;
      drag = null;
      cancelAnimationFrame(d.raf);
      window.removeEventListener('keydown', onKey, true);
      d.rows.forEach((r) => { r.style.transform = ''; });
      d.row.classList.remove('is-dragging');
      list.classList.remove('is-reordering');
      document.body.classList.remove('is-dragging-list');
      if (drop && d.started && d.to !== d.from) onDrop(d.from, d.to);
    }

    function onKey(event) {
      if (event.key === 'Escape') { event.preventDefault(); end(false); }
    }

    grip.addEventListener('pointerdown', (event) => {
      if (drag || (event.pointerType === 'mouse' && event.button !== 0)) return;
      drag = begin(event);
      if (!drag) return;
      event.preventDefault();
      grip.setPointerCapture(event.pointerId);
      window.addEventListener('keydown', onKey, true);
      drag.raf = requestAnimationFrame(autoScroll);
    });
    grip.addEventListener('pointermove', (event) => {
      if (!drag) return;
      drag.lastY = event.clientY;
      update();
    });
    grip.addEventListener('pointerup', () => end(true));
    grip.addEventListener('pointercancel', () => end(false));
    grip.addEventListener('lostpointercapture', () => end(false));
  }

  window.DRAG_LIST = { bind };
})();
