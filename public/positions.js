'use strict';

// Worship positions over a setlist. Shared by the server (lib/live.js) and the pages, so a
// page moving the projector without the server (emergency mode) steps exactly as the
// server would.
//
// A position is { itemId, step }. A layout is the setlist as [{ id, steps }]: a song has
// one step per entry of its arrangement WITH repeats (V1 C V2 C B C -> 6); every other
// item (and a song deleted from the library) has exactly one step.

(function (root) {
  const NO_POSITION = Object.freeze({ itemId: null, step: 0 });

  // A song also lists the section of each step (sections), so a re-arranged song keeps the
  // position on the same section (clampPosition).
  function layoutOf(items) {
    return items.map((item) => {
      const song = item.type === 'song' && item.songId && Array.isArray(item.arrangementResolved);
      const out = { id: item.id, steps: song ? Math.max(1, item.arrangementResolved.length) : 1 };
      if (song && item.arrangementResolved.every((a) => a.sectionId !== undefined)) out.sections = item.arrangementResolved.map((a) => a.sectionId);
      return out;
    });
  }

  // The step of the new arrangement showing the same section as `step` did (the nearest
  // occurrence), or -1 when that section is no longer in it.
  function sameSectionStep(oldItem, newItem, step) {
    if (!oldItem || !oldItem.sections || !newItem.sections) return -1;
    const section = oldItem.sections[step];
    let best = -1;
    newItem.sections.forEach((id, i) => {
      if (id === section && (best < 0 || Math.abs(i - step) < Math.abs(best - step))) best = i;
    });
    return best;
  }

  function firstPosition(layout) {
    return layout.length ? { itemId: layout[0].id, step: 0 } : { ...NO_POSITION };
  }

  function indexOf(layout, pos) {
    return pos && pos.itemId !== null ? layout.findIndex((it) => it.id === pos.itemId) : -1;
  }

  function samePosition(a, b) {
    return a.itemId === b.itemId && a.step === b.step;
  }

  // Next step, else the next item's first step; stays put at the end.
  function nextPosition(layout, pos) {
    const i = indexOf(layout, pos);
    if (i < 0) return firstPosition(layout);
    if (pos.step + 1 < layout[i].steps) return { itemId: pos.itemId, step: pos.step + 1 };
    if (i + 1 < layout.length) return { itemId: layout[i + 1].id, step: 0 };
    return { itemId: pos.itemId, step: pos.step };
  }

  // Previous step, else the previous item's last step; stays put at the start.
  function prevPosition(layout, pos) {
    const i = indexOf(layout, pos);
    if (i < 0) return firstPosition(layout);
    if (pos.step > 0) return { itemId: pos.itemId, step: pos.step - 1 };
    if (i > 0) return { itemId: layout[i - 1].id, step: layout[i - 1].steps - 1 };
    return { itemId: pos.itemId, step: pos.step };
  }

  // A valid position in the layout, or null.
  function gotoPosition(layout, itemId, step) {
    const item = layout.find((it) => it.id === itemId);
    if (!item || !Number.isInteger(step) || step < 0 || step >= item.steps) return null;
    return { itemId, step };
  }

  // After the setlist or a song changed: the same item if it still exists (step clamped to
  // its new step count), else the nearest following item that still exists, else the last
  // item; no position when the setlist is empty.
  function clampPosition(oldLayout, newLayout, pos) {
    if (!newLayout.length) return { ...NO_POSITION };
    if (!pos || pos.itemId === null) return firstPosition(newLayout);
    const same = newLayout.find((it) => it.id === pos.itemId);
    if (same) {
      const kept = sameSectionStep(oldLayout.find((it) => it.id === pos.itemId), same, pos.step);
      return { itemId: same.id, step: kept >= 0 ? kept : Math.min(Math.max(pos.step, 0), same.steps - 1) };
    }
    const old = indexOf(oldLayout, pos);
    if (old >= 0) {
      for (const candidate of oldLayout.slice(old + 1)) {
        if (newLayout.some((it) => it.id === candidate.id)) return { itemId: candidate.id, step: 0 };
      }
    }
    return { itemId: newLayout[newLayout.length - 1].id, step: 0 };
  }

  const POSITIONS = { NO_POSITION, layoutOf, firstPosition, samePosition, nextPosition, prevPosition, gotoPosition, clampPosition };

  if (typeof module === 'object' && module.exports) module.exports = POSITIONS;
  else root.POSITIONS = POSITIONS;
})(typeof window !== 'undefined' ? window : this);
