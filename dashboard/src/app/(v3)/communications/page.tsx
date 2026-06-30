import { redirect } from 'next/navigation';

// /communications was renamed to /inbox — keep old URL working
export default function CommunicationsRedirect() {
  redirect('/inbox');
}
