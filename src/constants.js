(function (w) {
  var APP_CONFIG = w.__APP_CONFIG__ || {};
  var C = {
    // 版本号唯一来源：package.json 必须与此一致（tools/verify.mjs 会校验）
    APP_VERSION: '2.2.3',
    API_BASE: APP_CONFIG.API_BASE || 'https://mynote.overtrees.workers.dev',
    URL_REGEX: /^https?:\/\/(www\.)?[-\u4e00-\u9fa5a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-\u4e00-\u9fa5a-zA-Z0-9()@:%_+.~#?&\/=]*)$/i,
    URL_INLINE_REGEX: /https?:\/\/[-\u4e00-\u9fa5a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b[-\u4e00-\u9fa5a-zA-Z0-9()@:%_+.~#?&\/=]*/i,
    NEW_CARD_ID: '__new_memo_card__',
    GOOGLE_CLIENT_ID: APP_CONFIG.GOOGLE_CLIENT_ID || '993589743002-6o74a8e7d5jck2g55rag7me7q60ogehr.apps.googleusercontent.com',
    QWEATHER_API_KEY: APP_CONFIG.QWEATHER_API_KEY || '',
    BACKUP_FILE_NAME: 'memories_backup.zip'
    // 旧版本用的是 .json 后缀（内容其实是 zip），读取时做兼容
  };

  C.isUrl = function (str) {
    return C.URL_REGEX.test(String(str || '').trim());
  };

  C.extractUrlFromText = function (str) {
    var match = String(str || '').match(C.URL_INLINE_REGEX);
    return match ? match[0] : null;
  };

  C.getTypeIcon = function (type) {
    if (type === 'music') return '🎵';
    if (type === 'video') return '🎬';
    return '🔗';
  };

  w.MynoteConstants = C;
})(window);
