import { redirect } from 'next/navigation';

export default function LegacyCrmDetailRedirect({ params }: { params: { id: string } }) {
  redirect(`/admin/contacts/${params.id}`);
}
