/** Derive trial days from trialEndsAt when API omits daysLeftInTrial (CD-01). */
export function deriveDaysLeftInTrial(
  trialEndsAt?: string | null,
  daysLeftInTrial?: number | null,
): number | null {
  if (typeof daysLeftInTrial === 'number' && !Number.isNaN(daysLeftInTrial)) {
    return Math.max(0, daysLeftInTrial);
  }
  if (!trialEndsAt) return null;
  return Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000));
}
