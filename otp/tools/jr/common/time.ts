import type { ServiceDayTime } from './types.js';

const SERVICE_TIME_PATTERN = /^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?$/;

export function isServiceDayTime(value: unknown): value is ServiceDayTime {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    Number.isInteger(candidate.dayOffset) &&
    (candidate.dayOffset as number) >= 0 &&
    Number.isInteger(candidate.hour) &&
    (candidate.hour as number) >= 0 &&
    (candidate.hour as number) <= 23 &&
    Number.isInteger(candidate.minute) &&
    (candidate.minute as number) >= 0 &&
    (candidate.minute as number) <= 59 &&
    Number.isInteger(candidate.second) &&
    (candidate.second as number) >= 0 &&
    (candidate.second as number) <= 59
  );
}

export function parseServiceDayTime(value: string): ServiceDayTime {
  const match = SERVICE_TIME_PATTERN.exec(value);
  if (match === null) {
    throw new Error(`Invalid service-day time: ${value}`);
  }

  const totalHour = Number(match[1]);
  return {
    dayOffset: Math.floor(totalHour / 24),
    hour: totalHour % 24,
    minute: Number(match[2]),
    second: Number(match[3] ?? '0'),
  };
}

export function formatServiceDayTime(value: ServiceDayTime): string {
  if (!isServiceDayTime(value)) {
    throw new Error('Cannot format an invalid service-day time');
  }

  const totalHour = value.dayOffset * 24 + value.hour;
  return `${String(totalHour).padStart(2, '0')}:${String(value.minute).padStart(2, '0')}:${String(value.second).padStart(2, '0')}`;
}

export function serviceDaySeconds(value: ServiceDayTime): number {
  if (!isServiceDayTime(value)) {
    throw new Error('Cannot compare an invalid service-day time');
  }

  return (
    ((value.dayOffset * 24 + value.hour) * 60 + value.minute) * 60 +
    value.second
  );
}

export function compareServiceDayTimes(
  left: ServiceDayTime,
  right: ServiceDayTime,
): number {
  return serviceDaySeconds(left) - serviceDaySeconds(right);
}
