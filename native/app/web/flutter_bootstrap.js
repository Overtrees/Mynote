{{flutter_js}}
{{flutter_build_config}}
window.__mynoteStages = window.__mynoteStages || [];
function __mynoteStage(s) {
  try {
    window.__mynoteStages.push(s + '@' + Math.round(performance.now()));
  } catch (e) {}
}
__mynoteStage('bootstrap-exec');
_flutter.loader.load({
  onEntrypointLoaded: async function (engineInitializer) {
    __mynoteStage('entrypoint-loaded');
    try {
      const appRunner = await engineInitializer.initializeEngine({
        hostElement: document.querySelector('#host'),
      });
      __mynoteStage('engine-initialized');
      await appRunner.runApp();
      __mynoteStage('runApp-done');
    } catch (e) {
      __mynoteStage('init-error');
      try {
        window.__mynoteErrs.push(
          'init: ' + String((e && e.message) || e).slice(0, 200),
        );
      } catch (err) {}
    }
  },
});
__mynoteStage('loader-load-called');
