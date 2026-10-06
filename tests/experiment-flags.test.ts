import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { installExperimentFlagPins } from "../src/renderer/ytmview/experiment-flags";
import { PINNED_EXPERIMENT_FLAGS } from "~shared/ytm-contract";

const YTCFG_INLINE =
  "var ytcfg={d:function(){return window.yt&&yt.config_||ytcfg.data_||(ytcfg.data_={})},get:function(k,o){return k in ytcfg.d()?ytcfg.d()[k]:o},set:function(){var a=arguments;if(a.length>1)ytcfg.d()[a[0]]=a[1];else{var k;for(k in a[0])ytcfg.d()[k]=a[0][k]}}};";

const FLAG_READER =
  "(name => { const value = ytcfg.get('EXPERIMENT_FLAGS', {})[name]; return typeof value === 'string' && value === 'false' ? false : !!value; })";

function page() {
  const report = vi.fn();
  const context = vm.createContext({ ytmd: { reportContractMiss: report } });
  vm.runInContext("var window = globalThis;", context);
  const run = (source: string) => vm.runInContext(source, context);
  const install = () => run(`(${installExperimentFlagPins.toString()})(${JSON.stringify(PINNED_EXPERIMENT_FLAGS)})`);
  const flag = (name: string) => run(`${FLAG_READER}(${JSON.stringify(name)})`);
  return { report, run, install, flag };
}

describe("experiment flag pins", () => {
  it("pins the wiz miniplayer experiment off and leaves every other flag alone", () => {
    const { report, run, install, flag } = page();
    install();
    run(YTCFG_INLINE);
    run(`ytcfg.set({ EXPERIMENT_FLAGS: { music_web_enable_wiz_miniplayer: true, music_web_enable_drag_drop_upload: true } });`);

    expect(flag("music_web_enable_wiz_miniplayer")).toBe(false);
    expect(flag("music_web_enable_drag_drop_upload")).toBe(true);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith("experiment flag music_web_enable_wiz_miniplayer pinned to false", "true");
  });

  it("stays quiet when the page was not bucketed into the experiment", () => {
    const { report, run, install, flag } = page();
    install();
    run(YTCFG_INLINE);
    run(`ytcfg.set({ EXPERIMENT_FLAGS: { music_web_enable_drag_drop_upload: true } });`);

    expect(flag("music_web_enable_wiz_miniplayer")).toBe(false);
    expect(report).not.toHaveBeenCalled();
  });

  it("pins flags that arrive in a later set, and reports each flag once", () => {
    const { report, run, install, flag } = page();
    install();
    install();
    run(YTCFG_INLINE);
    run(`ytcfg.set({ EXPERIMENT_FLAGS: { music_web_enable_wiz_miniplayer: "true" } });`);
    run(`ytcfg.set("EXPERIMENT_FLAGS", { music_web_enable_wiz_miniplayer: true });`);

    expect(flag("music_web_enable_wiz_miniplayer")).toBe(false);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("pins a config that already exists when it installs", () => {
    const { report, run, install, flag } = page();
    run(YTCFG_INLINE);
    run(`ytcfg.set({ EXPERIMENT_FLAGS: { music_web_enable_wiz_miniplayer: true } });`);
    install();

    expect(flag("music_web_enable_wiz_miniplayer")).toBe(false);
    expect(report).toHaveBeenCalledTimes(1);
  });
});
