# 代码精简扫描报告

扫描日期：2026-09-17。工具：Knip 6.36.0、jscpd 5.2.1。对象为当前工作树（包括未提交和新增代码），不是仅 HEAD。

## 结论

- 常规文本重复率 2.73%；较长重复片段占比 0.82%。尚无证据表明大部分代码是复制粘贴冗余。
- Knip 发现 7 个未被配置入口引用的文件，共 416 行；116 个未被外部引用的值导出、46 个类型导出。它们是清理候选，不是自动删除清单。
- 未修改业务源码、package.json、锁文件或用户素材；工具通过 npm exec 临时运行，报告存于 outputs。

## 扫描范围与限制

- Knip：src、scripts、tests、evals 和根配置。显式保留 Next 页面/路由/布局等入口、middleware、instrumentation、测试和所有脚本，避免把手动运维脚本误判为无用。保留全部脚本也意味着不会识别哪些脚本已业务废弃。
- Next 等自动检测继续启用；Vite 插件解析关闭，vite.config.ts 仍作为入口扫描其 import，避免执行该配置；插件隐式依赖需人工核对。
- jscpd：仅 src 内 TS/TSX/CSS，mild 模式，不归一化变量名或字面量。未扫描素材库、构建目录、依赖、测试和脚本的重复率。
- 不识别所有语义重复、不判断 CSS 选择器是否失效，也不能证明 HTTP API 没有外部调用者。
- 文件数随阈值变化：过短文件不会进入 jscpd 统计。重复行是工具口径，不等于可安全删除的行数。
- 扫描期间工作树有其他并行改动，本报告代表各工具运行时读取的状态，并非冻结快照；后续清理需按当时源码复核。
- 未执行修复、构建或测试；本次为静态扫描。Knip 退出码 1 表示检测到问题，非扫描失败；无 unresolved 项。

## 重复率

| 口径 | 有效文件 | 统计行数 | 重复片段对 | 重复行 | 行重复率 |
|---|---:|---:|---:|---:|---:|
| 常规：≥5 行、≥50 tokens | 278 | 81525 | 211 | 2222 | 2.73% |
| 长片段：≥10 行、≥100 tokens | 266 | 81251 | 29 | 663 | 0.82% |

常规阈值按格式：

| 格式 | 重复率 | 重复行 |
|---|---:|---:|
| css | 2.30% | 427 |
| tsx | 2.54% | 413 |
| typescript | 2.96% | 1382 |

## 未引用文件候选

已结合文本引用搜索和页面入口人工核对，当前扫描范围内未发现使用方；删除前仍需确认是否要保留尚未接入的功能。

| 文件 | 行数 |
|---|---:|
| [src/lib/link-input.ts](</Users/xjx/Documents/New project 3/src/lib/link-input.ts>) | 7 |
| [src/lib/video-links.ts](</Users/xjx/Documents/New project 3/src/lib/video-links.ts>) | 6 |
| [src/app/_hooks/useManagedSelection.ts](</Users/xjx/Documents/New project 3/src/app/_hooks/useManagedSelection.ts>) | 31 |
| [src/app/assets/_components/SourcePreviewModal.tsx](</Users/xjx/Documents/New project 3/src/app/assets/_components/SourcePreviewModal.tsx>) | 37 |
| [src/app/images/_components/ImageCanvas.tsx](</Users/xjx/Documents/New project 3/src/app/images/_components/ImageCanvas.tsx>) | 149 |
| [src/app/project-workbench/_components/AccountPickerModal.tsx](</Users/xjx/Documents/New project 3/src/app/project-workbench/_components/AccountPickerModal.tsx>) | 88 |
| [src/app/project-workbench/_components/SourceAddModal.tsx](</Users/xjx/Documents/New project 3/src/app/project-workbench/_components/SourceAddModal.tsx>) | 98 |

ImageCanvas.tsx 为旧画布组件；当前图片页使用 ImageResults。即使后续删除该文件，也不能直接删除 @xyflow/react：images/layout.tsx 仍导入该包的 CSS，需要同时审查样式引用。

## 依赖与误报核对

- 生产依赖：Knip 本次没有报告未使用项，不等于所有依赖都不可精简。
- eslint-config-next：误报，eslint.config.mjs 通过 FlatCompat 的 next/core-web-vitals、next/typescript 使用，应保留。
- playwright：扫描范围内未找到源码/脚本引用，但项目要求浏览器 smoke test，也可能经命令行使用。列为待确认开发工具，不建议直接删除。
- @next/env：3 处导入未直接声明依赖（remote-server、diagnose-model-service、run-discussion-model-trial）。这是依赖声明问题，不是无用依赖；应评估显式声明，不能删除导入。
- cloudStat/cloudLstat：Knip 报 1 组重复导出，实际为别名关系，不能当作复制代码直接删除。

## 优先处理的重复逻辑

1. ai.ts 与 model-runtime.ts 的模型响应解析和错误处理。长片段扫描匹配到 54 行、40 行等片段，适合提取共享纯函数；需保留 serviceTier、流事件和错误分类差异。
2. 弹窗焦点约束代码：毛利导入、价格表、模板、写作弹窗等重复 32–38 行，适合统一到既有弹窗底层。
3. douyin-hotlist.ts 与 opencli-bilibili.ts 的 21 行并发池；其它改名版本可能未被精确匹配，仍需审查取消和失败语义。
4. client.ts 的下载、缓存以及 client/storage 的摘要转换；尽量扩展现有抽象。

## 较长重复片段完整清单

| 匹配行数 | 位置 A | 位置 B |
|---|---|---|
| 54 | [lib/ai.ts:953](</Users/xjx/Documents/New project 3/src/lib/ai.ts:953>) | [lib/model-runtime.ts:918](</Users/xjx/Documents/New project 3/src/lib/model-runtime.ts:918>) |
| 40 | [lib/ai.ts:1392](</Users/xjx/Documents/New project 3/src/lib/ai.ts:1392>) | [lib/model-runtime.ts:842](</Users/xjx/Documents/New project 3/src/lib/model-runtime.ts:842>) |
| 38 | [app/assets/_components/EngagementHistoryPane.tsx:43](</Users/xjx/Documents/New project 3/src/app/assets/_components/EngagementHistoryPane.tsx:43>) | [app/writer/_components/WriterHistoryPanel.tsx:154](</Users/xjx/Documents/New project 3/src/app/writer/_components/WriterHistoryPanel.tsx:154>) |
| 38 | [app/gross-margin/_components/GrossMarginImportModal.tsx:208](</Users/xjx/Documents/New project 3/src/app/gross-margin/_components/GrossMarginImportModal.tsx:208>) | [app/gross-margin/_components/GrossMarginPriceTableEditorModal.tsx:299](</Users/xjx/Documents/New project 3/src/app/gross-margin/_components/GrossMarginPriceTableEditorModal.tsx:299>) |
| 38 | [app/gross-margin/_components/GrossMarginImportModal.tsx:208](</Users/xjx/Documents/New project 3/src/app/gross-margin/_components/GrossMarginImportModal.tsx:208>) | [app/gross-margin/_components/GrossMarginTemplateModal.tsx:159](</Users/xjx/Documents/New project 3/src/app/gross-margin/_components/GrossMarginTemplateModal.tsx:159>) |
| 35 | [app/gross-margin/_components/GrossMarginImportModal.tsx:211](</Users/xjx/Documents/New project 3/src/app/gross-margin/_components/GrossMarginImportModal.tsx:211>) | [app/library/_components/LibraryEditorModal.tsx:41](</Users/xjx/Documents/New project 3/src/app/library/_components/LibraryEditorModal.tsx:41>) |
| 35 | [app/gross-margin/_components/GrossMarginImportModal.tsx:211](</Users/xjx/Documents/New project 3/src/app/gross-margin/_components/GrossMarginImportModal.tsx:211>) | [app/writer/_components/WriterDialogModal.tsx:49](</Users/xjx/Documents/New project 3/src/app/writer/_components/WriterDialogModal.tsx:49>) |
| 32 | [app/gross-margin/_components/GrossMarginBulkMonitorModal.tsx:199](</Users/xjx/Documents/New project 3/src/app/gross-margin/_components/GrossMarginBulkMonitorModal.tsx:199>) | [app/gross-margin/_components/GrossMarginImportModal.tsx:214](</Users/xjx/Documents/New project 3/src/app/gross-margin/_components/GrossMarginImportModal.tsx:214>) |
| 30 | [lib/transcription.ts:2140](</Users/xjx/Documents/New project 3/src/lib/transcription.ts:2140>) | [lib/transcription.ts:2180](</Users/xjx/Documents/New project 3/src/lib/transcription.ts:2180>) |
| 25 | [lib/storage.ts:1655](</Users/xjx/Documents/New project 3/src/lib/storage.ts:1655>) | [lib/storage.ts:1702](</Users/xjx/Documents/New project 3/src/lib/storage.ts:1702>) |
| 23 | [lib/account-collection.ts:162](</Users/xjx/Documents/New project 3/src/lib/account-collection.ts:162>) | [lib/douyin-hotlist.ts:509](</Users/xjx/Documents/New project 3/src/lib/douyin-hotlist.ts:509>) |
| 22 | [app/douyin-hotlist/_components/AccountManagementDrawer.tsx:271](</Users/xjx/Documents/New project 3/src/app/douyin-hotlist/_components/AccountManagementDrawer.tsx:271>) | [app/gross-margin/_components/GrossMarginBulkMonitorModal.tsx:208](</Users/xjx/Documents/New project 3/src/app/gross-margin/_components/GrossMarginBulkMonitorModal.tsx:208>) |
| 22 | [app/douyin-hotlist/_components/AccountManagementDrawer.tsx:271](</Users/xjx/Documents/New project 3/src/app/douyin-hotlist/_components/AccountManagementDrawer.tsx:271>) | [components/ConfirmDialog.tsx:90](</Users/xjx/Documents/New project 3/src/components/ConfirmDialog.tsx:90>) |
| 21 | [app/gross-margin/gross-margin.css:2198](</Users/xjx/Documents/New project 3/src/app/gross-margin/gross-margin.css:2198>) | [app/gross-margin/gross-margin.css:2287](</Users/xjx/Documents/New project 3/src/app/gross-margin/gross-margin.css:2287>) |
| 21 | [lib/douyin-hotlist.ts:881](</Users/xjx/Documents/New project 3/src/lib/douyin-hotlist.ts:881>) | [lib/opencli-bilibili.ts:926](</Users/xjx/Documents/New project 3/src/lib/opencli-bilibili.ts:926>) |
| 20 | [lib/ai.ts:1281](</Users/xjx/Documents/New project 3/src/lib/ai.ts:1281>) | [lib/model-runtime.ts:770](</Users/xjx/Documents/New project 3/src/lib/model-runtime.ts:770>) |
| 19 | [app/project-workbench/_components/ProjectCaseDrawer.tsx:175](</Users/xjx/Documents/New project 3/src/app/project-workbench/_components/ProjectCaseDrawer.tsx:175>) | [app/project-workbench/_components/SourceAddModal.tsx:80](</Users/xjx/Documents/New project 3/src/app/project-workbench/_components/SourceAddModal.tsx:80>) |
| 17 | [lib/ai.ts:878](</Users/xjx/Documents/New project 3/src/lib/ai.ts:878>) | [lib/model-runtime.ts:896](</Users/xjx/Documents/New project 3/src/lib/model-runtime.ts:896>) |
| 17 | [lib/client.ts:387](</Users/xjx/Documents/New project 3/src/lib/client.ts:387>) | [lib/storage.ts:871](</Users/xjx/Documents/New project 3/src/lib/storage.ts:871>) |
| 17 | [lib/storage.ts:967](</Users/xjx/Documents/New project 3/src/lib/storage.ts:967>) | [lib/storage/douyin-hotlist.ts:332](</Users/xjx/Documents/New project 3/src/lib/storage/douyin-hotlist.ts:332>) |
| 16 | [lib/ai.ts:1445](</Users/xjx/Documents/New project 3/src/lib/ai.ts:1445>) | [lib/model-runtime.ts:878](</Users/xjx/Documents/New project 3/src/lib/model-runtime.ts:878>) |
| 16 | [lib/client.ts:647](</Users/xjx/Documents/New project 3/src/lib/client.ts:647>) | [lib/client.ts:1466](</Users/xjx/Documents/New project 3/src/lib/client.ts:1466>) |
| 15 | [app/api/drafts/route.ts:16](</Users/xjx/Documents/New project 3/src/app/api/drafts/route.ts:16>) | [lib/storage/schemas.ts:56](</Users/xjx/Documents/New project 3/src/lib/storage/schemas.ts:56>) |
| 15 | [lib/client.ts:648](</Users/xjx/Documents/New project 3/src/lib/client.ts:648>) | [lib/client.ts:1088](</Users/xjx/Documents/New project 3/src/lib/client.ts:1088>) |
| 14 | [app/api/batch-transcribe/route.ts:3](</Users/xjx/Documents/New project 3/src/app/api/batch-transcribe/route.ts:3>) | [app/api/batch-transcribe/stream/route.ts:4](</Users/xjx/Documents/New project 3/src/app/api/batch-transcribe/stream/route.ts:4>) |
| 14 | [app/library/_hooks/useLibrarySelection.ts:37](</Users/xjx/Documents/New project 3/src/app/library/_hooks/useLibrarySelection.ts:37>) | [app/library/_hooks/useLibrarySelection.ts:132](</Users/xjx/Documents/New project 3/src/app/library/_hooks/useLibrarySelection.ts:132>) |
| 14 | [lib/capability-bridge.ts:414](</Users/xjx/Documents/New project 3/src/lib/capability-bridge.ts:414>) | [lib/support-documents.ts:593](</Users/xjx/Documents/New project 3/src/lib/support-documents.ts:593>) |
| 13 | [lib/ai.ts:1932](</Users/xjx/Documents/New project 3/src/lib/ai.ts:1932>) | [lib/ai.ts:2391](</Users/xjx/Documents/New project 3/src/lib/ai.ts:2391>) |
| 11 | [app/api/drafts/route.ts:59](</Users/xjx/Documents/New project 3/src/app/api/drafts/route.ts:59>) | [app/api/drafts/route.ts:80](</Users/xjx/Documents/New project 3/src/app/api/drafts/route.ts:80>) |

## 未使用导出候选完整清单

这里的“未使用”主要是没有其他模块引用该导出；函数仍可能在本文件内部调用。例如 storage.ts 的 toDraftSummary 仍用于摘要映射，应优先考虑移除 export 而非删除函数。utils.ts 中部分符号是多余转发，platform-links.ts 中的原实现仍被使用。API 客户端包装未被引用也不证明对应服务端路由可删除。

| 文件 | 类别 | 导出名 |
|---|---|---|
| src/lib/ai.ts | 值导出 | `webSearchCompleteStrict` |
| src/lib/ai.ts | 类型导出 | `ChatWireApi`, `ModelErrorKind`, `StyleAnalysisProgress` |
| src/lib/model-runtime.ts | 值导出 | `getChatFallbackConfig`, `getChatConfigs`, `isWebResearchConfigConfigured`, `modelEndpoint`, `summarizeChatFailure` |
| src/lib/model-runtime.ts | 类型导出 | `ChatConfigRole` |
| src/lib/opencli-bilibili.ts | 值导出 | `getBilibiliComments` |
| src/lib/opencli-bilibili.ts | 类型导出 | `BilibiliCommentSample`, `BilibiliVideoReference`, `BilibiliRelatedCommentVideo`, `BilibiliRelatedCommentSample` |
| src/lib/capability-bridge.ts | 值导出 | `CapabilityBridgeError` |
| src/lib/opencli-douyin-scripts.ts | 值导出 | `DOUYIN_VIDEO_COMMENT_EXTRACT_JS`, `buildDouyinPostExtractJs`, `DOUYIN_PROFILE_VIDEO_LINKS_EXTRACT_JS`, `buildDouyinVideoPageDomExtractJs` |
| src/app/douyin-hotlist/_lib/douyin-hotlist-model.ts | 值导出 | `DEFAULT_WINDOW`, `compareHotlistItems`, `getTimeValue` |
| src/app/douyin-hotlist/_lib/douyin-hotlist-model.ts | 类型导出 | `RefreshJobSettlement` |
| src/lib/douyin-hotlist-refresh-log.ts | 值导出 | `MAX_DOUYIN_HOTLIST_REFRESH_LOGS` |
| src/lib/douyin-access-errors.ts | 值导出 | `DOUYIN_SESSION_ERROR`, `DOUYIN_ACCESS_ERROR`, `DOUYIN_RATE_LIMIT_ERROR`, `DOUYIN_LOGIN_ERROR` |
| src/lib/opencli.ts | 值导出 | `openCliRows`, `getBilibiliComments`, `normalizeAccountInput`, `getDouyinVideoDetailMap`, `resetDouyinVideoStatsBrowser`, `hydrateDouyinVideoStats`, `getDouyinVideoStatsFromAccount`, `getDouyinTopComments` |
| src/lib/opencli.ts | 类型导出 | `OpenCliTimingEntry`, `OpenCliTimingMeta`, `BilibiliCommentSample`, `BilibiliRelatedCommentResult`, `BilibiliRelatedCommentVideo`, `BilibiliVideoReference`, `BilibiliVideoStatsResult`, `DouyinRelatedCommentVideo`, `DouyinRelatedCommentSample` |
| src/lib/types.ts | 值导出 | `engagementGenerationModes`, `hotspotSourceTypes`, `hotspotBoards`, `hotspotMonitorTypes` |
| src/lib/types.ts | 类型导出 | `AccountWriteStyleReference`, `ProjectWriteStyleReference`, `AccountDraftSummary`, `ProjectDraftSummary`, `ProjectSourceAccount`, `CopySourceStatus`, `EngagementGenerationOptions`, `GrossMarginCalculationInput`, `DouyinHotlistVideo`, `DouyinHotlistSummary`, `HotspotScoutStatus`, `HotspotDisplayInfo`, `HotspotBoardStat`, `HotspotRadarSummary`, `JobStatus`, `JobResultRef`, `LibraryTrashOperationStatus` |
| src/lib/engagement-research.ts | 值导出 | `planEngagementResearchQueries` |
| src/lib/engagement-research.ts | 类型导出 | `EngagementResearchSourceStat`, `VideoCommentQuarantineSource` |
| src/lib/storage.ts | 值导出 | `deleteGrossMarginCategories`, `deleteGrossMarginTier`, `getGrossMarginReviewTemplate`, `saveGrossMarginMonitorRecord`, `upsertGrossMarginCategory`, `upsertGrossMarginTier`, `ensureLibrary`, `findAccountByUid`, `getEngagementRecords`, `toEngagementRecordSummary`, `ensureDraftAssetDir`, `getDrafts`, `toDraftSummary` |
| src/lib/source-extraction.ts | 值导出 | `extractFirstSourceUrl` |
| src/lib/storage/support-documents.ts | 值导出 | `supportDocumentCacheKey` |
| src/lib/gross-margin-calculator.ts | 值导出 | `getServiceOptions` |
| src/lib/image-generation-types.ts | 值导出 | `imageSizes`, `imageQualities` |
| src/lib/image-generation-types.ts | 类型导出 | `ImageRecordDeleteResult` |
| src/lib/storage/gross-margin.ts | 值导出 | `getGrossMarginReviewTemplate`, `upsertGrossMarginCategory`, `deleteGrossMarginCategories`, `upsertGrossMarginTier`, `deleteGrossMarginTier` |
| src/lib/feishu.ts | 值导出 | `getFeishuRuntimeConfig` |
| src/lib/storage/schemas.ts | 值导出 | `aiPolicyValueSchema` |
| src/lib/writer-context.ts | 值导出 | `writerTaskSchema`, `writerPlanSchema`, `styleEvidenceQuotes`, `referenceSelectionInstruction` |
| src/lib/writer-preference.ts | 值导出 | `preferenceBlocks` |
| src/app/assets/_components/asset-view-utils.ts | 值导出 | `getDraftReferenceLabel`, `hasSourceInput` |
| src/lib/client.ts | 值导出 | `refreshGrossMarginMonitorRecords`, `getLibraryTrashOperations`, `collectAccount`, `refreshDouyinHotlist`, `refreshHotspotRadar`, `transcribeVideo`, `hydrateVideo`, `batchTranscribe`, `streamBatchTranscribe`, `transcribeSingleVideoLink`, `generatePublishCopy`, `createProjectFromCopySources`, `deleteTranscript`, `generateStyle`, `streamGenerateStyle`, `deleteProjects`, `generateProjectStyle`, `streamGenerateProjectStyle`, `writeCopy`, `streamWriteCopy`, `refreshDrafts`, `generateDraftEngagement`, `generateEngagement`, `collectDraftCoverReferences`, `uploadDraftCoverReferences`, `streamGenerateDraftCover`, `draftAssetFileUrl`, `getHealth` |
| src/lib/client.ts | 类型导出 | `WorkspaceHealthResponse`, `GrossMarginHealthResponse`, `HealthResponse` |
| src/lib/platform-links.ts | 值导出 | `isAccountLink`, `normalizeRemoteMediaUrl`, `isSupportedRemoteMediaUrl`, `selectRemoteVideoMediaUrl`, `audioMediaUrlScore` |
| src/lib/platform-links.ts | 类型导出 | `LinkInputKind` |
| src/app/images/_components/ImageControls.tsx | 值导出 | `ImageSettings` |
| src/lib/hotspots.ts | 值导出 | `refreshHotspotRadar`, `getHotspotRadarSnapshotSummary` |
| src/lib/utils.ts | 值导出 | `buildDouyinVideoUrl`, `extractBilibiliUid`, `extractBvid`, `extractDouyinAwemeId`, `extractDouyinSecUid`, `isLikelyDirectMediaUrl` |
| src/lib/jobs.ts | 值导出 | `listJobs` |
| src/lib/storage/core.ts | 值导出 | `resolveStoredLibraryPath` |
| src/lib/engagement-style.ts | 值导出 | `engagementCommentIntents`, `commentStyleChannel`, `buildPresetEngagementStyleProfile`, `extractNativeEmotes` |
| src/lib/engagement-style.ts | 类型导出 | `EngagementDanmakuRhythmProfile` |
| src/lib/gross-margin-template.ts | 值导出 | `findUnknownGrossMarginReviewTemplateVariables` |
| src/lib/gross-margin-template.ts | 类型导出 | `GrossMarginReviewTemplateVariable` |
| src/components/UnsavedChangesGuard.tsx | 值导出 | `hasUnsavedChanges` |
| src/lib/jobs-cloud.ts | 值导出 | `getCloudJobEventCursor` |
| src/lib/batch-transcribe.ts | 类型导出 | `BatchTranscribeVideoEvent` |
| src/lib/gross-margin-monitor-template.ts | 类型导出 | `GrossMarginBulkMonitorItem` |

## 复现

在项目根目录执行（不使用 --fix）：

```sh
npm exec --yes --package=knip@6.36.0 -- knip --config outputs/code-audit-2026-09-17/knip.config.json --reporter json --no-progress
npm exec --yes --package=jscpd@5.2.1 -- jscpd src --min-lines 5 --min-tokens 50 --mode mild --format typescript,tsx,css --reporters json --output /tmp/code-audit-standard
npm exec --yes --package=jscpd@5.2.1 -- jscpd src --min-lines 10 --min-tokens 100 --mode mild --format typescript,tsx,css --reporters json --output /tmp/code-audit-long
```
