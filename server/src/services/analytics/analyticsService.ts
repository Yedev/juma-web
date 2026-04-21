import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";

const MAX_BATCH_SIZE = 100;

type ServiceError = { error: string; status: number };

type EventContext = {
  userId?: number;
  ip?: string;
  userAgent?: string;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function clampString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function parseEventTime(value: unknown): Date {
  if (typeof value === "number" || typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date();
}

function serializeJson(value: unknown, fallback: string): string {
  try {
    return JSON.stringify(value ?? JSON.parse(fallback));
  } catch {
    return fallback;
  }
}

function pickProperties(payload: Record<string, unknown>): Record<string, unknown> {
  const candidates = [payload.properties, payload.params, payload.data, payload.payload];
  for (const candidate of candidates) {
    const objectValue = asObject(candidate);
    if (objectValue) return objectValue;
  }
  return {};
}

function pickEventName(payload: Record<string, unknown>): string {
  const candidates = [payload.event_name, payload.event, payload.name];
  for (const candidate of candidates) {
    const value = clampString(candidate, 120);
    if (value) return value;
  }
  return "";
}

function normalizeEvent(
  payload: unknown,
  index: number,
  context: EventContext,
): ServiceError | Prisma.AnalyticsEventCreateManyInput {
  const event = asObject(payload);
  if (!event) return { error: `第 ${index + 1} 条事件不是合法对象`, status: 400 };

  const eventName = pickEventName(event);
  if (!eventName) return { error: `第 ${index + 1} 条事件缺少 event_name`, status: 400 };

  const properties = pickProperties(event);
  const platform = clampString(event.platform ?? event.client_platform ?? event.os, 64);
  const page = clampString(event.page ?? event.screen ?? event.route, 255);
  const sessionId = clampString(event.session_id ?? event.sessionId, 120);
  const deviceId = clampString(
    event.device_id ?? event.deviceId ?? event.anonymous_id ?? event.anonymousId,
    120,
  );

  return {
    eventId: `AE_${randomUUID()}`,
    userId: context.userId ?? null,
    eventName,
    eventTime: parseEventTime(event.event_time ?? event.timestamp ?? event.time ?? event.occurred_at),
    platform,
    page,
    sessionId,
    deviceId,
    properties: serializeJson(properties, "{}"),
    rawPayload: serializeJson(event, "{}"),
    ip: clampString(context.ip, 64),
    userAgent: clampString(context.userAgent, 512),
  };
}

function extractEventList(input: unknown): ServiceError | unknown[] {
  if (Array.isArray(input)) return input;

  const body = asObject(input);
  if (!body) return { error: "请求体必须是对象或事件数组", status: 400 };

  if (Array.isArray(body.events)) return body.events;
  return [body];
}

export async function createEvents(
  input: unknown,
  context: EventContext,
): Promise<ServiceError | { count: number }> {
  const eventList = extractEventList(input);
  if ("error" in eventList) return eventList;

  if (eventList.length === 0) return { error: "events 不能为空", status: 400 };
  if (eventList.length > MAX_BATCH_SIZE) return { error: `单次最多上报 ${MAX_BATCH_SIZE} 条事件`, status: 400 };

  const rows: Prisma.AnalyticsEventCreateManyInput[] = [];
  for (const [index, event] of eventList.entries()) {
    const normalized = normalizeEvent(event, index, context);
    if ("error" in normalized) return normalized;
    rows.push(normalized);
  }

  const result = await prisma.analyticsEvent.createMany({ data: rows, skipDuplicates: true });
  return { count: result.count };
}
