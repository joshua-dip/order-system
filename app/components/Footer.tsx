'use client';

import { usePathname } from 'next/navigation';

const Footer = () => {
  const pathname = usePathname();
  if (pathname?.startsWith('/admin/syntax-analyzer') || pathname?.startsWith('/my/vip')) {
    return null;
  }

  const companyName = process.env.NEXT_PUBLIC_FOOTER_COMPANY_NAME ?? '';
  const repName = process.env.NEXT_PUBLIC_FOOTER_REP_NAME ?? '';
  const bizNumber = process.env.NEXT_PUBLIC_FOOTER_BIZ_NUMBER ?? '';
  const address = process.env.NEXT_PUBLIC_FOOTER_ADDRESS ?? '';
  const phone = process.env.NEXT_PUBLIC_FOOTER_PHONE ?? '';
  const hasBusinessInfo = companyName || repName || bizNumber || address || phone;

  return (
    <footer className="py-4 mt-auto" style={{ backgroundColor: '#F5C6CB', color: '#333' }}>
      <div className="container mx-auto px-4">
        <div className="border-t border-gray-400 mt-4 pt-4">
          <div className="text-center text-xs text-gray-600 space-y-2">
            {hasBusinessInfo ? (
              <>
                {companyName && <div className="font-semibold text-sm mb-2">{companyName}</div>}
                {(repName || bizNumber) && (
                  <div className="flex flex-col md:flex-row md:justify-center md:space-x-4 space-y-1 md:space-y-0">
                    {repName && <span>대표자: {repName}</span>}
                    {repName && bizNumber && <span className="hidden md:inline">|</span>}
                    {bizNumber && <span>사업자등록번호: {bizNumber}</span>}
                  </div>
                )}
                {address && <div><span>주소: {address}</span></div>}
                {phone && <div><span>전화: {phone}</span></div>}
              </>
            ) : null}
            <div className="mt-3 pt-2 border-t border-gray-300">
              <p>© 2025 Payperic. All rights reserved.</p>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
