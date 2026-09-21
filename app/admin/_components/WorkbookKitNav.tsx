'use client';

import CollapsibleNavGroup from './CollapsibleNavGroup';

export default function WorkbookKitNav() {
  return (
    <CollapsibleNavGroup
      header={{ href: '/admin/workbook-kit', label: '워크북키트' }}
      autoExpandPrefix="/admin/workbook-kit"
      children={[
        { href: '/admin/workbook-kit', label: '제작 · PDF', exact: true },
      ]}
    />
  );
}
