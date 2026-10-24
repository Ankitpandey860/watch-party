// Small ring buffer of diagnostic events that the popup can copy for a bug report. It deliberately
// records ONLY capability/state facts. `redact` strips anything that could be a credential.
export function redact(value) {
  if (typeof value === "string") {
    return value
      .replace(/wpx_[A-Za-z0-9_-]+/g, "wpx_[redacted]")
      .replace(/([?&](?:token|ticket|code|auth|key|sig|jwt)=)[^&\s]+/gi, "$1[redacted]")
      .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
      .replace(/(netflixid|securenetflixid|nfvdid|memclid)=[^;\s]+/gi, "$1=[redacted]")
      .slice(0, 300);
  }
  if (Array.isArray(value)) return value.slice(0, 20).map(redact);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = /token|secret|cookie|authorization|password/i.test(k) ? "[redacted]" : redact(v);
    return out;
  }
  return value;
}

export function createDiagnostics({ max = 80, now = Date.now } = {}) {
  const items = [];
  return {
    log(event, data) {
      items.push({ t: now(), event, data: data === undefined ? undefined : redact(data) });
      if (items.length > max) items.shift();
    },
    dump: () => items.slice(),
    get size() { return items.length; },
  };
}
