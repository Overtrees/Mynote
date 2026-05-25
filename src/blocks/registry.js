(function (w) {
  'use strict';
  var R = React;
  var BlockSystem = {
    types: {},
    register: function (type, config) {
      this.types[type] = Object.assign({ type: type }, config);
    },
    get: function (type) {
      return this.types[type];
    },
    render: function (node, ctx) {
      var cfg = this.types[node.type];
      if (!cfg) return null;
      if (cfg.isAtomic) {
        var attrs = { key: node.id, 'data-blockid': node.id, 'data-type': node.type, contentEditable: false };
        if (node.type === 'attachment' || node.type === 'image' || node.type === 'imgTextCard' || node.type === 'imageTextRow') {
          if (node.fileId) attrs['data-fileid'] = node.fileId;
        }
        if (node.type === 'link-card' || node.type === 'embedCard' || node.type === 'musicCard') {
          if (node.url) attrs['data-url'] = node.url;
        }
        attrs.style = { userSelect: 'none', margin: node.type === 'attachment' ? '8px 0' : '0' };
        return R.createElement('div', attrs, cfg.render ? cfg.render(node, ctx) : null);
      }
      return cfg.render(node, ctx);
    },
    renderDoc: function (doc, ctx) {
      return doc.map(function (n) { return this.render(n, ctx); }.bind(this));
    }
  };
  w.BlockSystem = BlockSystem;
})(window);
