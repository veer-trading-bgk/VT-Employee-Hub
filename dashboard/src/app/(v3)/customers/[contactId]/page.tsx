import { redirect } from 'next/navigation';

export default async function Customer360Redirect({
  params,
}: {
  params: Promise<{ contactId: string }>;
}) {
  const { contactId } = await params;
  redirect(`/contacts/${contactId}`);
}
