use mynote_core::model::Timestamp;

#[test]
fn iso_timestamps_convert_to_millis() {
    // 与真实样本同一时刻：memos.json 里 id 为数字的那条，
    // createdAt 的 ISO 写法与另一字段的毫秒数指向同一瞬间。
    let iso = Timestamp::Iso("2026-05-08T15:43:19.257Z".to_string());
    assert_eq!(iso.to_millis(), Some(1778254999257));
    // 微秒位（Flutter 导出形）截断到毫秒
    let micro = Timestamp::Iso("2026-11-19T06:18:34.470560Z".to_string());
    assert_eq!(micro.to_millis(), Some(1795069114470));
    // 毫秒数原样
    assert_eq!(Timestamp::Millis(42).to_millis(), Some(42));
    // 坏输入不猜
    assert_eq!(Timestamp::Iso("not a date".to_string()).to_millis(), None);
}
