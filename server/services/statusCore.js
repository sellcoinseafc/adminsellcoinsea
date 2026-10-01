const STATUS_VALUES = new Set([
  "new",
  "review",
  "progress",
  "finished",
  "transferred",
  "completed",
  "archived"
]);

export function normalizeStatus(value) {
  const status = typeof value === "string"
    ? value.trim().toLowerCase()
    : "";

  return STATUS_VALUES.has(status) ? status : "";
}

export function normalizeStoredStatus(value) {
  const status = typeof value === "string"
    ? value.trim().toLowerCase()
    : "";

  if (status === "pending") {
    return "new";
  }

  return normalizeStatus(status);
}

export function isValidStatus(value) {
  return normalizeStatus(value) !== "";
}
