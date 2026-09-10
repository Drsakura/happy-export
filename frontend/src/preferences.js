// Whitelist stored preferences and tolerate blocked browser storage.
export function readPreference(key, allowed, fallback) {
  try {
    const value = localStorage.getItem(key)
    return allowed.includes(value) ? value : fallback
  } catch { return fallback }
}
