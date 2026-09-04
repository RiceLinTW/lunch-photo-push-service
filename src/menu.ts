import type { Env } from "./index.ts";
import { recordDeliveryResult } from "./index.ts";
import { sendWebPush, type PushTarget } from "./web-push.ts";

const SOURCE_ORIGIN = "https://fatraceschool.k12ea.gov.tw";

interface SchoolRow { school_id: string }
interface SubscriptionRow extends PushTarget {}
interface MenuItem { BatchDataId?: string | number | null }
interface Dish { PicturePath?: string | null }

export interface CronDependencies {
  fetch: typeof fetch;
  push: typeof sendWebPush;
  now: Date;
}

export function taipeiDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function notificationPayload(schoolId: string, date: string, frontendUrl: string) {
  const url = new URL(frontendUrl);
  url.searchParams.set("schoolId", schoolId);
  url.searchParams.set("date", date);
  return {
    title: "今日午餐照片已上傳",
    body: "點一下查看學校今日菜色照片。",
    url: url.toString(),
  };
}

async function schoolHasPhoto(schoolId: string, date: string, fetcher: typeof fetch): Promise<boolean> {
  const menuUrl = new URL("/offered/meal", SOURCE_ORIGIN);
  menuUrl.search = new URLSearchParams({ SchoolId: schoolId, period: date, KitchenId: "all", MenuType: "1" }).toString();
  const menuResponse = await fetcher(menuUrl);
  if (!menuResponse.ok) throw new Error(`Menu API returned ${menuResponse.status}`);
  const menu = await menuResponse.json() as { data?: MenuItem[] };
  const batchIds = [...new Set((menu.data ?? []).map((item) => item.BatchDataId).filter((id): id is string | number => id !== null && id !== undefined && id !== ""))];
  for (const batchId of batchIds) {
    const dishUrl = new URL("/dish", SOURCE_ORIGIN);
    dishUrl.searchParams.set("BatchDataId", String(batchId));
    const dishResponse = await fetcher(dishUrl);
    if (!dishResponse.ok) throw new Error(`Dish API returned ${dishResponse.status}`);
    const dishes = await dishResponse.json() as Dish[];
    if (dishes.some((dish) => typeof dish.PicturePath === "string" && dish.PicturePath.trim() !== "")) return true;
  }
  return false;
}

export async function checkMenusAndNotify(
  env: Env,
  frontendUrl: string,
  dependencies: Partial<CronDependencies> = {},
): Promise<void> {
  const fetcher = dependencies.fetch ?? fetch;
  const push = dependencies.push ?? sendWebPush;
  const date = taipeiDate(dependencies.now);
  const schools = await env.DB.prepare(`SELECT DISTINCT s.school_id
    FROM subscriptions s
    LEFT JOIN notification_log n ON n.school_id = s.school_id AND n.date = ?
    WHERE n.school_id IS NULL`).bind(date).all<SchoolRow>();

  for (const { school_id: schoolId } of schools.results) {
    if (!await schoolHasPhoto(schoolId, date, fetcher)) continue;
    const claim = await env.DB.prepare(
      "INSERT OR IGNORE INTO notification_log (school_id, date, notified_at) VALUES (?, ?, ?)",
    ).bind(schoolId, date, new Date().toISOString()).run();
    if ((claim.meta.changes ?? 0) === 0) continue;

    const subscriptions = await env.DB.prepare(
      "SELECT endpoint, p256dh, auth FROM subscriptions WHERE school_id = ?",
    ).bind(schoolId).all<SubscriptionRow>();
    const payload = notificationPayload(schoolId, date, frontendUrl);
    await Promise.all(subscriptions.results.map(async (subscription) => {
      try {
        const response = await push(subscription, payload, {
          privateKey: env.VAPID_PRIVATE_KEY,
          publicKey: env.VAPID_PUBLIC_KEY,
          subject: env.VAPID_SUBJECT,
        }, fetcher);
        await recordDeliveryResult(env.DB, subscription.endpoint, response.status);
      } catch (error) {
        console.error("Web Push delivery failed", { endpoint: subscription.endpoint, error });
      }
    }));
  }
}
