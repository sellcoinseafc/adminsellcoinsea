const STATUS_VALUES = new Set([
  "new",
  "review",
  "progress",
  "finished",
  "pending_transfer",
  "completed",
  "archived"
]);

export const ALLOWED_STATUS_TRANSITIONS = {
  new: new Set([
    "new",
    "review",
    "progress",
    "finished",
    "pending_transfer",
    "completed"
  ]),
  review: new Set([
    "new",
    "review",
    "progress",
    "finished",
    "pending_transfer",
    "completed"
  ]),
  progress: new Set([
    "new",
    "review",
    "progress",
    "finished",
    "pending_transfer",
    "transferred",
    "completed"
  ]),
  finished: new Set([
    "new",
    "review",
    "progress",
    "finished",
    "pending_transfer",
    "transferred",
    "completed"
  ]),
  pending_transfer: new Set([
    "new",
    "review",
    "progress",
    "finished",
    "pending_transfer",
    "transferred",
    "completed"
  ]),
  completed: new Set([
    "new",
    "review",
    "progress",
    "finished",
    "pending_transfer",
    "transferred",
    "completed"
  ]),
  archived: new Set(["archived"])
};

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

  // Legacy orders used "transferred" as an intermediate/final state.
  // The canonical workflow now has six states, so legacy records are read as completed.
  if (status === "transferred") {
    return "completed";
  }

  return normalizeStatus(status);
}

export function isValidStatus(value) {
  return normalizeStatus(value) !== "";
}

export function canTransitionStatus(fromValue, toValue) {
  const from = normalizeStoredStatus(fromValue);
  const to = normalizeStatus(toValue);

  if (!from || !to) return false;

  // أي حالة تشغيلية يمكن تغييرها إلى أي حالة تشغيلية أخرى.
  // اختيار المشرف للحالة ثم الضغط على حفظ هو المصدر المعتمد.
  if (
    from !== "archived" &&
    to !== "archived"
  ) {
    return true;
  }

  return from === "archived" && to === "archived";
}
