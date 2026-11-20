import 'attachment_store.dart';

/// 非 Web 端不会走到这里（providers 按 kIsWeb 分流到 File 实现）。
AttachmentStore createPlatformAttachmentStore() => MemoryAttachmentStore();
