const COUNTRY_CODES = [
  "AD", "AE", "AF", "AL", "AM", "AT", "AZ", "BA", "BD", "BE", "BG", "BH", "BN", "BT", "BY", "CH", "CN", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GB", "GE", "GR", "HR", "HU", "ID", "IE", "IL", "IN", "IQ", "IR", "IS", "IT", "JO", "JP", "KG", "KH", "KP", "KR", "KW", "KZ", "LA", "LB", "LI", "LK", "LT", "LU", "LV", "MC", "MD", "ME", "MK", "MM", "MN", "MT", "MV", "MY", "NL", "NO", "NP", "OM", "PK", "PH", "PL", "PS", "PT", "QA", "RO", "RS", "RU", "SA", "SE", "SG", "SI", "SK", "SM", "SY", "TH", "TJ", "TL", "TM", "TR", "TW", "UA", "UZ", "VA", "VN", "YE"
];

function normalized(code) {
  return String(code || "").trim().toUpperCase();
}

export function countryFlag(code) {
  const value = normalized(code);
  return /^[A-Z]{2}$/.test(value) ? String.fromCodePoint(...[...value].map((letter) => 0x1f1a5 + letter.charCodeAt(0))) : "";
}

export function countryLabel(code) {
  const value = normalized(code);
  if (!COUNTRY_CODES.includes(value)) return "";
  try {
    return `${countryFlag(value)} ${new Intl.DisplayNames(["ru"], { type: "region" }).of(value)}`;
  } catch {
    return countryFlag(value);
  }
}

export function populateCountrySelect(select) {
  for (const code of COUNTRY_CODES) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = countryLabel(code);
    select.append(option);
  }
}
