(function (w) {
  var C = {
    API_BASE: 'https://mynote.overtrees.workers.dev',
    URL_REGEX: /^https?:\/\/(www\.)?[-\u4e00-\u9fa5a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-\u4e00-\u9fa5a-zA-Z0-9()@:%_+.~#?&\/=]*)$/i,
    URL_INLINE_REGEX: /https?:\/\/[-\u4e00-\u9fa5a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b[-\u4e00-\u9fa5a-zA-Z0-9()@:%_+.~#?&\/=]*/i,
    NEW_CARD_ID: '__new_memo_card__',
    GOOGLE_CLIENT_ID: '993589743002-6o74a8e7d5jck2g55rag7me7q60ogehr.apps.googleusercontent.com',
    GOOGLE_API_KEY: 'YOUR_API_KEY',
    QWEATHER_API_KEY: '23d011760ad7448bb7a62727617cc2ba',
    BACKUP_FILE_NAME: 'memories_backup.json'
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

  w.CikeConstants = C;
})(window);
