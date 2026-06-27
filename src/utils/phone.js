/**
 * Normalize any Indian phone representation to a 10-digit string.
 * Handles E.164 (+91XXXXXXXXXX / 91XXXXXXXXXX) and plain 10-digit.
 */
function to10Digit(p) {
  if (!p) return '';
  const d = String(p).replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) return d.slice(2);
  if (d.length > 10) return d.slice(-10);
  return d;
}

module.exports = { to10Digit };
