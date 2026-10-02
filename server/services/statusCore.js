const STATUS_VALUES = new Set([
  "new",
  "review",
  "progress",
  "finished",
  "pending_transfer",
  "transferred",
  "completed",
  "archived"
]);

export const ALLOWED_STATUS_TRANSITIONS = {
  new: new Set(["new", "review", "progress"]),
  review: new Set(["review", "progress"]),
  progress: new Set(["progress", "finished"]),
  finished: new Set(["finished", "pending_transfer"]),
  pending_transfer: new Set(["pending_transfer", "transferred"]),
  transferred: new Set(["transferred", "completed"]),
  // المكتمل يمكن إرجاعه لأي حالة تشغيلية، مع بقاء "archived" مسارًا منفصلًا.
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

  return normalizeStatus(status);
}

export function isValidStatus(value) {
  return normalizeStatus(value) !== "";
}

export function canTransitionStatus(fromValue, toValue) {
  const from = normalizeStoredStatus(fromValue);
  const to = normalizeStatus(toValue);

  if (!from || !to) return false;
  if (from === to) return true;

  // الحالة المكتملة قابلة للإرجاع لأي حالة تشغيلية،
  // بينما الأرشفة تبقى مسارًا منفصلًا ولا يمكن الرجوع منها.
  if (from === "completed") {
    return [
      "new",
      "review",
      "progress",
      "finished",
      "pending_transfer",
      "transferred",
      "completed"
    ].includes(to);
  }

  return Boolean(
    ALLOWED_STATUS_TRANSITIONS[from]?.has(to)
  );
}
