(function (w) {
  w.MynoteId = {
    genId: function () {
      return Math.random().toString(36).slice(2, 10);
    }
  };
})(window);
