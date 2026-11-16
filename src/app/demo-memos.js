/* 内置示例数据：demo 笔记 + 城市英转中表。memo-list.js 抽出。 */
(function (w) {
  'use strict';

var CN_CITY = {"Beijing":"北京","Shanghai":"上海","Guangzhou":"广州","Shenzhen":"深圳","Hangzhou":"杭州","Nanjing":"南京","Chengdu":"成都","Wuhan":"武汉","Tianjin":"天津","Chongqing":"重庆","Shenyang":"沈阳","Changchun":"长春","Harbin":"哈尔滨","Dalian":"大连","Qingdao":"青岛","Jinan":"济南","Zhengzhou":"郑州","Changsha":"长沙","Nanchang":"南昌","Hefei":"合肥","Fuzhou":"福州","Xiamen":"厦门","Kunming":"昆明","Guiyang":"贵阳","Lanzhou":"兰州","Xi'an":"西安","Xining":"西宁","Yinchuan":"银川","Nanning":"南宁","Haikou":"海口","Zhuhai":"珠海","Foshan":"佛山","Dongguan":"东莞","Suzhou":"苏州","Wuxi":"无锡","Ningbo":"宁波","Wenzhou":"温州","Changzhou":"常州","Zhongshan":"中山","Huizhou":"惠州","Shantou":"汕头","Zhanjiang":"湛江","Taizhou":"台州","Jiaxing":"嘉兴","Shaoxing":"绍兴","Yangzhou":"扬州","Zhenjiang":"镇江","Nantong":"南通","Xuzhou":"徐州","Luoyang":"洛阳","Guilin":"桂林","Lhasa":"拉萨","Urumqi":"乌鲁木齐","Hohhot":"呼和浩特","Macau":"澳门","Hong Kong":"香港","Taipei":"台北","Kaohsiung":"高雄","Taichung":"台中","Tainan":"台南"};

function toCn(name) {
  if (!name) return name;
  var c = CN_CITY[name];
  if (c) return c;
  return name;
}

function buildBuiltinMemos() {
    var now = Date.now();
    var day = 86400000;
    function gid() { return window.MynoteId.genId(); }
    return [
      {
        id: 'demo_exhibit',
        title: '周末看展记录',
        pinned: false,
        createdAt: new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
        doc: [
          { id: gid(), type: 'paragraph', children: [{ text: '今天去了 UCCA 的「非物质再现」展。光线透过亚克力板投射在墙上的影子会随着人的移动变化，站久了会忘记时间。' }] },
          { id: gid(), type: 'paragraph', children: [{ text: '想起上周看的书里那句话：==所谓的边界，只是我们还没习惯的过渡带==' }] },
          { id: gid(), type: 'heading', attrs: { level: 2 }, children: [{ text: '实用信息' }] },
          { id: gid(), type: 'paragraph', children: [{ text: '地址：798 艺术区 UCCA。票价 100 元。' }] }
        ]
      },
      {
        id: 'demo_home',
        title: '装修踩坑清单',
        pinned: true,
        createdAt: new Date(now - day).toISOString(),
        updatedAt: new Date(now - day).toISOString(),
        doc: [
          { id: gid(), type: 'todo', attrs: { checked: true }, children: [{ text: '厨房插座至少留 6 个，台面要带开关' }] },
          { id: gid(), type: 'todo', attrs: { checked: true }, children: [{ text: '卫生间防水刷到 1.8m，闭水试验做满 48h' }] },
          { id: gid(), type: 'todo', attrs: { checked: false }, children: [{ text: '地板和瓷砖之间用极窄收边条，不要过门石' }] },
          { id: gid(), type: 'todo', attrs: { checked: false }, children: [{ text: '衣柜做到顶，不要成品柜，顶部积灰严重' }] }
        ]
      },
      {
        id: 'demo_tools',
        title: '好用的工具网站',
        pinned: false,
        createdAt: new Date(now - 3 * day).toISOString(),
        updatedAt: new Date(now - 3 * day).toISOString(),
        doc: [
          { id: gid(), type: 'paragraph', children: [{ text: '几个日常高频用到的小工具，免费无广告。' }] },
          { id: gid(), type: 'paragraph', children: [{ text: 'Excalidraw — 画架构图和流程图最顺手的白板。' }] },
          { id: gid(), type: 'paragraph', children: [{ text: 'Carbon — 把代码生成漂亮的分享图，支持 20+ 主题。' }] }
        ]
      },
      {
        id: 'demo_book',
        title: '读书笔记｜设计的觉醒',
        pinned: false,
        createdAt: new Date(now - 7 * day).toISOString(),
        updatedAt: new Date(now - 7 * day).toISOString(),
        doc: [
          { id: gid(), type: 'paragraph', children: [{ text: '田中一光的随笔集，断断续续读了一个月。' }] },
          { id: gid(), type: 'paragraph', children: [{ text: '「设计不是一种技能，而是捕捉事物本质的感觉和洞察力。」' }] },
          { id: gid(), type: 'paragraph', children: [{ text: '「整理、排布、思考——设计的本质就是这三件事的循环。」' }] }
        ]
      },
      {
        id: 'demo_music',
        title: '最近在听的歌',
        pinned: false,
        createdAt: new Date(now - 14 * day).toISOString(),
        updatedAt: new Date(now - 14 * day).toISOString(),
        doc: [
          { id: gid(), type: 'heading', attrs: { level: 2 }, children: [{ text: '上周循环最多的几首' }] },
          { id: gid(), type: 'paragraph', children: [{ text: 'She Her Her Hers — Arrows — 吉他前奏一响整个人都松下来了。适合下雨天窝在沙发上单曲循环。' }] },
          { id: gid(), type: 'musicCard', url: 'https://c6.y.qq.com/base/fcgi-bin/u?__=1RE7gOYaMZgO', meta: null, status: 'loading' },
          { id: gid(), type: 'paragraph', children: [{ text: '陶喆 — 月亮代表谁的心 — 晚上十一点半的地铁上听到这首歌，老歌新唱居然听出了不一样的味道。原来有些旋律不管过多少年都不会过期。' }] },
          { id: gid(), type: 'musicCard', url: 'https://music.apple.com/cn/album/%E6%9C%88%E4%BA%AE%E4%BB%A3%E8%A1%A8%E8%B0%81%E7%9A%84%E5%BF%83/914664926?i=914664941', meta: null, status: 'loading' },
          { id: gid(), type: 'paragraph', children: [{ text: '黑裙子 — Our Own Summer — 前奏的鼓点一出来就感觉回到了某个无所事事的夏天傍晚，风吹在脸上是热的，但心里是凉的。' }] },
          { id: gid(), type: 'musicCard', url: 'https://163cn.tv/7ceoWN8', meta: null, status: 'loading' },
          { id: gid(), type: 'paragraph', children: [{ text: '落日飞车 — My Jinji — 适合晚上开车听，吉他音色软软的，像夏天的风从车窗缝里吹进来。' }] },
          { id: gid(), type: 'musicCard', url: 'https://open.spotify.com/track/7npPPrZEDmeHMk6mxvIeFa?si=zp0-QuSsTBWvhaGVKVUfjg', meta: null, status: 'loading' }
        ]
      }
    ];
  }

  w.MynoteDemo = {
    CN_CITY: CN_CITY,
    toCn: toCn,
    buildBuiltinMemos: buildBuiltinMemos
  };
})(window);
