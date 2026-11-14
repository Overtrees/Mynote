/* PWA standalone 模式下的站内链接接管。 */
    (function () {
        if (("standalone" in window.navigator) && window.navigator.standalone) {
            document.addEventListener("click", function (e) {
                let nod = e.target;
                while (nod && nod.nodeName !== "A") nod = nod.parentNode;
                if (nod && "href" in nod && (nod.href.indexOf(window.location.host) !== -1 || nod.href.startsWith("/") || nod.href.startsWith("#"))) {
                    e.preventDefault();
                    window.location.href = nod.href;
                }
            }, false);
        }
    })();
