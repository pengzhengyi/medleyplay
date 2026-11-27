import { ApiError } from "../api";
import type { Words } from "../locale";

const KNOWN: Readonly<Record<string, number>> = {
  "That device is no longer allowed; it may have been removed.": 404,
  "That device is no longer waiting; it may have stopped asking.": 404,
  "This would disconnect this device; remove it from the host or another device.": 409,
  "Only an admin can answer devices or change who may connect.": 403,
  "A device's name can be at most 40 characters.": 422,
  "A device's name can't hold line breaks or other control characters.": 422,
};

export function deviceError(failure: unknown, t: Words): string {
  const detail = failure instanceof Error ? failure.message : String(failure);
  return failure instanceof ApiError && KNOWN[detail] === failure.status ? t(detail) : detail;
}
