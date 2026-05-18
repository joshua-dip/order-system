import { redirect } from 'next/navigation';

export default function LegacyBlockWorkbookRedirect() {
  redirect('/admin/workbook-maker/block-blank');
}
