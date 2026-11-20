// Google Drive 备份服务：原版 src/services/drive.js 的 Dart 移植。
// 备份位于 appDataFolder，文件名 memories_backup.zip（兼容旧 .json 名）；
// 列表分页、候选选择（zip 优先 + 最新）、resumable 分片上传、
// 401/403 分类与 Web 一致。access token 仅存内存（与 Web 一致）。
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import '../core/diag.dart';

const driveBackupFileName = 'memories_backup.zip';
const driveLegacyFileName = 'memories_backup.json';

/// 401 → 'expired'，403 → 'forbidden'，其余 null（同 classifyDriveResponse）。
String? classifyDriveResponse(int status) {
  if (status == 401) return 'expired';
  if (status == 403) return 'forbidden';
  return null;
}

class DriveFile {
  const DriveFile({required this.id, required this.name, this.modifiedTime});
  final String id;
  final String name;
  final String? modifiedTime;

  factory DriveFile.fromJson(Map<String, dynamic> json) => DriveFile(
    id: json['id']?.toString() ?? '',
    name: json['name']?.toString() ?? '',
    modifiedTime: json['modifiedTime']?.toString(),
  );
}

/// 候选选择（同 selectMynoteBackup）：zip 名优先，其次 modifiedTime 最新。
DriveFile? selectMynoteBackup(List<DriveFile> files) {
  final candidates = files
      .where(
        (f) =>
            f.id.isNotEmpty &&
            (f.name == driveBackupFileName || f.name == driveLegacyFileName),
      )
      .toList();
  candidates.sort((a, b) {
    final az = a.name == driveBackupFileName ? 1 : 0;
    final bz = b.name == driveBackupFileName ? 1 : 0;
    if (az != bz) return bz - az;
    return (b.modifiedTime ?? '').compareTo(a.modifiedTime ?? '');
  });
  return candidates.isEmpty ? null : candidates.first;
}

class DriveApi {
  DriveApi(this.accessToken);
  final String accessToken;

  Map<String, String> get _headers => {'Authorization': 'Bearer $accessToken'};

  void _checkAuth(http.Response res) {
    final kind = classifyDriveResponse(res.statusCode);
    if (kind != null) {
      Diag.error('DRIVE', 'auth $kind (HTTP ${res.statusCode})');
      throw DriveAuthException(kind);
    }
  }

  Future<List<DriveFile>> listBackups() async {
    final files = <DriveFile>[];
    String? pageToken;
    do {
      final query =
          "(name='$driveBackupFileName' or name='$driveLegacyFileName')";
      final uri = Uri.https('www.googleapis.com', '/drive/v3/files', {
        'q': query,
        'trashed': 'false',
        'spaces': 'appDataFolder',
        'pageSize': '1000',
        'fields': 'files(id,name,mimeType,modifiedTime),nextPageToken',
        if (pageToken != null) 'pageToken': pageToken,
      });
      final res = await http
          .get(uri, headers: _headers)
          .timeout(const Duration(seconds: 30));
      _checkAuth(res);
      if (res.statusCode != 200) {
        throw StateError('读取云端备份列表失败：HTTP ${res.statusCode}');
      }
      final data = res.bodyBytes.isEmpty ? null : _jsonDecode(res.body);
      final list = (data?['files'] as List?) ?? const [];
      files.addAll(
        list.whereType<Map<String, dynamic>>().map(DriveFile.fromJson),
      );
      pageToken = data?['nextPageToken']?.toString();
    } while (pageToken != null);
    Diag.log('DRIVE', 'listed ${files.length} backups');
    return files;
  }

  Future<Uint8List> download(String fileId) async {
    final uri = Uri.https('www.googleapis.com', '/drive/v3/files/$fileId', {
      'alt': 'media',
    });
    final res = await http
        .get(uri, headers: _headers)
        .timeout(const Duration(seconds: 30));
    _checkAuth(res);
    if (res.statusCode != 200)
      throw StateError('下载云端备份失败：HTTP ${res.statusCode}');
    Diag.log('DRIVE', 'downloaded $fileId (${res.bodyBytes.length}B)');
    return res.bodyBytes;
  }

  /// Resumable 上传：已有 fileId 走 PATCH 更新，否则 POST 新建到 appDataFolder。
  Future<void> uploadResumable({
    String? fileId,
    required Uint8List bytes,
    required String name,
  }) async {
    final initUri = fileId != null
        ? Uri.parse(
            'https://www.googleapis.com/upload/drive/v3/files/$fileId?uploadType=resumable',
          )
        : Uri.parse(
            'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
          );
    final metadata = {
      'name': name,
      'mimeType': 'application/zip',
      if (fileId == null) 'parents': ['appDataFolder'],
    };
    final initRes =
        await (fileId != null
                ? http.patch(
                    initUri,
                    headers: {
                      ..._headers,
                      'Content-Type': 'application/json; charset=UTF-8',
                      'X-Upload-Content-Type': 'application/zip',
                      'X-Upload-Content-Length': '${bytes.length}',
                    },
                    body: _jsonEncode(metadata),
                  )
                : http.post(
                    initUri,
                    headers: {
                      ..._headers,
                      'Content-Type': 'application/json; charset=UTF-8',
                      'X-Upload-Content-Type': 'application/zip',
                      'X-Upload-Content-Length': '${bytes.length}',
                    },
                    body: _jsonEncode(metadata),
                  ))
            .timeout(const Duration(seconds: 30));
    _checkAuth(initRes);
    if (initRes.statusCode != 200) {
      throw StateError('初始化分片上传失败：HTTP ${initRes.statusCode}');
    }
    final location =
        initRes.headers['location'] ?? initRes.headers['x-goog-upload-url'];
    if (location == null) throw StateError('Drive 未返回分片上传地址（Location 头不可用）');
    final putRes = await http
        .put(
          Uri.parse(location),
          headers: {'Content-Length': '${bytes.length}'},
          body: bytes,
        )
        .timeout(const Duration(seconds: 120));
    if (putRes.statusCode != 200 && putRes.statusCode != 201) {
      throw StateError('上传备份数据失败：HTTP ${putRes.statusCode}');
    }
    Diag.log(
      'DRIVE',
      'uploaded $name (${bytes.length}B) fileId=${fileId ?? 'new'}',
    );
  }
}

class DriveAuthException implements Exception {
  DriveAuthException(this.kind);
  final String kind; // expired | forbidden
  @override
  String toString() => 'DriveAuthException($kind)';
}

Map<String, dynamic>? _jsonDecode(String body) {
  try {
    final v = jsonDecode(body);
    return v is Map<String, dynamic> ? v : null;
  } catch (_) {
    return null;
  }
}

String _jsonEncode(Map<String, dynamic> m) => jsonEncode(m);
