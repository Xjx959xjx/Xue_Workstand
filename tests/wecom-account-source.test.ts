import assert from "node:assert/strict";
import test from "node:test";
import { parseWecomAccountSheet } from "../src/lib/wecom-account-source";

test("企业微信抖音新表头会读取定制和植入价格", () => {
  const accounts = parseWecomAccountSheet([
    "抖音",
    "|账号昵称|平台|抖音ID|植入价格;（含税不含平台费）|定制价格;（含税不含平台费）|主页链接|抖音合作码;（先填现在的 有更新再喊）|",
    "|---|---|---|---|---|---|---|",
    "|薛定谔的机|抖音|YxjGame|8680|10500|[主页](https://v.douyin.com/example/)|71425560780|"
  ].join("\n"));

  assert.deepEqual(accounts, [{
    platform: "douyin",
    name: "薛定谔的机",
    defaultPrice: 10_500,
    priceLabel: "定制报价",
    secondaryPrice: 8_680,
    secondaryPriceLabel: "植入报价",
    douyinId: "YxjGame",
    cooperationCode: "71425560780",
    homepage: "https://v.douyin.com/example/"
  }]);
});

test("企业微信抖音旧档位表头不再作为账号报价读取", () => {
  const accounts = parseWecomAccountSheet([
    "抖音",
    "|账号昵称|平台|抖音ID|21-60秒报价;（含税不含平台费）|60秒+报价;（含税不含平台费）|主页链接|",
    "|---|---|---|---|---|---|",
    "|旧格式账号|抖音|legacy-id|8680|10500|https://v.douyin.com/legacy/|"
  ].join("\n"));

  assert.deepEqual(accounts, []);
});
