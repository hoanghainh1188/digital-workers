// Prototype state switcher for design screens. Not product code.
// Radios in .proto-bar (name = dimension, value = state) drive elements marked
// data-show="dimension:value1,value2". The choice is mirrored in the URL query
// (?state=empty&role=manager) so a link opens the screen in that state.
(() => {
  const bar = document.querySelector('.proto-bar');
  if (!bar) return;
  const params = new URLSearchParams(location.search);

  for (const name of new Set([...bar.querySelectorAll('input[type=radio]')].map((r) => r.name))) {
    const wanted = params.get(name);
    const radio = wanted && bar.querySelector(`input[name="${name}"][value="${CSS.escape(wanted)}"]`);
    if (radio) radio.checked = true;
  }

  const current = () =>
    Object.fromEntries([...bar.querySelectorAll('input[type=radio]:checked')].map((r) => [r.name, r.value]));

  const apply = () => {
    const state = current();
    for (const el of document.querySelectorAll('[data-show]')) {
      el.hidden = !el.dataset.show.split(/\s+/).every((rule) => {
        const [name, values] = rule.split(':');
        return values.split(',').includes(state[name]);
      });
    }
    for (const [name, value] of Object.entries(state)) document.body.dataset[name] = value;
    const next = new URLSearchParams(state);
    history.replaceState(null, '', `${location.pathname}?${next}`);
  };

  bar.addEventListener('change', apply);
  apply();
})();
