import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../core/diag.dart';

/// 链接元信息服务：与 Web 版 fetchLinkMeta 同源（Worker /meta 接口）。
const linkMetaApiBase = 'https://mynote.overtrees.workers.dev';

typedef LinkMetaFetcher = Future<Map<String, dynamic>?> Function(String url);

Future<Map<String, dynamic>?> fetchLinkMeta(String url) async {
  try {
    final uri = Uri.parse('$linkMetaApiBase/meta')
        .replace(queryParameters: {'url': url});
    final res = await http.get(uri).timeout(const Duration(seconds: 20));
    if (res.statusCode != 200) {
      Diag.error('CARD', 'meta HTTP ${res.statusCode} for $url');
      return null;
    }
    final data = jsonDecode(res.body);
    return data is Map<String, dynamic> ? data : null;
  } catch (e) {
    Diag.error('CARD', 'meta fetch failed: $e');
    return null;
  }
}
