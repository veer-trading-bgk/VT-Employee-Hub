// Plain JS (not .ts) deliberately — see permissions.js for why.

/**
 * The delete endpoint for a contact differs by whether it's a real CRM
 * lead or a phone-only unknown (INBOX#) contact — extracted from
 * contacts/page.tsx's bulk-delete mutation so the URL construction has a
 * regression test independent of any React/mutation wiring.
 *
 * @param {{ id: string; phone: string; type?: string; leadId?: string | null }} contact
 * @returns {{ url: string; method: 'DELETE' }}
 */
function buildContactDeleteRequest(contact) {
  const isLead = contact.type === 'lead' || (contact.leadId ?? null) !== null;
  return {
    url: isLead ? `/api/crm/leads/${contact.id}` : `/api/contacts/unknown/${contact.phone}`,
    method: 'DELETE',
  };
}

module.exports = { buildContactDeleteRequest };
