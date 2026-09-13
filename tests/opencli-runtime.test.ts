import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveOpenCliCommand,
  sharedOpenCliBrowserSession,
  withPersistentBrowserAdapterOptions,
  withSharedOpenCliBrowserSession
} from "../src/lib/opencli-runtime";

test("configured OpenCLI profile is passed as a global CLI option", () => {
  const previousProfile = process.env.OPENCLI_PROFILE;
  const previousScript = process.env.OPENCLI_SCRIPT;
  try {
    process.env.OPENCLI_PROFILE = "zzvdwwpb";
    delete process.env.OPENCLI_SCRIPT;
    assert.deepEqual(resolveOpenCliCommand().argsPrefix, ["--profile", "zzvdwwpb"]);

    process.env.OPENCLI_SCRIPT = "/tmp/opencli.mjs";
    assert.deepEqual(resolveOpenCliCommand().argsPrefix, ["/tmp/opencli.mjs", "--profile", "zzvdwwpb"]);
  } finally {
    if (previousProfile === undefined) delete process.env.OPENCLI_PROFILE;
    else process.env.OPENCLI_PROFILE = previousProfile;
    if (previousScript === undefined) delete process.env.OPENCLI_SCRIPT;
    else process.env.OPENCLI_SCRIPT = previousScript;
  }
});

test("sharedOpenCliBrowserSession uses one stable default session", () => {
  const previous = process.env.OPENCLI_BROWSER_SESSION;
  delete process.env.OPENCLI_BROWSER_SESSION;
  try {
    assert.equal(sharedOpenCliBrowserSession(), "content-workbench-browser");
    process.env.OPENCLI_BROWSER_SESSION = "custom-browser-session";
    assert.equal(sharedOpenCliBrowserSession(), "custom-browser-session");
  } finally {
    if (previous === undefined) delete process.env.OPENCLI_BROWSER_SESSION;
    else process.env.OPENCLI_BROWSER_SESSION = previous;
  }
});

test("persistent browser adapter options are added once", () => {
  assert.deepEqual(
    withPersistentBrowserAdapterOptions(["bilibili", "search", "测试", "-f", "json"]),
    ["bilibili", "search", "测试", "-f", "json", "--window", "background", "--site-session", "persistent"]
  );
  assert.deepEqual(
    withPersistentBrowserAdapterOptions([
      "bilibili", "search", "测试", "--window", "foreground", "--site-session", "ephemeral"
    ]),
    ["bilibili", "search", "测试", "--window", "foreground", "--site-session", "ephemeral"]
  );
});

test("shared browser operations do not interleave", async () => {
  const previous = process.env.OPENCLI_BROWSER_SESSION;
  process.env.OPENCLI_BROWSER_SESSION = "test-serialized-browser-session";
  const events: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  try {
    const first = withSharedOpenCliBrowserSession(async (session) => {
      events.push(`first:start:${session}`);
      await firstGate;
      events.push("first:end");
    });
    const second = withSharedOpenCliBrowserSession(async (session) => {
      events.push(`second:start:${session}`);
      events.push("second:end");
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(events, ["first:start:test-serialized-browser-session"]);
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(events, [
      "first:start:test-serialized-browser-session",
      "first:end",
      "second:start:test-serialized-browser-session",
      "second:end"
    ]);
  } finally {
    releaseFirst();
    if (previous === undefined) delete process.env.OPENCLI_BROWSER_SESSION;
    else process.env.OPENCLI_BROWSER_SESSION = previous;
  }
});
