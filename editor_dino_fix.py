import re
with open('/var/minis/workspace/cike-app/Moments.html', 'r') as f:
    src = f.read()
old_span = '''}) : /*#__PURE__*/React.createElement("span", {\n      style: {\n        fontSize: 44,\n        lineHeight: 1,\n        display: "flex",\n        alignItems: "center",\n        justifyContent: "center",\n        width: "100%",\n        height: "100%"\n      }\n    }, "\\uD83D\\uDC7D"))'''
new_dino = '''}) : /*#__PURE__*/React.createElement("div", { style: { width: "100%", height: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center", overflow: "hidden" } }, /*#__PURE__*/React.createElement("svg", { viewBox: "0 0 512 512", width: 60, height: 60, fill: "none", stroke: "#8A9BB0", strokeWidth: 22, strokeLinecap: "round", strokeLinejoin: "round", style: { transform: "translateY(10px)" } }, /*#__PURE__*/React.createElement("path", { d: "M 90,460 L 90,170 C 90,110 140,70 210,70 L 380,95 C 440,95 470,130 470,185 C 470,225 450,240 410,245 C 350,250 280,230 210,265 C 190,275 190,295 210,310 C 270,350 350,380 410,360 C 435,350 440,325 410,315" }), /*#__PURE__*/React.createElement("path", { d: "M 160,330 C 180,380 230,440 280,460" }), /*#__PURE__*/React.createElement("path", { d: "M 240,365 C 220,400 240,440 310,460" }), /*#__PURE__*/React.createElement("path", { d: "M 90,460 L 310,460" }), /*#__PURE__*/React.createElement("path", { d: "M 415,135 C 425,140 435,150 435,160" }), /*#__PURE__*/React.createElement("path", { d: "M 230,115 C 260,95 310,120 355,140" }), /*#__PURE__*/React.createElement("path", { d: "M 255,140 C 255,170 290,195 320,185 C 345,175 350,150 335,135" }), /*#__PURE__*/React.createElement("path", { d: "M 290,145 C 290,165 315,165 315,150" }), /*#__PURE__*/React.createElement("path", { d: "M 250,243 L 255,265 L 265,243 M 275,245 L 282,270 L 292,245 M 302,246 L 310,273 L 320,247 M 330,248 L 340,275 L 350,248 M 360,249 L 370,274 L 380,248 M 390,248 L 400,270 L 408,246 M 415,244 L 425,263 L 432,240 M 438,235 L 448,252 L 452,228" }), /*#__PURE__*/React.createElement("path", { d: "M 250,323 L 255,305 L 263,326 M 273,329 L 280,308 L 288,333 M 298,336 L 306,313 L 314,340 M 324,343 L 333,318 L 341,346 M 351,348 L 361,323 L 369,351 M 379,352 L 389,328 L 396,353 M 404,351 L 413,330 L 418,348" })))'''
if old_span in src:
    src = src.replace(old_span, new_dino)
    with open('/var/minis/workspace/cike-app/Moments.html', 'w') as f:
        f.write(src)
    m = re.search(r'<div id="memo-list-root"></div>\n\n<script>\n(.*?)</script>', src, re.DOTALL)
    if m:
        c = m.group(1)
        print('Balanced:', c.count('(') == c.count(')'))
else:
    print('NOT FOUND')
