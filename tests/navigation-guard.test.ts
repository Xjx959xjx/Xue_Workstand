import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

test("未保存页面允许模块导航，刷新和关闭仍受保护，卸载会清理监听", () => {
  const document = new EventTarget();
  const window = new EventTarget();
  let confirms = 0;
  let cleanup: (() => void) | undefined;
  class Anchor {
    href = "http://workbench.test/images";
    target = "";
    hasAttribute() { return false; }
  }
  Object.assign(document, { closest: () => new Anchor() });
  Object.assign(window, { location: { pathname: "/writer" }, confirm: () => { confirms++; return false; } });
  const exports = {} as { useUnsavedChangesGuard: (dirty: boolean) => void };
  const source = readFileSync(new URL("../src/components/UnsavedChangesGuard.tsx", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { exports, document, window, URL, HTMLAnchorElement: Anchor,
    require: () => ({ useEffect: (effect: () => (() => void) | undefined) => { cleanup = effect(); } }) });

  exports.useUnsavedChangesGuard(true);
  const click = Object.assign(new Event("click", { cancelable: true }), { button: 0 });
  assert.equal(document.dispatchEvent(click), true, "模块导航不得被拦截");
  assert.equal(confirms, 0, "模块导航不得弹确认");
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  assert.equal(unload.defaultPrevented, true);
  cleanup?.();
  assert.equal(window.dispatchEvent(new Event("beforeunload", { cancelable: true })), true);
  exports.useUnsavedChangesGuard(false);
  assert.equal(window.dispatchEvent(new Event("beforeunload", { cancelable: true })), true);
});
