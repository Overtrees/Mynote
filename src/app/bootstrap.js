/* 应用启动入口：只负责挂载根组件。 */
ReactDOM.createRoot(document.getElementById("memo-list-root")).render( /*#__PURE__*/React.createElement(window.MynoteErrors && window.MynoteErrors.Badge ? window.MynoteErrors.Badge : React.Fragment, null, /*#__PURE__*/React.createElement(window.MynoteMemoList, null)));
