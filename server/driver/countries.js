// ISO 3166-1 alpha-2 values accepted by Driver profiles. The public
// directory uses this code to render a flag; it never exposes free-text city
// or country fields.
const COUNTRY_CODES = new Set([
  "AD", "AE", "AF", "AL", "AM", "AT", "AZ", "BA", "BD", "BE", "BG", "BH", "BN", "BT", "BY", "CH", "CN", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GB", "GE", "GR", "HR", "HU", "ID", "IE", "IL", "IN", "IQ", "IR", "IS", "IT", "JO", "JP", "KG", "KH", "KP", "KR", "KW", "KZ", "LA", "LB", "LI", "LK", "LT", "LU", "LV", "MC", "MD", "ME", "MK", "MM", "MN", "MT", "MV", "MY", "NL", "NO", "NP", "OM", "PK", "PH", "PL", "PS", "PT", "QA", "RO", "RS", "RU", "SA", "SE", "SG", "SI", "SK", "SM", "SY", "TH", "TJ", "TL", "TM", "TR", "TW", "UA", "UZ", "VA", "VN", "YE"
]);

function normalizeCountryCode(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const code = value.trim().toUpperCase();
  return COUNTRY_CODES.has(code) ? code : undefined;
}

module.exports = { COUNTRY_CODES, normalizeCountryCode };
