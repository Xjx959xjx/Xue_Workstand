"use client";

import { getAccountDetail, getProjectDetail } from "@/lib/client";
import type { AccountDetail, Platform, ProjectDetail } from "@/lib/types";

type DetailCacheOptions = {
  includeStyle?: boolean;
  version?: string;
  force?: boolean;
};

const accountDetailCache = new Map<string, AccountDetail>();
const accountDetailRequests = new Map<string, Promise<AccountDetail>>();
const projectDetailCache = new Map<string, ProjectDetail>();
const projectDetailRequests = new Map<string, Promise<ProjectDetail>>();
const MAX_CACHE_ENTRIES = 60;

export function cachedGetAccountDetail(input: {
  platform: Platform;
  accountId: string;
} & DetailCacheOptions) {
  const cacheKey = accountDetailCacheKey(input.platform, input.accountId, input);
  if (input.force) invalidateAccountDetail(input.platform, input.accountId);

  const cached = accountDetailCache.get(cacheKey);
  if (cached && !input.force) return Promise.resolve(cached);

  const pending = accountDetailRequests.get(cacheKey);
  if (pending && !input.force) return pending;

  const request = getAccountDetail({
    platform: input.platform,
    accountId: input.accountId,
    includeStyle: input.includeStyle
  })
    .then((detail) => {
      remember(accountDetailCache, cacheKey, detail);
      return detail;
    })
    .finally(() => {
      accountDetailRequests.delete(cacheKey);
    });

  accountDetailRequests.set(cacheKey, request);
  return request;
}

export function cachedGetProjectDetail(projectId: string, options: DetailCacheOptions = {}) {
  const cacheKey = projectDetailCacheKey(projectId, options);
  if (options.force) invalidateProjectDetail(projectId);

  const cached = projectDetailCache.get(cacheKey);
  if (cached && !options.force) return Promise.resolve(cached);

  const pending = projectDetailRequests.get(cacheKey);
  if (pending && !options.force) return pending;

  const request = getProjectDetail(projectId, {
    includeStyle: options.includeStyle
  })
    .then((detail) => {
      remember(projectDetailCache, cacheKey, detail);
      return detail;
    })
    .finally(() => {
      projectDetailRequests.delete(cacheKey);
    });

  projectDetailRequests.set(cacheKey, request);
  return request;
}

export function invalidateAccountDetail(platform?: Platform, accountId?: string) {
  const prefix = platform && accountId ? accountDetailPrefix(platform, accountId) : "account|";
  deleteMatching(accountDetailCache, prefix);
  deleteMatching(accountDetailRequests, prefix);
}

export function invalidateProjectDetail(projectId?: string) {
  const prefix = projectId ? projectDetailPrefix(projectId) : "project|";
  deleteMatching(projectDetailCache, prefix);
  deleteMatching(projectDetailRequests, prefix);
}

function accountDetailPrefix(platform: Platform, accountId: string) {
  return `account|${platform}|${accountId}|`;
}

function accountDetailCacheKey(platform: Platform, accountId: string, options: DetailCacheOptions) {
  return `${accountDetailPrefix(platform, accountId)}${options.includeStyle ? "style" : "base"}|${options.version || "current"}`;
}

function projectDetailPrefix(projectId: string) {
  return `project|${projectId}|`;
}

function projectDetailCacheKey(projectId: string, options: DetailCacheOptions) {
  return `${projectDetailPrefix(projectId)}${options.includeStyle ? "style" : "base"}|${options.version || "current"}`;
}

function remember<T>(cache: Map<string, T>, key: string, value: T) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

function deleteMatching<T>(map: Map<string, T>, prefix: string) {
  for (const key of map.keys()) {
    if (key.startsWith(prefix)) map.delete(key);
  }
}
