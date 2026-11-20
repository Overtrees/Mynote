/// 非 Web 端暂用内存实现（原生阶段接文件存储）。
final _mem = <String, String>{};

String? prefsGet(String key) => _mem[key];

void prefsSet(String key, String value) => _mem[key] = value;

void prefsRemove(String key) => _mem.remove(key);
