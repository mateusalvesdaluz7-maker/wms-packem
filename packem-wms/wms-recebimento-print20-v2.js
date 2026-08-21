(function () {
  'use strict';

  if (window.__wmsRecebimentoPrint20V2) return;
  window.__wmsRecebimentoPrint20V2 = true;

  var BATCH_SIZE = 20;
  var nextBatch = 0;

  function pendingItems() {
    try {
      return (typeof STAGE !== 'undefined' && Array.isArray(STAGE)) ? STAGE.slice() : [];
    } catch (e) {
      return [];
    }
  }

  function batchInfo(total) {
    var pages = Math.max(1, Math.ceil(total / BATCH_SIZE));
    if (nextBatch >= pages) nextBatch = 0;
    var start = nextBatch * BATCH_SIZE;
    var end = Math.min(start + BATCH_SIZE, total);
    return { pages: pages, start: start, end: end };
  }

  function buttonText(total) {
    if (!total) return 'Imprimir etiquetas pendentes';
    var info = batchInfo(total);
    return 'Imprimir etiquetas ' + (info.start + 1) + '–' + info.end + ' de ' + total;
  }

  function updateButton() {
    var btn = document.getElementById('recvPrintBatch20V2');
    if (btn) btn.textContent = buttonText(pendingItems().length);
  }

  function labelFromStage(item) {
    var et = (typeof norm === 'function') ? norm(item && item.et) : String((item && item.et) || '').trim();
    var stored = {};
    try {
      stored = (typeof BOB !== 'undefined' && BOB && BOB[et]) ? BOB[et] : {};
    } catch (e) {}

    var product = stored.pr || item.pr || '';
    var description = stored.desc || item.desc || '';
    try {
      if (typeof convDescByCod === 'function') description = convDescByCod(product) || description;
    } catch (e) {}

    var source = {
      et: et,
      pr: product,
      desc: description,
      pl: stored.pl != null ? stored.pl : item.pl
    };

    if (typeof _intakeToRast === 'function') return _intakeToRast(source);
    return {
      id: source.et,
      cProd: source.pr,
      xProd: source.desc,
      kg: Number(source.pl) || 0,
      bobina: source.et,
      nf: '__vaga__'
    };
  }

  function printCurrentBatch() {
    try {
      if (typeof isAdmin === 'function' && !isAdmin()) {
        if (typeof toast === 'function') toast('Somente usuários autorizados podem imprimir etiquetas', false);
        return;
      }

      var all = pendingItems();
      if (!all.length) {
        if (typeof toast === 'function') toast('Não há etiquetas pendentes no recebimento', false);
        return;
      }

      var info = batchInfo(all.length);
      var labels = all.slice(info.start, info.end).map(labelFromStage).filter(function (label) {
        return label && label.id;
      });

      if (!labels.length) {
        if (typeof toast === 'function') toast('Nenhuma etiqueta válida neste lote', false);
        return;
      }

      var format = (typeof expLabelFmt === 'function')
        ? expLabelFmt()
        : { dim: { w: 100, h: 100 }, orient: 'retrato' };

      if (typeof printZebraRast !== 'function') throw new Error('Função de impressão indisponível');

      printZebraRast(
        labels,
        format.dim,
        format.orient === 'paisagem' ? 'paisagem' : 'retrato'
      );

      if (typeof toast === 'function') {
        toast('Etiquetas ' + (info.start + 1) + '–' + info.end + ' preparadas para impressão');
      }

      nextBatch = (nextBatch + 1) % info.pages;
      updateButton();
    } catch (error) {
      console.error('Impressão em lote do recebimento:', error);
      if (typeof toast === 'function') toast('Não foi possível preparar as etiquetas', false);
    }
  }

  function addButton() {
    var backfill = document.getElementById('recvBf70');
    if (!backfill || !backfill.parentElement) return;

    var btn = document.getElementById('recvPrintBatch20V2');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'recvPrintBatch20V2';
      btn.className = 'btn brand';
      btn.style.cssText = 'font-size:.76rem;padding:9px 13px';
      btn.addEventListener('click', printCurrentBatch);
      backfill.parentElement.insertBefore(btn, backfill);
    }
    updateButton();
  }

  if (typeof renderRecv === 'function') {
    var originalRenderRecv = renderRecv;
    renderRecv = function () {
      var result = originalRenderRecv.apply(this, arguments);
      setTimeout(addButton, 0);
      return result;
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(addButton, 0);
    }, { once: true });
  } else {
    setTimeout(addButton, 0);
  }
})();