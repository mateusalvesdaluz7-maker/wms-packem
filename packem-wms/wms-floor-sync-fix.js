(function () {
  'use strict';

  function clearState(getState) {
    var state = typeof getState === 'function' ? getState() : null;
    if (!state || typeof state !== 'object') return;
    Object.keys(state).forEach(function (key) { delete state[key]; });
  }

  function replaceEmptyCloudState(pullName, getName) {
    var original = window[pullName];
    if (typeof original !== 'function' || original.__floorSyncFixed) return;

    function fixedPull(rows, readErr) {
      // Uma consulta bem-sucedida sem linhas representa uma limpeza feita em outro aparelho.
      // Apaga primeiro o objeto mantido em memória; a função original salva e redesenha a tela.
      if (!readErr && Array.isArray(rows) && rows.length === 0) {
        clearState(window[getName]);
      }
      return original.apply(this, arguments);
    }

    fixedPull.__floorSyncFixed = true;
    window[pullName] = fixedPull;
  }

  replaceEmptyCloudState('floorPullCloud', 'floorGetState');
  replaceEmptyCloudState('floor70PullCloud', 'floor70GetState');
})();

