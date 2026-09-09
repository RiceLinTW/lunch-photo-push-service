import type { Env } from "./index.ts";
import { recordDeliveryResult } from "./index.ts";
import { SOURCE_REQUEST_HEADERS } from "./source-headers.ts";
import { sendWebPush, type PushTarget } from "./web-push.ts";

const SOURCE_ORIGIN = "https://fatraceschool.k12ea.gov.tw";

interface SchoolRow { school_id: string }
interface SubscriptionRow extends PushTarget {}
interface MenuItem { BatchDataId?: string | number | null }
export interface Dish {
  DishId?: string | number | null;
  DishName?: string | null;
  DishType?: string | null;
  PicturePath?: string | null;
}

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

export function notificationPayload(schoolId: string, date: string, frontendUrl: string, schoolName?: string) {
  const url = new URL(frontendUrl);
  url.searchParams.set("schoolId", schoolId);
  url.searchParams.set("date", date);
  return {
    title: schoolName ? `${schoolName}午餐照片已上傳` : "今日午餐照片已上傳",
    body: "點一下查看今日菜色照片。",
    url: url.toString(),
  };
}

export async function fetchSchoolMenu(schoolId: string, date: string, fetcher: typeof fetch = fetch): Promise<Dish[]> {
  const menuUrl = new URL("/offered/meal", SOURCE_ORIGIN);
  menuUrl.search = new URLSearchParams({ SchoolId: schoolId, period: date, KitchenId: "all", MenuType: "1" }).toString();
  const menuResponse = await fetcher(menuUrl, { headers: SOURCE_REQUEST_HEADERS });
  if (!menuResponse.ok) throw new Error(`Menu API returned ${menuResponse.status}`);
  const menu = await menuResponse.json() as { data?: MenuItem[] };
  const batchIds = [...new Set((menu.data ?? []).map((item) => item.BatchDataId).filter((id): id is string | number => id !== null && id !== undefined && id !== ""))];
  const allDishes: Dish[] = [];
  for (const batchId of batchIds) {
    const dishUrl = new URL("/dish", SOURCE_ORIGIN);
    dishUrl.searchParams.set("BatchDataId", String(batchId));
    const dishResponse = await fetcher(dishUrl, { headers: SOURCE_REQUEST_HEADERS });
    if (!dishResponse.ok) throw new Error(`Dish API returned ${dishResponse.status}`);
    const dishResult = await dishResponse.json() as { data?: Dish[] };
    allDishes.push(...(dishResult.data ?? []));
  }
  return allDishes;
}

// The source platform always fills PicturePath with a placeholder path ending
// in a bare "." before a dish photo is actually uploaded, and only appends a
// real file extension (e.g. ".jpg") once a photo exists - so a non-empty
// check alone is a false positive for "has photo" on every dish, every day.
const PHOTO_EXTENSION = /\.(jpe?g|png|gif|webp)$/i;

async function schoolHasPhoto(schoolId: string, date: string, fetcher: typeof fetch): Promise<boolean> {
  const dishes = await fetchSchoolMenu(schoolId, date, fetcher);
  return dishes.some((dish) => typeof dish.PicturePath === "string" && PHOTO_EXTENSION.test(dish.PicturePath));
}

export async function checkMenusAndNotify(
  env: Env,
  frontendUrl: string,
  dependencies: Partial<CronDependencies> = {},
): Promise<void> {
  const fetcher = dependencies.fetch ?? fetch;
  const push = dependencies.push ?? sendWebPush;
  const now = dependencies.now ?? new Date();
  const date = taipeiDate(now);
  let schoolsChecked = 0;
  let notified = 0;
  let runError: string | null = null;

  try {
    const retentionCutoff = taipeiDate(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
    await env.DB.prepare("DELETE FROM notification_log WHERE date < ?").bind(retentionCutoff).run();
    const schools = await env.DB.prepare(`SELECT DISTINCT s.school_id
      FROM subscriptions s
      LEFT JOIN notification_log n ON n.school_id = s.school_id AND n.date = ?
      WHERE n.school_id IS NULL`).bind(date).all<SchoolRow>();

    for (const { school_id: schoolId } of schools.results) {
      schoolsChecked++;
      try {
        if (!await schoolHasPhoto(schoolId, date, fetcher)) continue;
        const claim = await env.DB.prepare(
          "INSERT OR IGNORE INTO notification_log (school_id, date, notified_at) VALUES (?, ?, ?)",
        ).bind(schoolId, date, new Date().toISOString()).run();
        if ((claim.meta.changes ?? 0) === 0) continue;

        const subscriptions = await env.DB.prepare(
          "SELECT endpoint, p256dh, auth FROM subscriptions WHERE school_id = ?",
        ).bind(schoolId).all<SubscriptionRow>();
        // A confirmed schoolId always equals the school_code it was verified against
        // (see schools.ts resolveSchool), so this lookup is safe even though the two
        // are conceptually different columns.
        const directoryEntry = await env.DB.prepare(
          "SELECT school_name FROM school_directory WHERE school_code = ?",
        ).bind(schoolId).all<{ school_name: string }>();
        const payload = notificationPayload(schoolId, date, frontendUrl, directoryEntry.results[0]?.school_name);
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
        notified++;
      } catch (error) {
        console.error("Menu check failed for school", { schoolId, error });
        runError = `${schoolId}: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  } catch (error) {
    console.error("checkMenusAndNotify failed", error);
    runError = error instanceof Error ? error.message : String(error);
  } finally {
    await env.DB.prepare(
      "INSERT INTO cron_log (ran_at, schools_checked, notified, error) VALUES (?, ?, ?, ?)",
    ).bind(new Date().toISOString(), schoolsChecked, notified, runError).run();
  }
}
